import { desktop } from '../utils/desktop.js'

/**
 * 一次流式请求的耗时埋点。
 * 目的是用硬数据回答「为什么慢」：是响应头迟迟不来（排队 / prefill），
 * 还是头回来了却迟迟不吐内容（首字 / 思考），还是内容出来后又断流。
 */
export type ReplyTiming = {
  sessionId: string
  model: string
  thinking: boolean
  search: boolean
  /** 0 是首次请求，1 及以上是断流后的自动续写 */
  attempt: number
  /** 进入本次请求的上下文消息条数与文本字符数，粗看上下文规模 */
  messages: number
  chars: number
  /** 响应头到达耗时；-1 表示没等到 */
  responseMs: number
  /** 首个可识别事件耗时；-1 表示没等到 */
  firstEventMs: number
  /** 首个内容增量（正文或思考）耗时；-1 表示没等到 */
  firstContentMs: number
  totalMs: number
  /** done 正常结束；stopped 用户停止；resumed 断流后自动续写；error 以失败收尾 */
  outcome: 'done' | 'stopped' | 'resumed' | 'error'
  /** outcome 为 resumed / error 时的错误分类，如 interrupted、timeout、stream */
  errorKind?: string
}

/**
 * 写一行埋点：桌面端落到 userData/logs/timing.log（打包后没有终端）。
 * 浏览器里没有落盘通道，直接丢弃；埋点失败不能影响对话本身。
 */
export const reportTiming = (entry: ReplyTiming): void => {
  try {
    desktop()?.logTiming?.(JSON.stringify({ at: new Date().toISOString(), ...entry }))
  } catch {
    // 序列化失败就放弃
  }
}
