import { getReplyText } from '../chat/reply.js'
import type { AssistantMessage, UserMessage } from '../chat/types.js'

export type Round = [UserMessage, AssistantMessage]

/** 一轮对话的纯文本形态；附件只提示存在，正文里不展开二进制内容 */
export const describeRound = ([user, reply]: Round): string => {
  const files = user.files.length > 0 ? `（附 ${user.files.length} 个文件：${user.files.map((file) => file.name).join('、')}）` : ''
  const question = user.content.trim() || '（无文字，只发了附件）'
  const answer = getReplyText(reply).trim() || '（未产生回答）'
  return `【用户】${question}${files}\n【助手】${answer}`
}

/** 抽取记忆时用的扁平消息序列，按发生顺序展开 */
export const roundMessages = (
  rounds: Round[]
): { who: 'user' | 'assistant'; text: string }[] =>
  rounds.flatMap(([user, reply]) => [
    { who: 'user' as const, text: user.content },
    { who: 'assistant' as const, text: getReplyText(reply) },
  ])
