/**
 * SSE（text/event-stream）解析，按 WHATWG 规范实现：
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 *
 * 字节流 → UTF-8 解码 → 按 CRLF / LF / CR 切行 → 字段累积 → 空行派发事件。
 * 注释行（如服务端保活的 `: keep-alive`）直接忽略；`retry` 只对 EventSource 重连有意义，这里不处理。
 */

export type ServerSentEvent = {
  /** `event` 字段，缺省为 `message` */
  event: string
  /** 多行 `data` 以 `\n` 连接 */
  data: string
  /** 最近一次 `id` 字段 */
  lastEventId: string
}

const LINE_BREAK = /\r\n|\r|\n/g

export class ServerSentEventDecoder {
  private buffer = ''
  private data = ''
  private hasData = false
  private eventType = ''
  private lastEventId = ''

  /** 输入一段已解码的文本，返回其中完整的事件 */
  push(text: string): ServerSentEvent[] {
    this.buffer += text
    const events: ServerSentEvent[] = []
    let lineStart = 0
    LINE_BREAK.lastIndex = 0
    for (let match = LINE_BREAK.exec(this.buffer); match; match = LINE_BREAK.exec(this.buffer)) {
      // 结尾的 CR 可能是 CRLF 的前半，等下一段再判断
      if (match[0] === '\r' && LINE_BREAK.lastIndex === this.buffer.length) {
        break
      }
      const event = this.processLine(this.buffer.slice(lineStart, match.index))
      if (event) {
        events.push(event)
      }
      lineStart = LINE_BREAK.lastIndex
    }
    this.buffer = this.buffer.slice(lineStart)
    return events
  }

  /** 流结束：结尾的 CR 是完整的换行，其余未以空行结尾的事件按规范丢弃 */
  end(): ServerSentEvent[] {
    const event = this.buffer.endsWith('\r') ? this.processLine(this.buffer.slice(0, -1)) : null
    this.buffer = ''
    this.data = ''
    this.hasData = false
    this.eventType = ''
    return event ? [event] : []
  }

  private processLine(line: string): ServerSentEvent | null {
    if (line === '') {
      return this.dispatch()
    }
    if (line.startsWith(':')) {
      return null
    }
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }
    switch (field) {
      case 'data':
        this.data = this.hasData ? `${this.data}\n${value}` : value
        this.hasData = true
        break
      case 'event':
        this.eventType = value
        break
      case 'id':
        if (!value.includes('\0')) {
          this.lastEventId = value
        }
        break
      default:
        break
    }
    return null
  }

  private dispatch(): ServerSentEvent | null {
    const event: ServerSentEvent | null = this.hasData
      ? { event: this.eventType || 'message', data: this.data, lastEventId: this.lastEventId }
      : null
    this.data = ''
    this.hasData = false
    this.eventType = ''
    return event
  }
}

/** 连接在限定时间内一个字节都没收到，视为已经死掉（不是协议错误，也不是服务端主动报错） */
export class StreamIdleTimeout extends Error {
  constructor(readonly idleMs: number) {
    super(`流式响应 ${idleMs}ms 内没有任何数据`)
    this.name = 'StreamIdleTimeout'
  }
}

/**
 * 等下一片数据，超时则取消读取并拒绝。
 * 计时器只守「字节间隔」：服务端的 ping、保活注释、正文增量都算活动，
 * 所以长思考期间不会被误判，真正卡死的连接又能及时收尾。
 */
const readWithTimeout = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reader.cancel().catch(() => {})
      reject(new StreamIdleTimeout(idleMs))
    }, idleMs)
    reader.read().then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })

/**
 * 逐个产出字节流中的 SSE 事件；流读完即结束。
 * 中止或调用方提前退出时取消读取以释放连接，不依赖底层网络把中止传到响应体。
 * idleMs 大于 0 时启用空闲看门狗，超时抛出 StreamIdleTimeout。
 */
export async function* readServerSentEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  idleMs = 0
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader()
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  // TextDecoder 默认会去掉开头的 BOM；stream: true 保证多字节字符跨分片时不被截断
  const textDecoder = new TextDecoder()
  const decoder = new ServerSentEventDecoder()
  let finished = false
  try {
    for (;;) {
      const { done, value } =
        idleMs > 0 ? await readWithTimeout(reader, idleMs) : await reader.read()
      if (done) {
        finished = true
        yield* decoder.push(textDecoder.decode())
        yield* decoder.end()
        return
      }
      yield* decoder.push(textDecoder.decode(value, { stream: true }))
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!finished) {
      reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }
}
