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
    summary: '同一把 Key 可切四个 DeepSeek 模型；不支持附件与内置搜索。',
  },
]

export const providerInfo = (id: ProviderId): ProviderInfo =>
  PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0]

/** 硅基流动提供的四个模型（刻意只列这几个，避免用户在九十多个模型里选错） */
export type SiliconFlowModelId =
  | 'deepseek-ai/DeepSeek-V4.1-Flash'
  | 'deepseek-ai/DeepSeek-V4-Pro'
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
 * 上下文窗口对照（2026-11-18 用真实 Key 对 /v1/models 与 chat/completions 实测，四个模型均 HTTP 200）：
 * - V4.1-Flash：1M，便宜最快；不传参数时服务端可能带上少量思考，传 enable_thinking=false 可彻底关掉
 * - V4-Pro：1M，旗舰推理，默认带思考，enable_thinking 可开关
 * - V3.2：164K，默认不思考，enable_thinking 可开关
 * - R1：164K，始终思考；传 enable_thinking=false 无效，会把推理内容写进正文，所以界面不给开关
 * 另外四个模型都接受 thinking_budget（128~32768），当前不用它，避免和 enable_thinking 打架。
 */
export const SILICONFLOW_MODELS: SiliconFlowModel[] = [
  {
    id: 'deepseek-ai/DeepSeek-V4.1-Flash',
    label: 'V4.1 Flash',
    contextWindow: 1048576,
    maxOutput: 16384,
    thinking: 'none',
    inlineSystem: false,
    hint: '速度最快、价格最低',
  },
  {
    id: 'deepseek-ai/DeepSeek-V4-Pro',
    label: 'V4 Pro',
    contextWindow: 1048576,
    maxOutput: 16384,
    thinking: 'switchable',
    inlineSystem: false,
    hint: '旗舰推理，能力最强但价格最高',
  },
  {
    id: 'deepseek-ai/DeepSeek-V3.2',
    label: 'V3.2',
    contextWindow: 163840,
    maxOutput: 16384,
    thinking: 'switchable',
    inlineSystem: false,
    hint: '可开关深度思考',
  },
  {
    id: 'deepseek-ai/DeepSeek-R1',
    label: 'R1',
    contextWindow: 163840,
    maxOutput: 16384,
    thinking: 'always',
    inlineSystem: true,
    hint: '始终思考，推理更细但更慢',
  },
]

export const isSiliconFlowModel = (value: string): value is SiliconFlowModelId =>
  SILICONFLOW_MODELS.some((model) => model.id === value)

export const siliconFlowModel = (id: SiliconFlowModelId): SiliconFlowModel =>
  SILICONFLOW_MODELS.find((model) => model.id === id) ?? SILICONFLOW_MODELS[0]

export type OfficialModelOption = {
  id: ChatModel
  label: string
  contextWindow: number
  /** 单次请求给输出留的上限 */
  maxOutput: number
  hint: string
}

/**
 * 官方通道可选的模型。
 * 官方接口（`/anthropic/v1/messages`）的 `model` 只接受 `deepseek-flash` 与
 * `deepseek-v4-pro` 两个值，两者都是 1M 上下文、都支持 thinking 开关。
 */
export const DEEPSEEK_MODELS: OfficialModelOption[] = [
  {
    id: 'deepseek-flash',
    label: 'V4 Flash',
    contextWindow: 1048576,
    maxOutput: 16384,
    hint: '速度快、价格低',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'V4 Pro',
    contextWindow: 1048576,
    maxOutput: 16384,
    hint: '旗舰推理，更贵更慢',
  },
]

export const isOfficialModel = (value: string): value is ChatModel =>
  DEEPSEEK_MODELS.some((model) => model.id === value)

export const officialModel = (id: ChatModel): OfficialModelOption =>
  DEEPSEEK_MODELS.find((model) => model.id === id) ?? DEEPSEEK_MODELS[0]

export type WindowSettings = {
  provider: ProviderId
  /** 0 表示跟随当前模型，不设人为上限 */
  contextLimit: number
  siliconflowModel: SiliconFlowModelId
  deepseekModel: ChatModel
}

/** 当前模型的上下文窗口（1M 或 164K） */
export const modelContextWindow = (settings: WindowSettings): number =>
  settings.provider === 'siliconflow'
    ? siliconFlowModel(settings.siliconflowModel).contextWindow
    : officialModel(settings.deepseekModel).contextWindow

/**
 * 本次请求实际可用的上下文窗口。
 * 用户设置的是「上限」（0 = 跟随模型），任何通道都不能超过模型本身的窗口。
 * 早期 1.2.0 用全局 128K 兜底，导致 1M 模型被提前压缩，这里改为直接取模型窗口。
 */
export const effectiveContextLimit = (settings: WindowSettings): number =>
  Math.min(
    settings.contextLimit > 0 ? settings.contextLimit : modelContextWindow(settings),
    modelContextWindow(settings)
  )

/**
 * 给回复预留的输出空间，从窗口里先扣掉再谈「能装多少上下文」。
 * 硅基流动发的是 model.maxOutput；R1 恒思考，额外留一份思维链预算（与
 * siliconflow.ts 的 thinking_budget 一致，最多 8192）。
 */
export const outputReserve = (settings: WindowSettings): number => {
  if (settings.provider !== 'siliconflow') {
    return officialModel(settings.deepseekModel).maxOutput
  }
  const model = siliconFlowModel(settings.siliconflowModel)
  return model.maxOutput + (model.thinking === 'always' ? 8192 : 0)
}

/** 官方通道的默认模型 */
export const DEEPSEEK_MODEL: ChatModel = 'deepseek-flash'
