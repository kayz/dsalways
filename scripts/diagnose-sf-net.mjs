/**
 * 诊断应用内（Chromium 网络栈）访问硅基流动为什么失败。
 * 用 CDP 的 Network 域抓真实错误码（net::ERR_*），而不是只看 "Failed to fetch"。
 *
 *   node scripts/diagnose-sf-net.mjs
 */
import { spawn, execFileSync } from 'node:child_process'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9375)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[diag]', ...parts)

const killApp = () => {
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      'Get-Process DSAlways -ErrorAction SilentlyContinue | Stop-Process -Force',
    ])
  } catch {
    // 没有残留进程
  }
}

killApp()
await sleep(800)

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'electron_run_as_node') delete env[key]
}
spawn(EXE, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })

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
if (!target) throw new Error('CDP 没连上')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let seq = 0
const pending = new Map()
/** 收集 Network 事件，key 是 requestId */
const netEvents = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id) {
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    if (msg.error) slot.reject(new Error(msg.error.message))
    else slot.resolve(msg.result)
    return
  }
  if (msg.method?.startsWith('Network.')) netEvents.push(msg)
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

await send('Network.enable', { maxTotalBufferSize: 10_000_000 })

const state = await evaluate(`(() => ({
  origin: localStorage.getItem('chat-demo:siliconflow-origin'),
  keyLen: (localStorage.getItem('chat-demo:siliconflow-key') || '').length,
  provider: localStorage.getItem('chat-demo:provider'),
}))()`)
log('请求改道地址:', state.origin ?? '（无，直连官方域名）')
log('已存 Key 长度:', state.keyLen)

const probe = async (label, url) => {
  const before = netEvents.length
  const out = await evaluate(`(async () => {
    const started = Date.now()
    try {
      const res = await fetch(${JSON.stringify(url)}, { method: 'GET' })
      const text = await res.text()
      return { status: res.status, ms: Date.now() - started, body: text.slice(0, 160) }
    } catch (error) {
      return { status: 0, ms: Date.now() - started, error: String(error) }
    }
  })()`)
  log('')
  log(`— ${label}`)
  log(`  ${url}`)
  log(`  结果: HTTP ${out.status}（${out.ms}ms）`)
  if (out.body) log(`  body: ${out.body.replace(/\s+/g, ' ')}`)
  if (out.error) log(`  JS 异常: ${out.error}`)

  // 把这次请求期间产生的 Network 事件摊开，重点是 loadingFailed 的 errorText
  const fresh = netEvents.slice(before)
  for (const item of fresh) {
    if (item.method === 'Network.responseReceived') {
      const r = item.params.response
      log(`  ← 响应 ${r.status} ${r.statusText} | 协议 ${r.protocol ?? '-'} | 来自 ${r.remoteIPAddress ?? '-'}`)
    }
    if (item.method === 'Network.loadingFailed') {
      log(`  ✗ loadingFailed: ${item.params.errorText}（canceled=${item.params.canceled}）`)
    }
  }
  return out
}

await probe('硅基流动 /v1/models（不带 Key，期望 401）', 'https://api.siliconflow.cn/v1/models')
await probe('对照组：DeepSeek 官方域名（期望 4xx/200，证明网络栈可用）', 'https://api.deepseek.com/')

ws.close()
killApp()
