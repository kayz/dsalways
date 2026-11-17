import type { ChatModel } from './api/types.js'

/**
 * 模型接入商。DeepSeek 官方走 Anthropic 兼容接口（有内置搜索、Files 上传、自动标题），
 * 硅基流动走 OpenAI 兼容接口（只有纯对话）。两边的 Key、模型、能力都不同，所以显式分层。
 */
export type ProviderId = 'deepseek' | 'siliconflow'

export type ProviderInfo = {
  id: ProviderId
  /** 界面上的名字 */
  label: string
  /** 申请 Key 的入口 */
  keyUrl: string
  /** 没有账号时的注册入口（邀请链接） */
  signupUrl: string
  /** 一句话说明这个通道能做什么、不能做什么 */
  summary: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    signupUrl: 'https://platform.deepseek.com/sign_up',
    summary: '支持内置联网搜索、附件上传、自动标题，按官方价格计费。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    signupUrl: 'https://cloud.siliconflow.cn/i/krMQmOJV',
    summary: '同一把 Key 可切三个 DeepSeek 模型；不支持附件与内置搜索。',
  },
]

export const providerInfo = (id: ProviderId): ProviderInfo =>
  PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0]

/** 硅基流动提供的三个模型（刻意只放这三个，避免用户在几十个模型里选错） */
export type SiliconFlowModelId =
  | 'deepseek-ai/DeepSeek-V4.1-Flash'
  | 'deepseek-ai/DeepSeek-V3.2'
  | 'deepseek-ai/DeepSeek-R1'

export type SiliconFlowModel = {
  id: SiliconFlowModelId
  /** 界面上的短名字 */
  label: string
  /** 上下文窗口（token），取自 SiliconFlow 模型页的 context length */
  contextWindow: number
  /** 单次请求的 max_tokens 上限；按模型文档的「最大回复长度」取，留有余量 */
  maxOutput: number
  /** 思考模式：always = 始终思考，switchable = 可用 enable_thinking 开关，none = 不支持 */
  thinking: 'always' | 'switchable' | 'none'
  /** 是否建议把系统提示并进用户消息（R1 官方建议不加 system） */
  inlineSystem: boolean
  /** 界面提示 */
  hint: string
}

/**
 * 上下文窗口对照（查自 SiliconFlow 模型页）：
 * - V4.1-Flash：1049K，最大输出 393K，不支持开关思考
 * - V3.2：164K，支持 enable_thinking
 * - R1：164K（最大思维链 65536，最大回复 16384），始终思考
 */
export const SILICONFLOW_MODELS: SiliconFlowModel[] = [
  {
    id: 'deepseek-ai/DeepSeek-V4.1-Flash',
    label: 'V4.1 Flash',
    contextWindow: 1048576,
    maxOutput: 16384,
    thinking: 'none',
    inlineSystem: false,
    hint: '1M 上下文，速度最快、价格最低',
  },
  {
    id: 'deepseek-ai/DeepSeek-V3.2',
    label: 'V3.2',
    contextWindow: 163840,
    maxOutput: 16384,
    thinking: 'switchable',
    inlineSystem: false,
    hint: '164K 上下文，可开关深度思考',
  },
  {
    id: 'deepseek-ai/DeepSeek-R1',
    label: 'R1',
    contextWindow: 163840,
    maxOutput: 16384,
    thinking: 'always',
    inlineSystem: true,
    hint: '164K 上下文，始终思考，推理更细但更慢',
  },
]

export const isSiliconFlowModel = (value: string): value is SiliconFlowModelId =>
  SILICONFLOW_MODELS.some((model) => model.id === value)

export const siliconFlowModel = (id: SiliconFlowModelId): SiliconFlowModel =>
  SILICONFLOW_MODELS.find((model) => model.id === id) ?? SILICONFLOW_MODELS[0]

/** DeepSeek 官方的上下文窗口，用于兜底 */
const DEEPSEEK_CONTEXT_WINDOW = 128000

/**
 * 本次请求实际可用的上下文窗口。
 * 用户设置的是「上限」，任何通道都不能超过模型本身的窗口——早期模型的 64K/164K
 * 一旦被当成 128K 用，请求会被服务端直接拒绝，所以这里取两者较小值。
 */
export const effectiveContextLimit = (settings: {
  provider: ProviderId
  contextLimit: number
  siliconflowModel: SiliconFlowModelId
}): number => {
  const userLimit = settings.contextLimit > 0 ? settings.contextLimit : DEEPSEEK_CONTEXT_WINDOW
  if (settings.provider !== 'siliconflow') {
    // 官方通道沿用用户设置，不改动既有行为
    return userLimit
  }
  return Math.min(userLimit, siliconFlowModel(settings.siliconflowModel).contextWindow)
}

/** 当前通道使用的 DeepSeek 模型 id（官方通道只有一个 flash 入口） */
export const DEEPSEEK_MODEL: ChatModel = 'deepseek-flash'
