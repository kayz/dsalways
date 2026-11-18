import { create } from 'zustand'
import * as db from '../chat/db.js'
import { effectiveContextLimit, outputReserve, type WindowSettings } from '../providers.js'
import { estimateTokens } from './tokens.js'

/**
 * 「换个模型，要先整理一下旧对话」的确认流程。
 *
 * 切换**延迟生效**：弹窗期间通道和模型都还没落盘，点「先不换」直接 return，
 * 界面与实际使用模型始终一致；只有确认后才把这次精简标记为待执行。
 */
export type RecompactRequest = {
  sessionId: string
  /** 目标模型的界面短名，文案里用得到 */
  toLabel: string
}

export const useRecompact = create<{ request: RecompactRequest | null }>(() => ({
  request: null,
}))

let resolver: ((ok: boolean) => void) | null = null
/** 已确认、等下一次请求真正执行的会话 */
const confirmed = new Set<string>()

export const askRecompact = (request: RecompactRequest): Promise<boolean> =>
  new Promise((resolve) => {
    resolver = resolve
    useRecompact.setState({ request })
  })

export const answerRecompact = (ok: boolean): void => {
  const request = useRecompact.getState().request
  useRecompact.setState({ request: null })
  if (ok && request) {
    confirmed.add(request.sessionId)
  }
  resolver?.(ok)
  resolver = null
}

/** 取出并执行一次已确认的精简；消费后不会重复执行 */
export const consumeRecompact = (sessionId: string): boolean => confirmed.delete(sessionId)

/**
 * 切到目标模型后，已有的段落摘要是否会超过 20% 内容预算。
 * 只有「摘要本身装不下」才需要弹窗；原文多出来的部分由压缩预算自动砍掉，不打断用户。
 */
export const needsRecompact = async (
  sessionId: string,
  target: WindowSettings
): Promise<boolean> => {
  const assist = await db.loadAssist(sessionId)
  const text = assist?.segments?.length ? assist.segments.join('\n\n') : (assist?.summary ?? '')
  if (!text.trim()) {
    return false
  }
  const contentBudget = Math.max(4096, effectiveContextLimit(target) - outputReserve(target))
  return estimateTokens(text) > Math.floor(contentBudget * 0.2)
}
