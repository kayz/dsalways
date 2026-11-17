/**
 * 自动更新验收：直接操作已经安装的 exe，全程点界面，不调内部 IPC。
 *
 * 用法：
 *   node scripts/verify-update.mjs            # 从当前已安装版本升到线上最新版
 *   node scripts/verify-update.mjs --ui-only  # 只检查界面（不点更新）
 *
 * 依赖：Node 22 自带的 fetch / WebSocket（CDP），不需要 playwright。
 */
import { spawn } from 'node:child_process'

const EXE = 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = 9333
const uiOnly = process.argv.includes('--ui-only')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[verify]', ...parts)

const { execFileSync } = await import('node:child_process')
const currentVersion = () => {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-Item '${EXE}').VersionInfo.FileVersion`,
    ])
    return out.toString().trim()
  } catch {
    // NSIS 在替换文件时会先把目录删掉，这一瞬间读不到 exe 属于正常现象，返回空串
    return ''
  }
}
const before = currentVersion()
log('已安装版本:', before)
if (!before) {
  console.error(`[verify] 找不到 ${EXE}，先手动装一个版本再跑验收`)
  process.exit(1)
}

// 1) 启动应用（必须剔除宿主注入的 ELECTRON_RUN_AS_NODE，否则 exe 会退化成 node）
try {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    'Get-Process DSAlways -ErrorAction SilentlyContinue | Stop-Process -Force',
  ])
} catch {
  // 没有残留进程
}
await sleep(800)
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'electron_run_as_node') delete env[key]
}
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore',
  detached: false,
})
log('启动 PID', child.pid)

// 2) 等 CDP 端口
let target = null
for (let i = 0; i < 60 && !target; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((item) => item.type === 'page' && item.url.startsWith('app://'))
  } catch {
    // 端口还没起来
  }
}
if (!target) throw new Error('CDP 没连上：应用可能没起来')
log('页面:', target.url)

// 3) 最小 CDP 客户端
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const slot = pending.get(msg.id)
  if (!slot) return
  pending.delete(msg.id)
  if (msg.error) slot.reject(new Error(msg.error.message))
  else slot.resolve(msg.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = (seq += 1)
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '注入脚本报错')
  }
  return result.result.value
}

const clickText = (text) =>
  evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"], [role="tab"], a, div')]
    const hit = nodes.find((node) => {
      const label = (node.textContent || '').trim()
      return label === ${JSON.stringify(text)} && node.offsetParent !== null
    })
    if (!hit) return false
    hit.click()
    return true
  })()`)

const bodyText = () => evaluate('document.body ? document.body.innerText : ""')

const waitForText = async (needle, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await bodyText()
    if (text.includes(needle)) return text
    await sleep(500)
  }
  return null
}

// 4) 等界面就绪
for (let i = 0; i < 60; i += 1) {
  const ready = await evaluate('document.readyState === "complete" && !!document.body')
  if (ready) break
  await sleep(500)
}
await waitForText('新建对话', 30_000)
await sleep(1200)
if ((await bodyText()).includes('跳过')) {
  await clickText('跳过')
  await sleep(800)
}

// 5) 打开设置 → 关于与更新
if (!(await clickText('设置'))) throw new Error('没找到「设置」按钮')
await waitForText('关于与更新', 15_000)
if (!(await clickText('关于与更新'))) throw new Error('没找到「关于与更新」分组')
await sleep(800)

const passwordInputs = await evaluate('document.querySelectorAll(\'input[type="password"]\').length')
const allInputs = await evaluate('document.querySelectorAll("input").length')
log('设置页 input 总数:', allInputs, '/ password 输入框:', passwordInputs)
log(
  '关于分组文案:',
  (await bodyText())
    .split('\n')
    .filter((line) => line.trim())
    .slice(-8)
    .join(' | ')
)

// 6) 检查更新：启动时可能已经自动查过（状态里直接是「发现新版本」），这时没有「检查更新」按钮
let available = (await bodyText()).includes('发现新版本') ? await bodyText() : null
if (!available && !(await bodyText()).includes('已是最新版本')) {
  if (!(await clickText('检查更新'))) throw new Error('没找到「检查更新」按钮')
  available = await waitForText('发现新版本', 45_000)
}
const latest = available ? null : await waitForText('已是最新版本', 3_000)
log('检查结果:', available ? available.split('\n').find((l) => l.includes('发现新版本')) : latest ? '已是最新版本' : '超时')

if (uiOnly || !available) {
  log('结束（未下载）')
  ws.close()
  child.kill()
  process.exit(0)
}

// 7) 下载
if (!(await clickText('下载更新'))) throw new Error('没找到「下载更新」按钮')
const downloaded = await waitForText('新版本已下载', 300_000)
if (!downloaded) throw new Error('下载超时')
log('下载完成:', downloaded.split('\n').find((l) => l.includes('新版本已下载')))
log('设置页 password 输入框仍为', await evaluate('document.querySelectorAll(\'input[type="password"]\').length'))

// 8) 重启并安装
if (!(await clickText('重启并安装'))) throw new Error('没找到「重启并安装」按钮')
log('已点击安装，开始每秒监视进程与安装目录')
const monitor = setInterval(() => {
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `$e='${EXE}'; if (Test-Path $e) { $v=(Get-Item $e).VersionInfo.FileVersion } else { $v='MISSING' };
     $p=(Get-Process | Where-Object { $_.ProcessName -match 'DSAlways|Setup|Un_|nsis' } | ForEach-Object { $_.ProcessName + '(' + $_.Id + ')' }) -join ',';
     "$v|$p"`,
  ])
  log('  watch:', out.toString().trim())
}, 1000)
ws.close()
await new Promise((resolve) => {
  const timer = setTimeout(resolve, 20_000)
  child.on('exit', () => {
    clearTimeout(timer)
    resolve()
  })
})

// 9) 等安装完成，读新版本（安装期间目录会被短暂删掉，必须忽略空值）
let after = before
for (let i = 0; i < 90; i += 1) {
  await sleep(2000)
  const seen = currentVersion()
  if (seen && seen !== before) {
    after = seen
    break
  }
}
log('安装后版本:', after)
clearInterval(monitor)
log(after !== before ? `通过：${before} → ${after}` : `未变化（仍是 ${after}）`)

// 9.5) 把应用侧更新日志打出来（打包后没有终端，只能靠这个文件）
const logPath = `${process.env.APPDATA}\\ds-always\\logs\\updater.log`
try {
  const raw = await (await import('node:fs/promises')).readFile(logPath, 'utf8')
  const tail = raw.trim().split('\n').slice(-12)
  log('---- updater.log 末尾 ----')
  for (const line of tail) console.log('   ', line.replace(/^\S+ /, ''))
} catch {
  log('没有 updater.log（', logPath, '）')
}

// 10) 新版本再开一次界面自检：设置页仍然没有任何令牌输入
if (after !== before) {
  // 安装刚结束时 exe 可能还在被占用，等它稳定下来再开
  for (let i = 0; i < 20; i += 1) {
    const first = currentVersion()
    await sleep(1500)
    if (first && currentVersion() === first) break
  }
  log('二次复核：以新版本重新打开设置页…')
  const again = execFileSync(process.execPath, [import.meta.filename, '--ui-only'], {
    encoding: 'utf8',
  })
  console.log(again.trim())
}
