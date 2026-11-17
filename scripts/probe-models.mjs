/**
 * 探测官方接口到底接受哪些模型名：用应用里已保存的 Key，各发一次 1 token 的请求。
 * 只读 Key、不改设置，成本可以忽略。
 *
 *   node scripts/probe-models.mjs
 */
import { spawn, execFileSync } from 'node:child_process'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9368)
const CANDIDATES = (process.env.MODELS ?? 'deepseek-flash,deepseek-v4-pro').split(',')
const THINKING = process.env.THINKING ?? ''

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[probe]', ...parts)

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

const hasKey = await evaluate(`Boolean(localStorage.getItem('chat-demo:api-key'))`)
log('已保存官方 Key:', hasKey)
if (!hasKey) {
  log('没有官方 Key，无法探测')
  ws.close()
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    'Get-Process DSAlways -ErrorAction SilentlyContinue | Stop-Process -Force',
  ])
  process.exit(2)
}

for (const model of CANDIDATES) {
  const out = await evaluate(`(async () => {
    const key = localStorage.getItem('chat-demo:api-key')
    const started = Date.now()
    try {
      const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: '${model}',
          max_tokens: ${process.env.MAX_TOKENS ?? 1},
          messages: [{ role: 'user', content: 'hi' }],
          ${THINKING ? `thinking: { type: '${THINKING}' },` : ''}
        }),
      })
      const text = await res.text()
      return { status: res.status, ms: Date.now() - started, body: text.slice(0, 400) }
    } catch (error) {
      return { status: 0, ms: Date.now() - started, body: String(error) }
    }
  })()`)
  log(`模型 ${model} → HTTP ${out.status}（${out.ms}ms）`)
  log('  响应:', out.body.replace(/\s+/g, ' '))
}

ws.close()
try {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    'Get-Process DSAlways -ErrorAction SilentlyContinue | Stop-Process -Force',
  ])
} catch {
  // 已退出
}
