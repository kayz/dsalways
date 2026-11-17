import { completeText } from '../api/client.js'
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
 * 把早前轮次压成摘要。已有摘要会作为输入一起滚动合并，
 * 因此多次压缩不会让摘要无限膨胀，也不会丢掉前面积累的信息。
 */
export const summarizeRounds = async (args: {
  apiKey: string
  previous: string | undefined
  rounds: Round[]
  signal: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<string> => {
  const { apiKey, previous, rounds, signal, onProgress } = args
  if (rounds.length === 0) {
    return previous?.trim() ?? ''
  }
  const chunks = chunkRounds(rounds)
  let rolling = previous?.trim() ?? ''
  for (let index = 0; index < chunks.length; index += 1) {
    if (signal.aborted) {
      break
    }
    onProgress?.(index, chunks.length)
    const body =
      (rolling ? `【已有摘要】\n${rolling}\n\n【本段新增对话】\n` : '【对话内容】\n') +
      chunks[index].map(describeRound).join('\n\n') +
      '\n\n请输出合并后的完整摘要（包含已有摘要中的信息与本段新增信息）。'
    const text = await completeText(
      apiKey,
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
      rolling = text.trim()
    }
  }
  onProgress?.(chunks.length, chunks.length)
  return rolling
}
