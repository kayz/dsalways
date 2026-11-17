import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
} from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appendReport } from './logger.mjs'
import {
  attachUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  updaterState,
  UPDATE_STATUS_CHANNEL,
} from './updater.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, '..', 'dist')
const API_ORIGIN = 'https://api.deepseek.com'
const isMac = process.platform === 'darwin'

/**
 * 用自定义协议承载前端，而不是直接 loadFile。
 * file:// 在 Chromium 里是不透明源，IndexedDB 会被分区甚至拒绝，
 * 而 app:// 是标准安全源，localStorage / IndexedDB / 剪贴板权限都表现正常。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

let mainWindow = null

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'DS Always',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  // 更新状态只推给这个窗口
  attachUpdater(mainWindow.webContents)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    console.log('[porter] window ready')
    // 启动后延迟查一次：太早会和服务器的首次请求抢带宽，用户也看不到提示
    setTimeout(() => {
      void checkForUpdates()
    }, 8000)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 站外链接一律交给系统浏览器，不在应用窗口里打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault()
      if (/^https?:/i.test(url)) {
        void shell.openExternal(url)
      }
    }
  })

  void mainWindow.loadURL('app://porter/index.html')
}

const serveDist = () => {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    // app://porter/xxx → dist/xxx
    const relative = decodeURIComponent(url.pathname)
    const target = path.normalize(path.join(DIST, relative === '/' ? 'index.html' : relative))
    if (!target.startsWith(path.normalize(DIST))) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      // 前端是单页应用，未知路径回落到 index.html
      return net.fetch(pathToFileURL(path.join(DIST, 'index.html')).toString())
    }
  })
}

/**
 * 兜底跨域：渲染进程跑在 app:// 自定义协议下，带 Authorization 的请求会先发 OPTIONS 预检。
 * 官方接口与硅基流动都不一定回 CORS 头（预检甚至可能直接 405），所以这里：
 * - 普通响应缺 Access-Control-Allow-Origin 就补上；
 * - 预检直接把状态行改成 200 并补全 Allow-Headers / Allow-Methods，让 Chromium 放行。
 * 这是桌面客户端自己的会话，只影响本应用发出的请求。
 */
const CORS_ENDPOINTS = [`${API_ORIGIN}/*`, 'https://api.siliconflow.cn/*', 'http://127.0.0.1:*/*']

const allowApiCors = () => {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: CORS_ENDPOINTS },
    (details, callback) => {
      const headers = details.responseHeaders ?? {}
      const hasOrigin = Object.keys(headers).some(
        (key) => key.toLowerCase() === 'access-control-allow-origin'
      )
      if (!hasOrigin) {
        headers['Access-Control-Allow-Origin'] = ['*']
      }
      if (details.method === 'OPTIONS') {
        headers['Access-Control-Allow-Headers'] = ['*']
        headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS']
        headers['Access-Control-Max-Age'] = ['86400']
        callback({ responseHeaders: headers, statusLine: 'HTTP/1.1 200 OK' })
        return
      }
      callback({ responseHeaders: headers, statusLine: details.statusLine })
    }
  )
}

const registerBridge = () => {
  /** 读剪贴板：主进程读不需要用户授权，新手引导里用来一键填入 API Key */
  ipcMain.handle('porter:read-clipboard', () => clipboard.readText())
  ipcMain.handle('porter:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      return shell.openExternal(url)
    }
    return Promise.resolve()
  })
  ipcMain.handle('porter:pick-import-file', async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: '选择导出的对话文件',
          properties: ['openFile'],
          filters: [{ name: '对话导出包', extensions: ['zip'] }],
        })
      : await dialog.showOpenDialog({
          title: '选择导出的对话文件',
          properties: ['openFile'],
          filters: [{ name: '对话导出包', extensions: ['zip'] }],
        })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 自动更新
  ipcMain.handle('porter:update-state', () => updaterState())
  ipcMain.handle('porter:update-check', () => checkForUpdates())
  ipcMain.handle('porter:update-download', () => downloadUpdate())
  ipcMain.handle('porter:update-install', () => installUpdate())

  // 渲染进程上报的耗时埋点，落到 userData/logs/timing.log
  ipcMain.on('porter:log-timing', (_event, line) => {
    if (typeof line === 'string' && line) {
      appendReport('timing.log', line)
    }
  })
}

/**
 * macOS 必须有 Edit 菜单，否则 Cmd+C / Cmd+V / Cmd+A 在输入框里全都失灵
 * （Chromium 的编辑快捷键是由菜单的 role 提供的）。
 * Windows / Linux 上保持无菜单，和之前的行为一致。
 */
const buildMenu = () => {
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: '检查更新…',
            click: () => {
              void checkForUpdates()
            },
          },
        ],
      },
    ])
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows 任务栏分组与通知归属需要这个 id；macOS 用 bundle id，不需要
  if (!isMac) {
    app.setAppUserModelId('com.kayz.dsalways')
  }
  if (isMac) {
    app.setAboutPanelOptions({
      applicationName: 'DS Always',
      applicationVersion: app.getVersion(),
      copyright: '第三方客户端，非 DeepSeek 官方产品',
    })
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    serveDist()
    allowApiCors()
    buildMenu()
    registerBridge()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) {
      app.quit()
    }
  })
}
