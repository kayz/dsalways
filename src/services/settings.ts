import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import type { ChatModel } from './api/types.js'
import {
  isOfficialModel,
  isSiliconFlowModel,
  type ProviderId,
  type SiliconFlowModelId,
} from './providers.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 本机设置，存 localStorage：模型通道与两套 API Key、语言、主题、位置、朗读音色、
 * 深度思考与智能搜索开关、前置指令、侧边栏收起状态
 */
type Settings = {
  apiKey: string | null
  /** 硅基流动的 Key，与官方 Key 分开存，切换通道不丢 */
  siliconflowKey: string | null
  /** 当前使用的通道 */
  provider: ProviderId
  /** 硅基流动下选中的模型 */
  siliconflowModel: SiliconFlowModelId
  /** 官方通道下选中的模型 */
  deepseekModel: ChatModel
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 追加在默认人格之后的自定义人格设定 */
  persona: string
  /** 注入到系统提示最前面的前置指令（会话里可单独开关） */
  prefixPrompt: string
  /** 前置指令默认是否开启；每个会话可以单独覆盖 */
  prefixEnabled: boolean
  /** 长期记忆总开关，关闭后不注入也不自动抽取 */
  memoryEnabled: boolean
  /** 上下文窗口上限（token），按模型不同可调 */
  contextLimit: number
  /** 占用达到这个比例才压缩，0.8 表示 80% */
  compressAt: number
  /** 压缩时保留原文的最近轮次 */
  keepRecent: number
  /** 每累计多少次助手回复抽取一次记忆 */
  memoryEvery: number
  /** 新手引导是否已完成，完成后不再自动弹出 */
  onboardingDone: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  siliconflowKey: 'chat-demo:siliconflow-key',
  provider: 'chat-demo:provider',
  siliconflowModel: 'chat-demo:siliconflow-model',
  deepseekModel: 'chat-demo:deepseek-model',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  persona: 'chat-demo:persona',
  prefixPrompt: 'chat-demo:prefix-prompt',
  prefixEnabled: 'chat-demo:prefix-enabled',
  memoryEnabled: 'chat-demo:memory-enabled',
  contextLimit: 'chat-demo:context-limit',
  compressAt: 'chat-demo:compress-at',
  keepRecent: 'chat-demo:keep-recent',
  memoryEvery: 'chat-demo:memory-every',
  onboardingDone: 'chat-demo:onboarding-done',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 读取数字型设置，越界或非法时退回默认值 */
const readNumber = (key: string, fallback: number, min: number, max: number): number => {
  const value = Number(read(key))
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

/**
 * 1.2.0 及以前把 128000 当默认值写进 localStorage，1M 模型因此被卡在 128K。
 * 新版本默认「跟随模型」（0）。历史值无法区分「没动过」和「手动填了 128000」，
 * 所以只在首次升级时把恰好等于旧默认值的一次性归零，之后用户再填的值都原样保留。
 */
const initialContextLimit = (): number => {
  const raw = read(KEYS.contextLimit)
  if (raw !== '128000') {
    return readNumber(KEYS.contextLimit, 0, 0, 1000000)
  }
  if (read('chat-demo:context-limit-migrated') === '1') {
    return 128000
  }
  write('chat-demo:context-limit-migrated', '1')
  return 0
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  siliconflowKey: read(KEYS.siliconflowKey),
  provider: read(KEYS.provider) === 'siliconflow' ? 'siliconflow' : 'deepseek',
  siliconflowModel: isSiliconFlowModel(read(KEYS.siliconflowModel) ?? '')
    ? (read(KEYS.siliconflowModel) as SiliconFlowModelId)
    : 'deepseek-ai/DeepSeek-V4.1-Flash',
  deepseekModel: isOfficialModel(read(KEYS.deepseekModel) ?? '')
    ? (read(KEYS.deepseekModel) as ChatModel)
    : 'deepseek-flash',
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  persona: read(KEYS.persona) ?? '',
  prefixPrompt: read(KEYS.prefixPrompt) ?? '',
  prefixEnabled: read(KEYS.prefixEnabled) === 'true',
  // 默认开启：新手最需要的是"它记得我"，而不是省 token
  memoryEnabled: read(KEYS.memoryEnabled) !== 'false',
  contextLimit: initialContextLimit(),
  compressAt: readNumber(KEYS.compressAt, 0.6, 0.3, 0.95),
  keepRecent: readNumber(KEYS.keepRecent, 10, 2, 200),
  memoryEvery: readNumber(KEYS.memoryEvery, 6, 1, 100),
  onboardingDone: read(KEYS.onboardingDone) === 'true',
}))

/** 当前通道真正用于请求的 Key */
export const activeKey = (state: Pick<Settings, 'provider' | 'apiKey' | 'siliconflowKey'>) =>
  (state.provider === 'siliconflow' ? state.siliconflowKey : state.apiKey) ?? ''

export const setProvider = (provider: ProviderId) => {
  write(KEYS.provider, provider)
  useSettings.setState({ provider })
}

export const setSiliconflowKey = (siliconflowKey: string | null) => {
  write(KEYS.siliconflowKey, siliconflowKey)
  useSettings.setState({ siliconflowKey })
}

export const setSiliconflowModel = (siliconflowModel: SiliconFlowModelId) => {
  write(KEYS.siliconflowModel, siliconflowModel)
  useSettings.setState({ siliconflowModel })
}

export const setDeepseekModel = (deepseekModel: ChatModel) => {
  write(KEYS.deepseekModel, deepseekModel)
  useSettings.setState({ deepseekModel })
}

export const setPrefixPrompt = (prefixPrompt: string) => {
  write(KEYS.prefixPrompt, prefixPrompt)
  useSettings.setState({ prefixPrompt })
}

export const setPrefixEnabled = (prefixEnabled: boolean) => {
  write(KEYS.prefixEnabled, String(prefixEnabled))
  useSettings.setState({ prefixEnabled })
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setPersona = (persona: string) => {
  write(KEYS.persona, persona)
  useSettings.setState({ persona })
}

export const setMemoryEnabled = (memoryEnabled: boolean) => {
  write(KEYS.memoryEnabled, String(memoryEnabled))
  useSettings.setState({ memoryEnabled })
}

export const setContextLimit = (contextLimit: number) => {
  write(KEYS.contextLimit, String(contextLimit))
  useSettings.setState({ contextLimit })
}

export const setCompressAt = (compressAt: number) => {
  write(KEYS.compressAt, String(compressAt))
  useSettings.setState({ compressAt })
}

export const setKeepRecent = (keepRecent: number) => {
  write(KEYS.keepRecent, String(keepRecent))
  useSettings.setState({ keepRecent })
}

export const setMemoryEvery = (memoryEvery: number) => {
  write(KEYS.memoryEvery, String(memoryEvery))
  useSettings.setState({ memoryEvery })
}

export const setOnboardingDone = (onboardingDone: boolean) => {
  write(KEYS.onboardingDone, String(onboardingDone))
  useSettings.setState({ onboardingDone })
}
