import { create } from 'zustand'

/** 新手引导：首次打开且未配置 API Key 时自动弹出 */
export const useOnboarding = create(() => ({
  open: false,
}))

export const openOnboarding = () => useOnboarding.setState({ open: true })

export const closeOnboarding = () => useOnboarding.setState({ open: false })
