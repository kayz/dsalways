import { create } from 'zustand'
import { getContextRounds } from '../chat/reply.js'
import type { AssistantMessage, Message, UserMessage } from '../chat/types.js'
import * as db from '../chat/db.js'
import { activeKey, useSettings } from '../settings.js'
import { effectiveContextLimit } from '../providers.js'
import { planContext, roundsForMemory } from './context.js'
import type { AssistStats, SessionAssist } from './types.js'
import { buildSystemPrompt } from './prompt.js'
import { extractMemories, loadMemories, pruneMemories, refreshMemories, selectFacts, useMemory } from './memory.js'
import { roundMessages, type Round } from './serialize.js'
import { estimateTokens } from './tokens.js'

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
  compress: { sessionId: string; done: number; total: number } | null
}

export const useAssistRuntime = create<AssistRuntime>(() => ({
  stats: {},
  compressing: null,
  compress: null,
}))

const startCompress = (sessionId: string) =>
  useAssistRuntime.setState({
    compressing: sessionId,
    compress: { sessionId, done: 0, total: 0 },
  })

const updateCompress = (sessionId: string, done: number, total: number) =>
  useAssistRuntime.setState((state) =>
    state.compressing === sessionId ? { compress: { sessionId, done, total } } : {}
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
}> => {
  const { sessionId, history, question, signal, prefix } = args
  const settings = useSettings.getState()
  const rounds = args.rounds ?? getContextRounds(history)
  // 不同通道/模型的窗口不同，压缩阈值必须按实际可用窗口算
  const limit = effectiveContextLimit(settings)
  const scoped = { ...settings, contextLimit: limit }

  if (!useMemory.getState().loaded) {
    await loadMemories()
  }
  const facts = settings.memoryEnabled ? useMemory.getState().facts : []

  const assist = await getAssist(sessionId)
  const baseOverhead =
    estimateTokens(buildSystemPrompt(settings.persona, facts, assist?.summary, prefix)) + 8

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
      onCompressing: () => startCompress(sessionId),
      onCompressProgress: (done, total) => updateCompress(sessionId, done, total),
    })
    plan = result.plan
    nextAssist = result.assist
    if (plan.stats.compressed) {
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
        budget: limit,
        limit,
        threshold: Math.floor(limit * settings.compressAt),
        factsUsed: 0,
        droppedRounds: rounds.length - kept.length,
        compressed: false,
      },
    }
  } finally {
    endCompress(sessionId)
  }

  const system = buildSystemPrompt(settings.persona, facts, plan.summary, prefix)
  const keptHistory: Message[] = plan.keptRounds.flatMap(([user, reply]) => [user, reply])

  const stats: AssistStats = {
    ...plan.stats,
    memory: 0,
    total: estimateTokens(system) + plan.stats.history + plan.stats.question,
  }
  if (settings.memoryEnabled) {
    const memoryBudget = Math.floor(Math.max(1024, limit * settings.compressAt) * 0.12)
    const used = selectFacts(facts, question.content, memoryBudget)
    stats.memory = used.reduce((sum, fact) => sum + estimateTokens(fact.text), 0)
    stats.factsUsed = used.length
    stats.total += stats.memory
  }
  setStats(sessionId, stats)

  return { keptHistory, system, stats }
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
