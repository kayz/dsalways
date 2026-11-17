import { create } from 'zustand'
import { completeText } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import * as db from '../chat/db.js'
import { estimateTokens } from './tokens.js'
import { MEMORY_CATEGORIES, type MemoryCategory, type MemoryFact } from './types.js'

const EXTRACT_SYSTEM = `你是"长期记忆提取器"。从对话中提取对以后继续交流长期有用的事实。

只提取这几类：
- 身份：用户的姓名、职业、所在城市、角色
- 偏好：喜欢或讨厌的表达方式、格式要求、禁忌
- 项目：正在做的事情、目标、进度、关键约束
- 技术：技术栈、环境、路径、工具版本、已确定的方案
- 约定：双方达成的规则、命名、流程
- 结论：已经确认的事实或决定
- 待办：明确要后续完成的事

不要提取：一次性的寒暄、临时的中间结果、泛泛而谈的内容、助手自己编造的信息。

每条事实不超过 60 字，用陈述句，主语明确（"用户…"或"该项目…"）。
category 只能是上述七个词之一。`

const EXTRACT_SCHEMA = `只输出 JSON 数组，不要任何解释和代码块标记。格式：
[{"category":"项目","text":"用户正在做 X，目标 Y"}]`

/** 记忆条数上限，超出后按权重与时间淘汰未置顶的 */
const MEMORY_LIMIT = 400

const readJsonArray = (text: string): { category?: string; text?: string }[] => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as { category?: string; text?: string }[]) : []
  } catch {
    return []
  }
}

const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

const bigrams = (text: string): Set<string> => {
  const chars = Array.from(text)
  const set = new Set<string>()
  for (let i = 0; i < chars.length - 1; i += 1) {
    set.add(chars[i] + chars[i + 1])
  }
  return set
}

/** 用 bigram 重合度判断两条记忆是不是同一件事 */
const similarity = (a: string, b: string): number => {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) {
    return a === b ? 1 : 0
  }
  let shared = 0
  for (const gram of left) {
    if (right.has(gram)) {
      shared += 1
    }
  }
  return shared / Math.min(left.size, right.size)
}

