import { create } from 'zustand'
import { getContextRounds } from '../chat/reply.js'
import type { AssistantMessage, Message, UserMessage } from '../chat/types.js'
import * as db from '../chat/db.js'
import { activeKey, useSettings } from '../settings.js'
import { effectiveContextLimit, outputReserve } from '../providers.js'
import { planContext, roundsForMemory, type CompressReason } from './context.js'
import type { AssistStats, SessionAssist } from './types.js'
import { buildSystemPrompt } from './prompt.js'
import {
  extractMemories,
  loadMemories,
  pruneMemories,
  refreshMemories,
  selectFacts,
  useMemory,
} from './memory.js'
import { roundMessages, type Round } from './serialize.js'
import { estimateTokens } from './tokens.js'
import { recompactSegments } from './summary.js'
import { consumeRecompact } from './windowMigration.js'

/** 每个会话的摘要进度只从 IndexedDB 读一次，之后走内存 */
const assistCache = new Map<string, SessionAssist>()

const getAssist = async (sessionId: string): Promise<SessionAssist | undefined> => {
  const cached = assistCache.get(sessionId)
  if (cached) {
    return cached
  }
  const loaded = await db.loadAssist(sessionId)
  if (loaded) {
    assistCache.set(sessionId, loaded)
  }
  return loaded
}

const rememberAssist = (sessionId: string, assist: SessionAssist) => {
  assistCache.set(sessionId, assist)
  return db.saveAssist(assist)
}

/** 上下文构成，供界面展示「这次请求送了什么」 */
type AssistRuntime = {
  stats: Record<string, AssistStats>
  /** 正在压缩的会话 id */
  compressing: string | null
  /** 压缩进度：长对话第一次发送时可能要压几十段，界面要能看到进展 */
  compress: { sessionId: string; done: number; total: number; reason: CompressReason } | null
  /** 每个会话最近 10 轮的缓存命中率（百分比），用于验证组装改造是否真的省钱 */
  hitRates: Record<string, number[]>
}

export const useAssistRuntime = create<AssistRuntime>(() => ({
  stats: {},
  compressing: null,
  compress: null,
  hitRates: {},
}))

/** 一次回复结束后记录命中率；没有用量数据（例如被中止）时不记 */
export const recordHitRate = (sessionId: string, rate: number | undefined) => {
  if (rate === undefined) {
    return
  }
  useAssistRuntime.setState((state) => ({
    hitRates: {
      ...state.hitRates,
      [sessionId]: [...(state.hitRates[sessionId] ?? []), rate].slice(-10),
    },
  }))
}

const startCompress = (sessionId: string, reason: CompressReason = 'level') =>
  useAssistRuntime.setState({
    compressing: sessionId,
    compress: { sessionId, done: 0, total: 0, reason },
  })

const updateCompress = (sessionId: string, done: number, total: number) =>
  useAssistRuntime.setState((state) =>
    state.compressing === sessionId
      ? { compress: { sessionId, done, total, reason: state.compress?.reason ?? 'level' } }
      : {}
  )

const endCompress = (sessionId: string) => {
  if (useAssistRuntime.getState().compressing !== sessionId) {
    return
  }
  useAssistRuntime.setState({ compressing: null, compress: null })
}

const setStats = (sessionId: string, stats: AssistStats) =>
  useAssistRuntime.setState((state) => ({ stats: { ...state.stats, [sessionId]: stats } }))

/**
 * 为本轮请求组装上下文。返回可直接发给 messages 接口的 messages 与 system。
 *
 * 历史轮次是否压缩、注入哪些记忆都在这里决定，与界面无关。
 * 压缩失败不阻断对话：抛错时退回「不带摘要、只保留最近轮次」的降级路径。
 */
