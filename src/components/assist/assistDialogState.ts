import { create } from 'zustand'

/** 记忆与上下文面板，可从侧栏底部打开 */
export const useAssistDialog = create(() => ({ open: false }))

export const openAssist = () => useAssistDialog.setState({ open: true })

export const closeAssist = () => useAssistDialog.setState({ open: false })