const createId = () =>
  `mf_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

/** 把新抽到的事实并进已有记忆：重复的加权并保留更完整的那条 */
export const mergeFacts = (
  existing: MemoryFact[],
  items: { category?: string; text?: string }[],
  sourceSessionId?: string
): { writes: MemoryFact[]; added: number; updated: number } => {
  const now = Date.now()
  const writes: MemoryFact[] = []
  let added = 0
  let updated = 0
  for (const raw of items) {
    const text = (raw.text ?? '').trim().slice(0, 120)
    if (text.length < 4) {
      continue
    }
    const category: MemoryCategory = MEMORY_CATEGORIES.includes(raw.category as MemoryCategory)
      ? (raw.category as MemoryCategory)
      : '其他'
    const key = normalize(text)
    const hit = existing.find(
      (fact) => normalize(fact.text) === key || similarity(normalize(fact.text), key) > 0.72
    )
    if (hit) {
      if (text.length > hit.text.length) {
        hit.text = text
        hit.category = category
      }
      hit.weight = Math.min(20, hit.weight + 1)
      hit.updatedAt = now
      writes.push({ ...hit })
      updated += 1
      continue
    }
    const fact: MemoryFact = {
      id: createId(),
      category,
      text,
      createdAt: now,
      updatedAt: now,
      weight: 1,
      sourceSessionId,
    }
    existing.push(fact)
    writes.push(fact)
    added += 1
  }
  return { writes, added, updated }
}

/** 记忆面板与注入共用一份内存副本 */
type MemoryState = {
  facts: MemoryFact[]
  loaded: boolean
  /** 正在抽取记忆的会话 id，界面据此显示进度 */
  extracting: string | null
}

export const useMemory = create<MemoryState>(() => ({
  facts: [],
  loaded: false,
  extracting: null,
}))

export const loadMemories = async (): Promise<void> => {
  const facts = (await db.loadMemories()).sort((a, b) => b.updatedAt - a.updatedAt)
  useMemory.setState({ facts, loaded: true })
}

export const refreshMemories = async (): Promise<void> => {
  useMemory.setState({ facts: await db.loadMemories() })
}

export const removeMemory = async (id: string): Promise<void> => {
  await db.deleteMemory(id)
  await refreshMemories()
}

export const toggleMemoryPin = async (id: string): Promise<void> => {
  const fact = useMemory.getState().facts.find((item) => item.id === id)
  if (!fact) {
    return
  }
  const next = { ...fact, pinned: !fact.pinned }
  await db.saveMemories([next])
  await refreshMemories()
}

export const clearMemories = async (): Promise<void> => {
  await db.clearMemories()
  useMemory.setState({ facts: [] })
}

/**
 * 从一段对话里抽取长期事实。失败时静默返回 0：记忆是增强项，
 * 不能因为抽取失败打断用户正在进行的对话。
 */
export const extractMemories = async (args: {
  apiKey: string
  sessionId: string
  rounds: { who: 'user' | 'assistant'; text: string }[]
  signal?: AbortSignal
}): Promise<{ added: number; updated: number }> => {
  const { apiKey, sessionId, rounds, signal } = args
  if (rounds.length === 0) {
    return { added: 0, updated: 0 }
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  const body =
    rounds
      .map(({ who, text }) => {
        const clipped = text.length > 2500 ? `${text.slice(0, 2500)}…` : text
        return `【${who === 'user' ? '用户' : '助手'}】${clipped}`
      })
      .join('\n\n') +
    '\n\n' +
    EXTRACT_SCHEMA

  try {
    useMemory.setState({ extracting: sessionId })
    const text = await completeText(
      apiKey,
      {
        model: 'deepseek-flash',
        system: EXTRACT_SYSTEM,
        messages: [{ role: 'user', content: body }],
        thinking: { type: 'disabled' },
        tools: [],
        safety_check: { level: 'high' },
      } as CreateMessageRequest,
      controller.signal
    )
    const items = readJsonArray(text)
    if (items.length === 0) {
      return { added: 0, updated: 0 }
    }
    const existing = [...useMemory.getState().facts]
    const { writes, added, updated } = mergeFacts(existing, items, sessionId)
    await db.saveMemories(writes)
    await refreshMemories()
    return { added, updated }
  } catch {
    return { added: 0, updated: 0 }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (useMemory.getState().extracting === sessionId) {
      useMemory.setState({ extracting: null })
    }
  }
}

/** 相关性打分：置顶 > 重复次数 > 新鲜度 > 与当前提问的字面重合 */
const scoreFact = (fact: MemoryFact, query: string): number => {
  let score = fact.pinned ? 6 : 0
  score += Math.min(3, fact.weight * 0.6)
  const ageDays = (Date.now() - fact.updatedAt) / 86400000
  score += Math.max(0, 2 - ageDays / 30)
  if (!query) {
    return score
  }
  const text = fact.text.toLowerCase()
  const q = query.toLowerCase()
  const chars = Array.from(q)
  for (let i = 0; i < chars.length - 1; i += 1) {
    const gram = chars[i] + chars[i + 1]
    if (/[\u4e00-\u9fff]/.test(gram[0]) && /[\u4e00-\u9fff]/.test(gram[1]) && text.includes(gram)) {
      score += 1.2
    }
  }
  for (const word of q.match(/[a-z0-9_\-.]{3,}/g) ?? []) {
    if (text.includes(word)) {
      score += 1.5
    }
  }
  return score
}

/** 在 token 预算内挑选最相关的记忆 */
export const selectFacts = (
  facts: MemoryFact[],
  query: string,
  budgetTokens: number
): MemoryFact[] => {
  const ranked = facts
    .map((fact) => ({ fact, score: scoreFact(fact, query) }))
    .sort((a, b) => b.score - a.score)
  const picked: MemoryFact[] = []
  let used = 0
  for (const { fact } of ranked) {
    const cost = estimateTokens(fact.text) + 8
    if (used + cost > budgetTokens) {
      continue
    }
    picked.push(fact)
    used += cost
  }
  return picked
}

/** 超出上限时淘汰最弱且未置顶的记忆 */
export const pruneMemories = async (): Promise<void> => {
  const facts = await db.loadMemories()
  if (facts.length <= MEMORY_LIMIT) {
    return
  }
  const drop = facts
    .filter((fact) => !fact.pinned)
    .sort((a, b) => a.weight - b.weight || a.updatedAt - b.updatedAt)
    .slice(0, facts.length - MEMORY_LIMIT)
  for (const fact of drop) {
    await db.deleteMemory(fact.id)
  }
  await refreshMemories()
}
