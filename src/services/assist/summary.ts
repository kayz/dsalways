import { completeInternal } from '../api/internal.js'
import type { CreateMessageRequest } from '../api/types.js'
import { describeRound, type Round } from './serialize.js'
import { estimateTokens } from './tokens.js'

const SUMMARY_SYSTEM = `你是一个"对话记忆压缩器"。把一段很长的对话压缩成结构化笔记，供以后继续这段对话时当作上下文。

规则：
1. 必须保留一切具体信息：人名、项目名、产品名、文件路径、命令、数值、日期、结论、已确认的决定。
2. 保留用户的偏好、约束、语气要求、禁忌。
3. 失败的尝试保留为"试过 X，因 Y 无效"，这同样是有用信息。
4. 删除寒暄、重复确认、无信息量的过程。
5. 代码或数据只保留关键片段与作用，不要整段抄录。
6. 用条目式中文直接给内容，不要写"这段对话讨论了…"这类元叙述。
7. 总长度控制在 1200 字以内。`

/** 单段送进摘要器的 token 上限；超过就切成多段顺序滚动 */
const CHUNK_TOKENS = 6000

const chunkRounds = (rounds: Round[]): Round[][] => {
  const chunks: Round[][] = []
  let current: Round[] = []
  let used = 0
  for (const round of rounds) {
    const cost = Math.min(estimateTokens(describeRound(round)), 3000) + 8
    if (current.length > 0 && used + cost > CHUNK_TOKENS) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(round)
    used += cost
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

/**
 * 把早前轮次压成**不可变段落**。
 *
 * 1.2.0 是滚动合并：新摘要 = 旧摘要 + 新段落重写，每次压缩后 system 里几千 token 全变，
 * 前缀缓存整段作废。现在每段独立产出、落盘后永不改动，压缩只往末尾追加新段，
 * 前面所有段落（以及跟着它们的原文）都还能命中缓存。
 *
 * 1.2.0 遗留的滚动摘要无法拆分，作为「第 0 段」整体保留，不重写。
 */
export const summarizeRounds = async (args: {
  segments: string[]
  legacySummary?: string
  rounds: Round[]
  signal: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<{ segments: string[]; text: string }> => {
  const { segments, legacySummary, rounds, signal, onProgress } = args
  const result = [...segments]
  if (result.length === 0 && legacySummary?.trim()) {
    result.push(legacySummary.trim())
  }
  if (rounds.length === 0) {
    return { segments: result, text: result.join('\n\n') }
  }
  const chunks = chunkRounds(rounds)
  for (let index = 0; index < chunks.length; index += 1) {
    if (signal.aborted) {
      break
    }
    onProgress?.(index, chunks.length)
    const body =
      `【对话内容】\n${chunks[index].map(describeRound).join('\n\n')}` +
      '\n\n请输出本段的完整要点笔记（包含具体信息与已确认的决定），不要写「这段对话讨论了…」。'
    const text = await completeInternal(
      {
        model: 'deepseek-flash',
        system: SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: body }],
        thinking: { type: 'disabled' },
        tools: [],
        safety_check: { level: 'high' },
      } as CreateMessageRequest,
      signal
    )
    if (text.trim()) {
      result.push(text.trim())
    }
  }
  onProgress?.(chunks.length, chunks.length)
  return { segments: result, text: result.join('\n\n') }
}

/**
 * 摘要二次精简：把若干不可变段落合并成一段。
 * 只在「换到窗口更小的模型、且用户点了确认」时执行一次，代价是这一段前缀变化一次。
 */
export const recompactSegments = async (
  segments: string[],
  signal: AbortSignal
): Promise<string> => {
  const body =
    segments.map((text, index) => `【第 ${index + 1} 段】\n${text}`).join('\n\n') +
    '\n\n请把以上笔记合并成一份完整要点，保留所有具体信息与已确认的决定，不要遗漏。'
  const text = await completeInternal(
    {
      model: 'deepseek-flash',
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: body }],
      thinking: { type: 'disabled' },
      tools: [],
      safety_check: { level: 'high' },
    } as CreateMessageRequest,
    signal
  )
  return text.trim() || segments.join('\n\n')
}
