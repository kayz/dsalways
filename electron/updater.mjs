/**
 * 自动更新：包一层 electron-updater，把状态整理成渲染进程好用的形状。
 *
 * 更新源写在 resources/app-update.yml（由 electron-builder 按 electron-builder.yml 的
 * publish 配置生成）。私有 GitHub 仓库靠里面的 token 读取 release，见 README 的说明。
 */
import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 渲染进程订阅的推送频道 */
export const UPDATE_STATUS_CHANNEL = 'updater:status'

const state = {
  /** idle | disabled | checking | current | available | downloading | downloaded | error */
  phase: 'idle',
  currentVersion: app.getVersion(),
  /** 新版本号 */
  version: null,
  notes: null,
  /** 下载进度 0–100 */
  percent: 0,
  message: null,
  /** 该不该给出「检查更新」按钮 */
  canCheck: true,
}

let updater = null
let setupError = null
let send = () => {}

const patch = (next) => {
  Object.assign(state, next)
  try {
    send(state)
  } catch {
    // 窗口已销毁，忽略
  }
}

const releaseNotes = (info) => {
  const notes = info?.releaseNotes
  if (typeof notes === 'string') return notes.slice(0, 4000)
  if (Array.isArray(notes)) {
    return notes
      .map((item) => (typeof item?.note === 'string' ? item.note : ''))
      .join('\n')
      .slice(0, 4000)
  }
  return null
}

/**
 * 把 electron-updater 抛出的英文错误翻译成用户能看懂的一句话。
 * 最常见的三类：私有仓库 token 没配、macOS 未签名、网络不通。
 */
const describeError = (error) => {
  const raw = String(error?.message ?? error ?? '')
  if (/app-update\.yml|ENOENT/i.test(raw)) {
    return '这份安装包没有内置更新源配置（构建时未设置 publish），无法自动更新。'
  }
  if (/404|Cannot find|no such file|latest\.yml/i.test(raw)) {
    return '更新源上找不到 latest.yml：仓库里还没有发布过新版本，或更新令牌无权访问该私有仓库。'
  }
  if (/401|403|Unauthorized|Forbidden|bad credentials/i.test(raw)) {
    return '更新源鉴权失败：私有仓库需要一个只读 Contents 的令牌，且已过期或填错。'
  }
  if (/code sign|signature|not signed|did not pass validation/i.test(raw)) {
    return 'macOS 自动更新要求应用已用开发者证书签名并公证，当前这份未签名，只能手动覆盖安装。'
  }
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(raw)) {
    return '连不上更新服务器，请检查网络或代理后重试。'
  }
  return raw || '未知错误'
}

/** 免安装版（portable）没有固定的安装位置，electron-updater 无法替换自身 */
const isPortable = () => Boolean(process.env.PORTABLE_EXECUTABLE_DIR)

/**
 * 读 app-update.yml（我们自己生成的文件，结构是扁平的 key: value，不需要完整 YAML 解析器）。
 * 注意 `private: true` 是字符串，得转成布尔——"false" 也是真值，直接透传会误判成私有仓库。
 */
const readAppUpdateConfig = () => {
  try {
    const text = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const config = {}
    for (const line of text.split('\n')) {
      const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line.trim())
      if (match) {
        config[match[1]] = match[2].trim()
      }
    }
    if ('private' in config) {
      config.private = config.private === 'true'
    }
    return Object.keys(config).length > 0 ? config : null
  } catch {
    return null
  }
}

/**
 * 更新源要不要鉴权，完全由发布方在打包时决定：公开仓库的安装包里没有 token 字段，
 * 私有仓库的安装包由 GH_UPDATE_TOKEN 在建包时写进去。用户侧没有任何可填的东西。
 * 私有仓库 + 包里没带令牌 = 一定拉不到 latest.yml（GitHub 对匿名请求返回 404），
 * 这种情况提前说清楚，别让用户对着 404 发懵。
 */
const missingToken = () => {
  const config = readAppUpdateConfig()
  return Boolean(config?.private && !config.token)
}

