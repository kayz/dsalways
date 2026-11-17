export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 剪贴板权限受限时尝试兼容方式。
  }

  // 兼容手机通过局域网 HTTP 访问的情况。
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'

  try {
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

import { desktop } from './desktop.js'

/**
 * 读取剪贴板文本。桌面端走主进程（不需要额外授权），
 * 浏览器里 readText 需要用户手势与权限，失败时返回空串由界面提示手动粘贴。
 */
export const readClipboardText = async (): Promise<string> => {
  const api = desktop()
  if (api?.readClipboard) {
    try {
      return await api.readClipboard()
    } catch {
      return ''
    }
  }
  try {
    return (await navigator.clipboard?.readText?.()) ?? ''
  } catch {
    return ''
  }
}

/** 在系统浏览器中打开链接；桌面端必须走主进程，否则会在应用窗口里被拦截 */
export const openExternal = (url: string): void => {
  const api = desktop()
  if (api?.openExternal) {
    void api.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
