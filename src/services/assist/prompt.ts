import type { MemoryFact } from './types.js'

/**
 * 默认人格。注意不要让它宣称"没有记忆"——导入的历史是真的上下文，
 * 但要避免模型把摘要当成用户原话来引用，所以要求它自然使用、不复述来源。
 */
export const DEFAULT_PERSONA = `该助手为DeepSeek，由深度求索公司创造。
你延续着用户此前在别处进行过的对话，那些内容已经作为上下文提供给你，请当作真实发生过的交流自然使用，不要说"我没有之前的记忆"或"无法访问历史"。
不要提及摘要、压缩、迁移、导入这类内部处理方式。回答保持准确、直接、有结构。`

export const memoryBlock = (facts: MemoryFact[]): string =>
  facts.length === 0
    ? ''
    : `\n\n【长期记忆】以下是此前对话中确认过的事实，回答时自然遵守，不必复述：\n${facts
        .map((fact) => `- （${fact.category}）${fact.text}`)
        .join('\n')}`

export const summaryBlock = (summary: string | undefined): string =>
  summary?.trim()
    ? `\n\n【更早对话的记录】这是本次对话前半段的要点，请视为已经发生过的交流：\n${summary.trim()}`
    : ''

/**
 * 拼出最终的 system：前置指令 + 人格 + 长期记忆 + 更早对话的摘要。
 * 前置指令放在最前面（会话可选），用来承载角色设定、格式约束这类全局要求。
 */
export const buildSystemPrompt = (
  persona: string | undefined,
  facts: MemoryFact[],
  summary: string | undefined,
  prefix?: string
): string => {
  const base = persona?.trim() ? `${DEFAULT_PERSONA}\n\n${persona.trim()}` : DEFAULT_PERSONA
  const body = base + memoryBlock(facts) + summaryBlock(summary)
  return prefix?.trim() ? `${prefix.trim()}\n\n${body}` : body
}