const applyFeed = (api) => {
  const config = readAppUpdateConfig()
  if (!config) {
    return
  }
  try {
    // setFeedURL 会重建 provider：带 token 走 api.github.com，不带 token 走公开的
    // raw.githubusercontent.com / releases.atom，后者读不了私有仓库
    api.setFeedURL(config)
    // 私有仓库却没带令牌时先把话说在前面，别等用户点了「检查更新」才看到一个 404
    if (missingToken()) {
      patch({
        phase: 'disabled',
        message: '这份安装包没有内置更新令牌：请联系发布方获取最新安装包。',
      })
    }
  } catch (error) {
    patch({ phase: 'error', message: describeError(error) })
  }
}

const setUpdater = () => {
  if (updater || setupError) return updater

  if (!app.isPackaged) {
    setupError = '开发模式没有打包，自动更新只在安装版里生效。'
    patch({ phase: 'disabled', canCheck: false, message: setupError })
    return null
  }
  if (isPortable()) {
    setupError = '当前是免安装版，无法自动更新；换成安装版即可自动升级。'
    patch({ phase: 'disabled', canCheck: false, message: setupError })
    return null
  }
  const configPath = path.join(process.resourcesPath, 'app-update.yml')
  if (!fs.existsSync(configPath)) {
    setupError = '这份安装包没有内置更新源配置（构建时未设置 publish），无法自动更新。'
    patch({ phase: 'disabled', canCheck: false, message: setupError })
    return null
  }

  try {
    const { autoUpdater } = require('electron-updater')
    // 先让用户知道「有新版本」，是否下载由用户决定；退出时自动装上已下载的包
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => patch({ phase: 'checking', message: null }))
    autoUpdater.on('update-available', (info) => {
      patch({
        phase: 'available',
        version: info?.version ?? null,
        notes: releaseNotes(info),
        percent: 0,
        message: null,
      })
    })
    autoUpdater.on('update-not-available', () => {
      patch({ phase: 'current', version: null, notes: null, message: null })
    })
    autoUpdater.on('download-progress', (progress) => {
      patch({ phase: 'downloading', percent: Math.round(progress?.percent ?? 0) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      patch({ phase: 'downloaded', percent: 100, version: info?.version ?? state.version })
    })
    autoUpdater.on('error', (error) => {
      patch({ phase: 'error', message: describeError(error) })
    })

    updater = autoUpdater
    applyFeed(autoUpdater)
  } catch (error) {
    setupError = describeError(error)
    patch({ phase: 'error', canCheck: false, message: setupError })
  }
  return updater
}

export const attachUpdater = (webContents) => {
  send = (payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(UPDATE_STATUS_CHANNEL, payload)
    }
  }
}

export const updaterState = () => ({ ...state })

export const checkForUpdates = async () => {
  const api = setUpdater()
  if (!api) return { ...state }
  if (state.phase === 'checking' || state.phase === 'downloading') return { ...state }
  if (missingToken()) {
    patch({
      phase: 'disabled',
      message: '这份安装包没有内置更新令牌：请联系发布方获取最新安装包。',
    })
    return { ...state }
  }
  try {
    await api.checkForUpdates()
  } catch (error) {
    patch({ phase: 'error', message: describeError(error) })
  }
  return { ...state }
}

export const downloadUpdate = async () => {
  const api = setUpdater()
  if (!api) return { ...state }
  if (state.phase !== 'available') return { ...state }
  try {
    await api.downloadUpdate()
  } catch (error) {
    patch({ phase: 'error', message: describeError(error) })
  }
  return { ...state }
}

export const installUpdate = () => {
  const api = setUpdater()
  if (!api) return false
  if (state.phase !== 'downloaded') return false
  // 第二个参数 isSilent=false：让安装向导正常显示，第三个参数强制结束进程后再装
  setImmediate(() => api.quitAndInstall(false, true))
  return true
}

/** 打开发布页，方便用户看更新说明 */
export const openReleasePage = async () => {
  try {
    const raw = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = /owner:\s*(\S+)/.exec(raw)?.[1]
    const repo = /repo:\s*(\S+)/.exec(raw)?.[1]
    if (owner && repo) {
      await shell.openExternal(`https://github.com/${owner}/${repo}/releases`)
    }
  } catch {
    // 没有配置就不打开
  }
}