export const buildRequestContext = async (args: {
  sessionId: string
  history: Message[]
  question: UserMessage
  signal: AbortSignal
  /** 会话级前置指令；为空表示本次不注入 */
  prefix?: string
  /** 全部轮次 */
  rounds?: Round[]
}): Promise<{
  /** 只保留需要带原文的轮次，提问与续写由调用方补齐 */
  keptHistory: Message[]
  system: string
  stats: AssistStats
  /** 本轮召回的记忆文本，调用方拼在最后一条用户消息前（T 段） */
  recalled?: string
}> => {
  const { sessionId, history, question, signal, prefix } = args
  const settings = useSettings.getState()
  const rounds = args.rounds ?? getContextRounds(history)
  let assist = await getAssist(sessionId)
  // 用户在上一步已确认「现在整理」：把旧段落合并成一段，这是一次性的前缀变化
  const recompact = consumeRecompact(sessionId)
  if (recompact && assist?.segments?.length) {
    startCompress(sessionId, 'recompact')
    updateCompress(sessionId, 0, 1)
    try {
      const merged = await recompactSegments(assist.segments, signal)
      assist = { ...assist, segments: [merged], summary: merged }
      void rememberAssist(sessionId, assist).catch(() => {})
      updateCompress(sessionId, 1, 1)
    } catch {
      // 精简失败不阻断对话，下次请求仍可重试
    } finally {
      endCompress(sessionId)
    }
  }
  // 不同通道/模型的窗口不同：窗口、输出预留、触发线、目标水位全部从当前模型推导
  const limit = effectiveContextLimit(settings)
  const reserve = outputReserve(settings)
  const previousWindow = assist?.lastContextWindow
  // 换到窗口更小的模型时，压缩提示要说清「为什么突然开始整理」
  const compressReason: CompressReason = recompact
    ? 'recompact'
    : previousWindow !== undefined && limit < previousWindow
      ? 'smallWindow'
      : 'level'
  const scoped = {
    ...settings,
    contextLimit: limit,
    outputReserve: reserve,
    targetRatio: Math.max(0.2, settings.compressAt - 0.2),
    compressReason,
  }

  if (!useMemory.getState().loaded) {
    await loadMemories()
  }
  const facts = settings.memoryEnabled ? useMemory.getState().facts : []
  // system 里只放置顶记忆：普通记忆每次抽取都会变，必须留在尾部
  const pinnedFacts = facts.filter((fact) => fact.pinned)

  const baseOverhead =
    estimateTokens(buildSystemPrompt(settings.persona, pinnedFacts, assist?.summary, prefix)) + 8

  let plan
  let nextAssist: SessionAssist = assist ?? { id: sessionId }
  try {
    const result = await planContext({
      sessionId,
      rounds,
      question: question.content,
      assist,
      settings: scoped,
      overheadTokens: baseOverhead,
      signal,
      onCompressing: (reason) => startCompress(sessionId, reason),
      onCompressProgress: (done, total) => updateCompress(sessionId, done, total),
    })
    plan = result.plan
    nextAssist = { ...result.assist, lastContextWindow: limit }
    // 窗口变化也要落盘，否则重启后切模型时判断不出「窗口变小」
    if (plan.stats.compressed || previousWindow !== limit) {
      void rememberAssist(sessionId, nextAssist).catch(() => {})
    }
  } catch {
    // 压缩失败（断网、限流、被中止）：只用最近轮次，保证这轮还能正常发出去
    const keep = Math.max(2, settings.keepRecent)
    const kept = rounds.slice(Math.max(0, rounds.length - keep))
    plan = {
      keptRounds: kept,
      summary: assist?.summary,
      stats: {
        persona: 0,
        memory: 0,
        summary: assist?.summary ? estimateTokens(assist.summary) : 0,
        history: kept.length,
        historyRounds: kept.length,
        question: estimateTokens(question.content),
        total: baseOverhead,
        budget: Math.max(4096, limit - reserve),
        limit,
        threshold: Math.floor(Math.max(4096, limit - reserve) * settings.compressAt),
        factsUsed: 0,
        droppedRounds: rounds.length - kept.length,
        compressed: false,
      },
    }
  } finally {
    endCompress(sessionId)
  }

  const system = buildSystemPrompt(settings.persona, pinnedFacts, plan.summary, prefix)
  const keptHistory: Message[] = plan.keptRounds.flatMap(([user, reply]) => [user, reply])

  const stats: AssistStats = {
    ...plan.stats,
    memory: 0,
    total: estimateTokens(system) + plan.stats.history + plan.stats.question,
  }
  let recalled: string | undefined
  if (settings.memoryEnabled) {
    const memoryBudget = Math.floor(Math.max(1024, limit * settings.compressAt) * 0.05)
    const used = selectFacts(
      facts.filter((fact) => !fact.pinned),
      question.content,
      memoryBudget
    )
    recalled = used.length
      ? `【相关记忆】回答时自然遵守，不必复述：\n${used
          .map((fact) => `- （${fact.category}）${fact.text}`)
          .join('\n')}`
      : undefined
    stats.memory = recalled ? estimateTokens(recalled) : 0
    stats.factsUsed = used.length
    stats.total += stats.memory
  }
  setStats(sessionId, stats)

  return { keptHistory, system, stats, recalled }
}

