import type { SiliconFlowModel } from '../providers.js'
import { ApiError, type StreamTrace } from './client.js'
import { readServerSentEvents, StreamIdleTimeout } from './sse.js'
import type { FileBlockParam, MessageParam, MessageStreamEvent, StopReason, TextBlockParam } from './types.js'

/**
 * 硅基流动：OpenAI 兼容接口。
 *
 * 和官方的 Anthropic 兼容接口相比少了很多东西（没有内置搜索、没有 Files API、
 * 没有自动标题），但聊天本身完全够用。这里把 OpenAI 的 chunk 流翻译成应用内部
 * 使用的 MessageStreamEvent，上层（applyEvent / 视图层）不需要知道通道差异。
 */

/** 允许用 localStorage 覆盖接口地址，仅用于本地联调（mock 服务） */
const ORIGIN_OVERRIDE_KEY = 'chat-demo:siliconflow-origin'
const DEFAULT_ORIGIN = 'https://api.siliconflow.cn/v1'

const origin = (): string => {
  try {
    const override = localStorage.getItem(ORIGIN_OVERRIDE_KEY)
    if (override) {
      return override.replace(/\/+$/, '')
    }
  } catch {
    // 读不到就用默认地址
  }
  return DEFAULT_ORIGIN
}

/** 与官方通道保持一致的看门狗参数：长上下文 prefill 慢，但不能无限等 */
const RESPONSE_HEAD_TIMEOUT = 180_000
const STREAM_IDLE_TIMEOUT = 120_000

export type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ---------- 请求转换 ----------

const textOfUser = (content: string | (FileBlockParam | TextBlockParam)[]): string =>
  typeof content === 'string'
    ? content
    : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')

const textOfAssistant = (content: Extract<MessageParam, { role: 'assistant' }>['content']): string =>
  content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

/** 连续同角色会被部分服务端拒绝，合并成一条 */
const pushMerged = (messages: OpenAiMessage[], next: OpenAiMessage) => {
  const last = messages.at(-1)
  if (last && last.role === next.role) {
    last.content = `${last.content}\n\n${next.content}`
    return
  }
  messages.push(next)
}

/**
 * 把内部消息（Anthropic 兼容格式）转成 OpenAI 格式：
 * - latest_reminder 这个官方专用角色，改成正文前面的一行「当前信息」
 * - 思考块、搜索/工具块在 OpenAI 格式里没有位置，直接丢弃（正文保留）
 * - 附件块（file_id）无法跨通道使用，跳过（附件入口在硅基流动下已禁用）
 */
export const toOpenAiMessages = (
  system: string,
  messages: MessageParam[],
  options: { inlineSystem: boolean }
): OpenAiMessage[] => {
  const result: OpenAiMessage[] = []
  let reminder = ''
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      reminder = message.content
      continue
    }
    if (message.role === 'user') {
      const body = [reminder ? `【当前信息】${reminder}` : '', textOfUser(message.content)]
        .filter((part) => part.trim())
        .join('\n\n')
      reminder = ''
      if (body.trim()) {
        pushMerged(result, { role: 'user', content: body })
      }
      continue
    }
    const text = textOfAssistant(message.content)
    if (text.trim()) {
      pushMerged(result, { role: 'assistant', content: text })
    }
  }
  if (system.trim()) {
    if (options.inlineSystem) {
      // R1 官方建议不加 system，指令并进第一条用户消息，效果更稳
      const first = result.findIndex((message) => message.role === 'user')
      if (first >= 0) {
        result[first] = { role: 'user', content: `${system.trim()}\n\n${result[first].content}` }
      } else {
        result.unshift({ role: 'user', content: system.trim() })
      }
    } else {
      result.unshift({ role: 'system', content: system.trim() })
    }
  }
  return result
}

// ---------- 密钥校验 ----------

