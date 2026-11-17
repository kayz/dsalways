import { create } from 'zustand'
import { activeKey, useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 模型接入 / 数据管理 / 关于与更新 */
export type SettingsSection = 'general' | 'model' | 'data' | 'about'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 当前通道没有 Key 时打开设置并选中「模型接入」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (activeKey(useSettings.getState())) {
    return true
  }
  openSettings('model')
  return false
}
