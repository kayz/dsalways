/** 长期记忆的类别，与提示词里的枚举保持一致 */
export type MemoryCategory = '身份' | '偏好' | '项目' | '技术' | '约定' | '结论' | '待办' | '其他'

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  '身份',
  '偏好',
  '项目',
  '技术',
  '约定',
  '结论',
  '待办',
  '其他',
]

/** 一条长期记忆；文本用陈述句，主语明确 */
export type MemoryFact = {
  id: string
  category: MemoryCategory
  text: string
  createdAt: number
  updatedAt: number
  /** 被重复抽取到的次数，参与注入排序 */
  weight: number
  /** 手动置顶的记忆一定注入 */
  pinned?: boolean
  sourceSessionId?: string
}

/**
 * 每个会话的辅助状态：滚动摘要与记忆抽取进度，与会话分开存储，
 * 这样导出历史时不会把内部状态写进归档。
 */
export type SessionAssist = {
  /** 与会话 id 相同 */
  id: string
  /** 更早轮次的压缩记录 */
  summary?: string
  /** 摘要覆盖到的最后一条消息 id，用于判断哪些轮次还没压缩 */
  coversMessageId?: string
  coversCount?: number
  summaryTokens?: number
  summaryUpdatedAt?: number
  /** 记忆抽取覆盖到的最后一条消息 id */
  memoryMessageId?: string
  /** 上次抽取后新增的助手回复数 */
  repliesSinceMemory?: number
  /** 上次抽取时给出的提示，界面可以展示「已整理」状态 */
  memoryUpdatedAt?: number
}

/** 一次请求的上下文构成，用于向用户解释 token 花在哪 */
export type AssistStats = {
  /** 人格设定 */
  persona: number
  /** 长期记忆 */
  memory: number
  /** 更早对话的摘要 */
  summary: number
  /** 原文轮次 */
  history: number
  /** 原文轮数 */
  historyRounds: number
  /** 本轮提问 */
  question: number
  total: number
  /** 可用于上下文的预算 */
  budget: number
  limit: number
  /** 达到这个值就压缩 */
  threshold: number
  /** 注入的记忆条数 */
  factsUsed: number
  /** 因预算被省略的原文字数（约等于） */
  droppedRounds: number
  /** 本次是否触发了新的压缩 */
  compressed: boolean
}
