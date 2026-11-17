/**
 * 流式健壮性验收：真机跑一次提问，观察
 *   1) 首字耗时埋点是否落盘（%APPDATA%\ds-always\logs\timing.log）；
 *   2) 断流后是否自动续写（配合 scripts/fault-proxy.mjs 用 --proxy-server 掐断）；
 *   3) 最终是否给出明确提示而不是静默空白。
 *
 * 用法：
 *   node scripts/verify-stream.mjs                       # 正常网络跑一轮
 *   EXTRA_ARGS="--proxy-server=127.0.0.1:8899" node scripts/verify-stream.mjs
 *
 * 依赖 Node 22 自带的 fetch / WebSocket（CDP），不需要 playwright。
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9355)
const PROMPT = process.env.PROMPT ?? '用三句话解释光合作用。'
const EXTRA_ARGS = (process.env.EXTRA_ARGS ?? '').split(' ').filter(Boolean)
const IDLE_STOP_MS = Number(process.env.IDLE_STOP_MS ?? 12_000)
const MAX_MS = Number(process.env.MAX_MS ?? 240_000)
const LOG_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'ds-always', 'logs', 'timing.log')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[stream]', ...parts)

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
fs.rmSync(LOG_PATH, { force: true })

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'electron_run_as_node') delete env[key]
}
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, ...EXTRA_ARGS], {
  env,
  stdio: 'ignore',
})
log('启动 PID', child.pid, EXTRA_ARGS.length ? `参数 ${EXTRA_ARGS.join(' ')}` : '（默认参数）')

let target = null
for (let i = 0; i < 80 && !target; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((item) => item.type === 'page' && item.url.startsWith('app://'))
  } catch {
    // 端口还没起来
  }
}
if (!target) throw new Error('CDP 没连上：应用可能没起来')

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
const bodyText = () => evaluate('document.body ? document.body.innerText : ""')
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

await evaluate('document.readyState')
await sleep(1500)
// 新手引导可能还在，跳过它
if ((await bodyText()).includes('跳过')) {
  await clickText('跳过')
  await sleep(1000)
}
// 关掉可能残留的设置弹窗
for (let i = 0; i < 2; i += 1) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
}

const focused = await evaluate(`(() => {
  const area = document.querySelector('textarea')
  if (!area) return false
  area.focus()
  return document.activeElement === area
})()`)
if (!focused) throw new Error('没找到输入框')
await send('Input.insertText', { text: PROMPT })
await sleep(300)
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Enter',
  code: 'Enter',
  windowsVirtualKeyCode: 13,
  text: '\r',
})
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
log('已发送提问:', PROMPT)

const startedAt = Date.now()
let lastLength = 0
let lastChange = Date.now()
let peak = 0
const samples = []
const DONE_MARKS = ['连接中断', '长时间没有收到响应', '继续生成']
while (Date.now() - startedAt < MAX_MS) {
  await sleep(1000)
  const text = await bodyText()
  const length = text.length
  if (length !== lastLength) {
    lastLength = length
    lastChange = Date.now()
    peak = Math.max(peak, length)
    samples.push(`${Math.round((Date.now() - startedAt) / 1000)}s:${length}`)
    continue
  }
  const settled = DONE_MARKS.some((mark) => text.includes(mark))
  if ((settled || length > 0) && Date.now() - lastChange > IDLE_STOP_MS) {
    break
  }
}
const elapsed = Math.round((Date.now() - startedAt) / 1000)
const finalText = await bodyText()
log('界面文本长度曲线（每秒变化点）:', samples.join(' '))
log('总耗时:', `${elapsed}s`)

// timing.log：首字耗时与续写次数都在里面
const timings = fs.existsSync(LOG_PATH)
  ? fs
      .readFileSync(LOG_PATH, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line.slice(line.indexOf('{')))
        } catch {
          return { raw: line }
        }
      })
  : []
log('埋点条数:', timings.length)
for (const item of timings) {
  log(
    '  请求',
    `attempt=${item.attempt}`,
    `bytes/类型=${item.messages}/${item.chars}`,
    `响应头=${item.responseMs}ms`,
    `首事件=${item.firstEventMs}ms`,
    `首字=${item.firstContentMs}ms`,
    `总=${item.totalMs}ms`,
    `结果=${item.outcome}${item.errorKind ? `(${item.errorKind})` : ''}`
  )
}

const notice = ['连接中断', '长时间没有收到响应', '网络异常', '服务器繁忙', '请求过于频繁'].find(
  (needle) => finalText.includes(needle)
)
log('提示文案:', notice ?? '（无错误提示）')
log('答案里出现「光合作用」:', finalText.includes('光合作用'))
log('回答片段:', finalText.replace(/\s+/g, ' ').slice(-200))

await send('Page.captureScreenshot', {}).then(async (shot) => {
  if (shot?.data) {
    fs.writeFileSync('C:\\git\\dsalways\\release\\stream-check.png', Buffer.from(shot.data, 'base64'))
    log('截图: release/stream-check.png')
  }
})

ws.close()
child.kill()
process.exit(0)
