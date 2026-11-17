import type { SessionAssist, AssistStats } from './types.js'
import type { Round } from './serialize.js'
import { describeRound, roundMessages } from './serialize.js'
import { summarizeRounds } from './summary.js'
import { estimateTokens } from './tokens.js'

/** 与 settings 里压缩相关的字段，单独声明避免循环引用 */
export type AssistSettings = {
  contextLimit: number
  compressAt: number
  keepRecent: number
  memoryEnabled: boolean
  persona: string
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
  onCompressing?: () => void
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
  const limit = settings.contextLimit > 0 ? settings.contextLimit : 128000
  const threshold = Math.floor(limit * settings.compressAt)
  // 给输出留出空间，避免压缩判断通过但请求本身超窗
  const budget = Math.max(4096, limit - 8192)
  const previous = args.assist

  const costs = rounds.map(roundTokens)
  const allTokens = costs.reduce((sum, cost) => sum + cost, 0)
  const questionTokens = estimateTokens(question)
  let summary = previous?.summary
  let compressed = false

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
    while (keepFrom < rounds.length - 1 && used > budget) {
      keepFrom += 1
      used -= costs[keepFrom - 1]
    }
    const older = rounds.slice(0, keepFrom)
    if (older.length > 0) {
      onCompressing?.()
      summary = await summarizeRounds({
        previous: summary,
        rounds: older,
        signal,
        onProgress: onCompressProgress,
      })
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
    total: overheadTokens + historyTokens + questionTokens + (summary ? estimateTokens(summary) : 0),
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