/** 用 GET /models 校验 Key（不产生费用） */
export const verifySiliconFlowKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  let response: Response
  try {
    response = await fetch(`${origin()}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
  } catch (error) {
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ApiError('http', text || response.statusText, response.status)
  }
}

// ---------- 流式对话 ----------

type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

type Chunk = {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null }
    finish_reason?: string | null
  }[]
  usage?: Usage
  message?: string
  code?: number
}

const stopReasonOf = (reason: string | null | undefined): StopReason => {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`

export type SiliconFlowRequest = {
  apiKey: string
  model: SiliconFlowModel
  system: string
  messages: MessageParam[]
  /** 仅 switchable 模型生效 */
  thinking: boolean
}

/**
 * POST /chat/completions（stream: true），翻译成内部事件流。
 *
 * 两种通道的结束语义不同：OpenAI 用 `data: [DONE]`，还可能只给 finish_reason 就断开。
 * 只要拿到过 finish_reason 就视为完整回答（不再要求 [DONE]），否则按断流处理，
 * 交给上层的续写逻辑。
 */
export async function* streamSiliconFlow(
  request: SiliconFlowRequest,
  signal: AbortSignal,
  trace?: StreamTrace
): AsyncGenerator<MessageStreamEvent> {
  const { apiKey, model, system, messages, thinking } = request
  const guard = new AbortController()
  const onAbort = () => guard.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  let headTimedOut = false
  const headTimer = setTimeout(() => {
    headTimedOut = true
    guard.abort()
  }, RESPONSE_HEAD_TIMEOUT)

  const body: Record<string, unknown> = {
    model: model.id,
    messages: toOpenAiMessages(system, messages, { inlineSystem: model.inlineSystem }),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: model.maxOutput,
  }
  if (model.thinking === 'switchable') {
    body.enable_thinking = thinking
    if (thinking) {
      body.thinking_budget = Math.min(8192, model.maxOutput)
    }
  }

  try {
    let response: Response
    try {
      response = await fetch(`${origin()}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: guard.signal,
      })
    } catch (error) {
      if (headTimedOut && !signal.aborted) {
        throw new ApiError('timeout', { key: 'replyTimeout' })
      }
      if (signal.aborted) {
        throw error
      }
      throw new ApiError('network', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(headTimer)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let message = text || response.statusText
      try {
        const parsed = JSON.parse(text) as Chunk
        if (typeof parsed.message === 'string') {
          message = parsed.message
        }
      } catch {
        // 非 JSON 就展示原文
      }
      throw new ApiError('http', message, response.status)
    }
    trace?.('response')
    const contentType = response.headers.get('Content-Type') ?? ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      throw new ApiError('protocol', '', response.status)
    }

    let started = false
    let block = 0
    let open: 'thinking' | 'text' | null = null
    let finished = false
    let stopReason: StopReason = 'end_turn'
    let usage: Usage = {}
    let emitted = false

    try {
      for await (const { data } of readServerSentEvents(
        response.body,
        guard.signal,
        STREAM_IDLE_TIMEOUT
      )) {
        if (data === '[DONE]') {
          finished = true
          break
        }
        let chunk: Chunk
        try {
          chunk = JSON.parse(data) as Chunk
        } catch {
          continue
        }
        if (typeof chunk.message === 'string' && !chunk.choices) {
          throw new ApiError('stream', chunk.message)
        }
        if (!started) {
          started = true
          yield {
            type: 'message_start',
            message: { id: newId(), model: model.id },
          }
          trace?.('first-event')
        }
        if (chunk.usage) {
          usage = chunk.usage
        }
        const choice = chunk.choices?.[0]
        const reasoning = choice?.delta?.reasoning_content
        if (reasoning) {
          if (open !== 'thinking') {
            if (open) {
              yield { type: 'content_block_stop', index: block }
              block += 1
            }
            open = 'thinking'
            yield {
              type: 'content_block_start',
              index: block,
              content_block: { type: 'thinking', thinking: '', signature: '' },
            }
          }
          yield {
            type: 'content_block_delta',
            index: block,
            delta: { type: 'thinking_delta', thinking: reasoning },
          }
          if (!emitted) {
            emitted = true
            trace?.('first-content')
          }
        }
        const content = choice?.delta?.content
        if (content) {
          if (open !== 'text') {
            if (open) {
              yield { type: 'content_block_stop', index: block }
              block += 1
            }
            open = 'text'
            yield {
              type: 'content_block_start',
              index: block,
              content_block: { type: 'text', text: '' },
            }
          }
          yield {
            type: 'content_block_delta',
            index: block,
            delta: { type: 'text_delta', text: content },
          }
          if (!emitted) {
            emitted = true
            trace?.('first-content')
          }
        }
        if (choice?.finish_reason) {
          stopReason = stopReasonOf(choice.finish_reason)
          finished = true
        }
      }
    } catch (error) {
      if (error instanceof ApiError || signal.aborted) {
        throw error
      }
      // 已经拿到 finish_reason 再断，回答是完整的，按正常结束处理
      if (!finished) {
        if (error instanceof StreamIdleTimeout) {
          throw new ApiError('timeout', { key: 'replyTimeout' })
        }
        throw new ApiError('interrupted', error instanceof Error ? error.message : String(error))
      }
    }

    if (!started) {
      throw new ApiError('protocol', '')
    }
    if (!finished) {
      throw new ApiError('interrupted', { key: 'replyInterrupted' })
    }
    if (open) {
      yield { type: 'content_block_stop', index: block }
    }
    const cacheHit = usage.prompt_cache_hit_tokens ?? 0
    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        // prompt_tokens 是总数，缓存命中单独列出来，避免重复计入「未命中」
        input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cacheHit),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: cacheHit,
        output_tokens: usage.completion_tokens ?? 0,
      },
    }
    yield { type: 'message_stop' }
  } finally {
    clearTimeout(headTimer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** 非流式封装：只取正文，供摘要、记忆抽取这类内部请求使用 */
export const completeSiliconFlowText = async (
  request: SiliconFlowRequest,
  signal: AbortSignal
): Promise<string> => {
  let text = ''
  for await (const event of streamSiliconFlow(request, signal)) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text
}
