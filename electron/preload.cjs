// 预加载脚本：只暴露最小必要能力，渲染进程拿不到 Node
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('porter', {
  readClipboard: () => ipcRenderer.invoke('porter:read-clipboard'),
  openExternal: (url) => ipcRenderer.invoke('porter:open-external', url),
  pickImportFile: () => ipcRenderer.invoke('porter:pick-import-file'),
  platform: process.platform,
  version: process.env.npm_package_version ?? '',

  // 自动更新
  updateState: () => ipcRenderer.invoke('porter:update-state'),
  updateCheck: () => ipcRenderer.invoke('porter:update-check'),
  updateDownload: () => ipcRenderer.invoke('porter:update-download'),
  updateInstall: () => ipcRenderer.invoke('porter:update-install'),
  /** 订阅主进程推送的更新状态，返回取消订阅函数 */
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },
})
