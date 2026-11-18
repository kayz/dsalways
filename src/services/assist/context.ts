import type { SessionAssist, AssistStats } from './types.js'
import type { Round } from './serialize.js'
import { describeRound, roundMessages } from './serialize.js'
import { summarizeRounds } from './summary.js'
import { estimateTokens } from './tokens.js'

/** 与 settings 里压缩相关的字段，单独声明避免循环引用 */
/** 触发压缩的原因，界面据此给不同的外行文案 */
export type CompressReason = 'level' | 'smallWindow' | 'recompact'

export type AssistSettings = {
  /** 已按模型算好的有效窗口 */
  contextLimit: number
  /** 触发线占「内容预算」的比例，默认 0.6 */
  compressAt: number
  /** 压后目标水位占「内容预算」的比例，默认 0.4 */
  targetRatio: number
  /** 先从窗口里扣掉的输出空间 */
  outputReserve: number
  keepRecent: number
  memoryEnabled: boolean
  persona: string
  /** 本次若发生压缩，按这个原因给提示 */
  compressReason: CompressReason
}

export type ContextPlan = {
  /** 作为原文带进请求的轮次 */
  keptRounds: Round[]
  /** 压缩后的更早对话记录；没有发生过压缩时为 undefined */
  summary: string | undefined
  stats: AssistStats
}

const roundTokens = (round: Round) => estimateTokens(describeRound(round)) + 8

/**
 * 决定这次请求带哪些轮次原文、要不要压缩、注入哪些记忆之外的结构。
 *
 * 策略（保守保细节）：总 token 没到 threshold 就全部带原文，一条不压；
 * 超过后才保留最近 keepRecent 轮原文，把更早的轮次顺序压进滚动摘要。
 * 这样短对话完全无感，只有长对话才付压缩成本。
 */
export const planContext = async (args: {
  sessionId: string
  rounds: Round[]
  question: string
  assist: SessionAssist | undefined
  settings: AssistSettings
  /** 人格 + 记忆 + 已有摘要占用的 token，由调用方算好 */
  overheadTokens: number
  signal: AbortSignal
  onCompressing?: (reason: CompressReason) => void
  /** 摘要分段进度：done 为已完成段数，total 为总段数 */
  onCompressProgress?: (done: number, total: number) => void
}): Promise<{ plan: ContextPlan; assist: SessionAssist }> => {
  const {
    sessionId,
    rounds,
    question,
    settings,
    overheadTokens,
    signal,
    onCompressing,
    onCompressProgress,
  } = args
  const limit = settings.contextLimit
  // 先扣输出预留，剩下的才是能装上下文的内容预算
  const budget = Math.max(4096, limit - settings.outputReserve)
  const threshold = Math.floor(budget * settings.compressAt)
  // 压一次要压到目标水位，给后面留出增长空间，避免每轮都触发压缩
  const target = Math.floor(budget * settings.targetRatio)
  const previous = args.assist

  const costs = rounds.map(roundTokens)
  const allTokens = costs.reduce((sum, cost) => sum + cost, 0)
  const questionTokens = estimateTokens(question)
  let summary = previous?.summary
  let compressed = false
  /** 本次压缩产出的段落列表，落盘后旧段不再改动 */
  let newSegments: string[] | undefined

  const totalBefore = overheadTokens + allTokens + questionTokens
  let keepFrom = 0

  if (totalBefore <= threshold) {
    // 未到阈值：全部保留原文，不压缩
    keepFrom = 0
  } else {
    // 到阈值：保留最近 keepRecent 轮，其余压缩
    keepFrom = Math.max(0, rounds.length - Math.max(2, settings.keepRecent))
    // 保险：即使只剩 keepRecent 轮也可能仍然过大，继续往前丢，丢掉的同样进摘要
    let used = overheadTokens + questionTokens
    used += costs.slice(keepFrom).reduce((sum, cost) => sum + cost, 0)
    while (keepFrom < rounds.length - 1 && used > target) {
      keepFrom += 1
      used -= costs[keepFrom - 1]
    }
    const older = rounds.slice(0, keepFrom)
    if (older.length > 0) {
      onCompressing?.(settings.compressReason)
      const compacted = await summarizeRounds({
        segments: previous?.segments ?? [],
        legacySummary: summary,
        rounds: older,
        signal,
        onProgress: onCompressProgress,
      })
      summary = compacted.text
      newSegments = compacted.segments
      compressed = true
    }
  }

  const keptRounds = rounds.slice(keepFrom)
  const historyTokens = costs.slice(keepFrom).reduce((sum, cost) => sum + cost, 0)

  const stats: AssistStats = {
    persona: 0,
    memory: 0,
    summary: summary ? estimateTokens(summary) : 0,
    history: historyTokens,
    historyRounds: keptRounds.length,
    question: questionTokens,
    total:
      overheadTokens + historyTokens + questionTokens + (summary ? estimateTokens(summary) : 0),
    budget,
    limit,
    threshold,
    factsUsed: 0,
    droppedRounds: keepFrom,
    compressed,
  }

  const coversTo = keptRounds.length > 0 ? keptRounds[0][0].id : undefined
  const nextAssist: SessionAssist = {
    ...(previous ?? { id: sessionId }),
    ...(newSegments ? { segments: newSegments } : {}),
    summary,
    coversMessageId: coversTo ?? previous?.coversMessageId,
    coversCount: keepFrom,
    summaryTokens: summary ? estimateTokens(summary) : 0,
    summaryUpdatedAt: compressed ? Date.now() : previous?.summaryUpdatedAt,
  }

  return { plan: { keptRounds, summary, stats }, assist: nextAssist }
}

/** 计算需要抽取记忆的轮次：只取上次抽取位置之后的、且包含至少一次助手回复的轮次 */
export const roundsForMemory = (
  rounds: Round[],
  lastMessageId: string | undefined,
  every: number
): Round[] => {
  let start = 0
  if (lastMessageId) {
    const index = rounds.findIndex(([, reply]) => reply.id === lastMessageId)
    if (index >= 0) {
      start = index + 1
    }
  }
  const fresh = rounds.slice(start)
  // 太短的对话不值得抽，避免每说一句话就调一次接口
  if (fresh.length < Math.max(2, Math.min(every, 4))) {
    return []
  }
  return fresh
}

export { roundMessages }
