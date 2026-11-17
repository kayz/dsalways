import { create } from 'zustand'
import { desktop, type UpdateState } from '../utils/desktop.js'

const initial: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  version: null,
  notes: null,
  percent: 0,
  message: null,
  canCheck: true,
}

export const useUpdater = create<UpdateState>(() => initial)

let subscribed = false

/**
 * 订阅主进程的更新状态。幂等，重复调用只生效一次。
 * 主进程那边把状态以「全量快照」推送过来，这里直接覆盖即可。
 */
export const initUpdater = async (): Promise<void> => {
  const api = desktop()
  if (!api?.updateState) {
    return
  }

  if (!subscribed) {
    subscribed = true
    api.onUpdateStatus?.((state) => {
      useUpdater.setState(state)
    })
  }
  try {
    useUpdater.setState(await api.updateState())
  } catch {
    // 拿不到就维持初始状态，界面照样渲染
  }
}

export const checkUpdate = async (): Promise<void> => {
  const api = desktop()
  if (!api?.updateCheck) {
    return
  }
  useUpdater.setState({ phase: 'checking', message: null })
  try {
    useUpdater.setState(await api.updateCheck())
  } catch (error) {
    useUpdater.setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export const downloadUpdate = async (): Promise<void> => {
  const api = desktop()
  if (!api?.updateDownload) {
    return
  }
  useUpdater.setState({ phase: 'downloading', percent: 0 })
  try {
    useUpdater.setState(await api.updateDownload())
  } catch (error) {
    useUpdater.setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export const installUpdate = async (): Promise<void> => {
  await desktop()?.updateInstall?.()
}
