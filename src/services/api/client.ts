import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents, StreamIdleTimeout } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'
/**
 * 等响应头的上限：上下文很长时 prefill 会慢，但不会慢到没有尽头。
 * 超过这个时间连响应头都没拿到，就当作连接已经不可用。
 */
const RESPONSE_HEAD_TIMEOUT = 180_000
/** 流内允许的最大静默时间；服务端 ping、保活注释、正文增量都算活动 */
const STREAM_IDLE_TIMEOUT = 120_000

/**
 * 流式请求的阶段埋点，用于区分慢在哪一段：
 * response = 响应头到达，first-event = 首个可识别事件，first-content = 首个内容增量。
 */
export type StreamTrace = (phase: 'response' | 'first-event' | 'first-content') => void

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 长时间没有任何响应数据，客户端主动中止 */
  | 'timeout'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 *
 * 两级看门狗：等响应头有上限（长上下文 prefill 会慢，但不会无限等），
 * 流内按字节间隔算空闲（ping 与保活注释也算活动），超时都归类为 kind: 'timeout'。
 * 网络中途断开、读取报错归为 kind: 'interrupted'，由调用方决定是否续写。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  trace?: StreamTrace
): AsyncGenerator<MessageStreamEvent> {
  // 看门狗只中止本次请求，不触碰调用方的 signal，避免把「超时」误记成「用户停止」
  const guard = new AbortController()
  const onAbort = () => guard.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  let headTimedOut = false
  const headTimer = setTimeout(() => {
    headTimedOut = true
    guard.abort()
  }, RESPONSE_HEAD_TIMEOUT)
  try {
    let response: Response
    try {
      response = await request(`${ANTHROPIC_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          ...anthropicHeaders(apiKey, hasFile(body)),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: guard.signal,
      })
    } catch (error) {
      if (headTimedOut && !signal.aborted) {
        throw new ApiError('timeout', { key: 'replyTimeout' })
      }
      throw error
    } finally {
      clearTimeout(headTimer)
    }
    trace?.('response')
    const contentType = response.headers.get('Content-Type') ?? ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      throw await readErrorResponse(response, 'protocol', '')
    }
    let firstEvent = false
    let firstContent = false
    try {
      for await (const { event: eventName, data } of readServerSentEvents(
        response.body,
        guard.signal,
        STREAM_IDLE_TIMEOUT
      )) {
        let payload: unknown
        try {
          payload = JSON.parse(data)
        } catch {
          if (eventName !== 'error') {
            continue
          }
        }
        if (isErrorBody(payload)) {
          throw new ApiError('stream', payload.error.message)
        }
        if (eventName === 'error') {
          throw new ApiError('stream', data)
        }
        const event = readMessageEvent(payload)
        if (!event) {
          continue
        }
        if (!firstEvent) {
          firstEvent = true
          trace?.('first-event')
        }
        if (!firstContent && event.type === 'content_block_delta') {
          firstContent = true
          trace?.('first-content')
        }
        yield event
        if (event.type === 'message_stop') {
          return
        }
      }
    } catch (error) {
      if (error instanceof ApiError || signal.aborted) {
        throw error
      }
      if (error instanceof StreamIdleTimeout) {
        throw new ApiError('timeout', { key: 'replyTimeout' })
      }
      // 网络断开、代理切断、读取失败：协议层面就是「流没走完」，可尝试续写
      throw new ApiError('interrupted', error instanceof Error ? error.message : String(error))
    }
    // 服务端没有提供错误内容时保持为空，不推测断流原因。
    throw new ApiError('interrupted', { key: 'replyInterrupted' })
  } finally {
    clearTimeout(headTimer)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 非流式的便捷封装：消费完整条流，只把正文拼起来返回。
 * 用于摘要与记忆抽取这类内部请求，界面不展示中间过程。
 */
export const completeText = async (
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): Promise<string> => {
  let text = ''
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text
}