/**
 * 回复结束后在后台抽取长期记忆。每累计 memoryEvery 条助手回复才抽一次，
 * 抽完记录位置，下次只处理新增轮次。失败静默，不影响对话。
 */
export const afterReply = async (args: {
  sessionId: string
  history: Message[]
}): Promise<void> => {
  const { sessionId, history } = args
  const settings = useSettings.getState()
  if (!settings.memoryEnabled || !activeKey(settings)) {
    return
  }
  const assist = (await getAssist(sessionId)) ?? { id: sessionId }
  const rounds = getContextRounds(history)
  const since = (assist.repliesSinceMemory ?? 0) + 1
  if (since < settings.memoryEvery) {
    await rememberAssist(sessionId, { ...assist, repliesSinceMemory: since }).catch(() => {})
    return
  }
  const fresh = roundsForMemory(rounds, assist.memoryMessageId, settings.memoryEvery)
  if (fresh.length === 0) {
    await rememberAssist(sessionId, { ...assist, repliesSinceMemory: since }).catch(() => {})
    return
  }
  const result = await extractMemories({
    sessionId,
    rounds: roundMessages(fresh),
  })
  const last = fresh.at(-1)?.[1] as AssistantMessage | undefined
  await rememberAssist(sessionId, {
    ...assist,
    repliesSinceMemory: 0,
    memoryMessageId: last?.id ?? assist.memoryMessageId,
    memoryUpdatedAt: result.added + result.updated > 0 ? Date.now() : assist.memoryUpdatedAt,
  }).catch(() => {})
  await pruneMemories().catch(() => {})
  await refreshMemories().catch(() => {})
}

/** 删除会话、替换历史时清掉内存里的摘要进度 */
export const forgetAssist = (sessionId?: string) => {
  if (sessionId) {
    assistCache.delete(sessionId)
    return
  }
  assistCache.clear()
}

/** 用户手动触发一次记忆整理：把还没抽过的轮次全部抽一遍 */
export const rebuildMemories = async (args: {
  sessionId: string
  history: Message[]
}): Promise<{ added: number; updated: number }> => {
  const { sessionId, history } = args
  const assist = (await getAssist(sessionId)) ?? { id: sessionId }
  const rounds = getContextRounds(history)
  const fresh = roundsForMemory(rounds, assist.memoryMessageId, 1)
  const target = fresh.length > 0 ? fresh : rounds.slice(-12)
  if (target.length === 0) {
    return { added: 0, updated: 0 }
  }
  const result = await extractMemories({
    sessionId,
    rounds: roundMessages(target),
  })
  const last = target.at(-1)?.[1] as AssistantMessage | undefined
  await rememberAssist(sessionId, {
    ...assist,
    repliesSinceMemory: 0,
    memoryMessageId: last?.id ?? assist.memoryMessageId,
    memoryUpdatedAt: Date.now(),
  }).catch(() => {})
  await pruneMemories().catch(() => {})
  return result
}
