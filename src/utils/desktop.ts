/**
 * 桌面外壳（Electron）注入的桥接能力。纯浏览器里整个对象是 undefined，
 * 所有调用点都要先判断，保证同一份前端在两种环境都能跑。
 */
export type UpdatePhase =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateState = {
  phase: UpdatePhase
  currentVersion: string
  version: string | null
  notes: string | null
  percent: number
  message: string | null
  canCheck: boolean
}

export type ElectronBridge = {
  readClipboard?: () => Promise<string>
  pickImportFile?: () => Promise<string | null>
  openExternal?: (url: string) => Promise<void>
  platform?: string
  version?: string

  updateState?: () => Promise<UpdateState>
  updateCheck?: () => Promise<UpdateState>
  updateDownload?: () => Promise<UpdateState>
  updateInstall?: () => Promise<boolean>
  openReleasePage?: () => Promise<void>
  onUpdateStatus?: (callback: (state: UpdateState) => void) => () => void
}

export const desktop = (): ElectronBridge | undefined =>
  (globalThis as { porter?: ElectronBridge }).porter

/** 是否运行在桌面外壳里（而不是浏览器 / 网页版） */
export const isDesktop = (): boolean => desktop() !== undefined
