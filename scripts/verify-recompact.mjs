/**
 * 窗口迁移弹窗验收：真机（打包后的 exe）+ CDP。
 *
 * 往 IndexedDB 里塞一份「1M 窗口攒下来的超大摘要」，然后从 V4.1-Flash（1M）
 * 切到 V3.2（164K），验证：
 *   1) 弹出外行能看懂的确认框；
 *   2) 点「先不换」后通道与模型都没落盘（切换延迟生效）。
 *
 * 用法：DSALWAYS_EXE=... node scripts/verify-recompact.mjs
 */
import { spawn, execFileSync } from 'node:child_process'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\git\\dsalways\\release\\win-unpacked\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9367)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[recompact]', ...parts)

try {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    'Get-Process DSAlways -ErrorAction SilentlyContinue | Stop-Process -Force',
  ])
} catch {
  // 没有残留进程
}
await sleep(700)

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'electron_run_as_node') delete env[key]
}
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
log('启动 PID', child.pid)

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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '注入脚本报错')
  }
  return result.result.value
}
const bodyText = () => evaluate('document.body ? document.body.innerText : ""')
const clickText = (text) =>
  evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"], [role="option"], li, div')]
    const hit = nodes.find((node) => (node.textContent || '').trim() === ${JSON.stringify(text)} && node.offsetParent !== null)
    if (!hit) return false
    hit.click()
    return true
  })()`)

await sleep(1800)
await evaluate(`(() => {
  localStorage.setItem('chat-demo:provider', 'siliconflow')
  localStorage.setItem('chat-demo:siliconflow-key', 'sk-mock')
  localStorage.setItem('chat-demo:siliconflow-origin', 'http://127.0.0.1:8899/v1')
  localStorage.setItem('chat-demo:siliconflow-model', 'deepseek-ai/DeepSeek-V4.1-Flash')
  localStorage.setItem('chat-demo:context-limit', '0')
  localStorage.setItem('chat-demo:onboarding-done', 'true')
  return true
})()`)
await send('Page.reload', { ignoreCache: true })
await sleep(2600)
if ((await bodyText()).includes('跳过')) {
  await clickText('跳过')
  await sleep(600)
}

// 确保有一个活动会话
await clickText('新对话')
await sleep(900)

// 往所有会话的 assist 里塞一份超大摘要（约 6 万字），模拟 1M 窗口攒下的历史
const injected = await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('chat-demo')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const names = Array.from(db.objectStoreNames)
  if (!names.includes('assist') || !names.includes('sessions')) return { ok: false, names }
  const sessions = await new Promise((resolve, reject) => {
    const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const longText = '这是一条很长的历史记录，包含大量细节。'.repeat(3000)
  const ids = sessions.map((item) => item.id)
  await new Promise((resolve, reject) => {
    const tx = db.transaction('assist', 'readwrite')
    const store = tx.objectStore('assist')
    for (const id of ids) {
      store.put({ id, segments: [longText], summary: longText, lastContextWindow: 1048576 })
    }
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  return { ok: true, ids, chars: longText.length }
})()`)
log('注入 assist:', JSON.stringify(injected))
if (!injected.ok) throw new Error('IndexedDB 里没有 assist / sessions')

// 打开模型下拉，选窗口更小的 V3.2
const opened = await evaluate(`(() => {
  const trigger = document.querySelector('button[aria-label="切换模型"]')
  if (!trigger) return false
  trigger.click()
  return true
})()`)
log('下拉已打开:', opened)
await sleep(800)
const picked = await evaluate(`(() => {
  const hit = [...document.querySelectorAll('[role="option"]')].find(
    (el) => (el.textContent || '').trim() === '硅基流动 · V3.2'
  )
  if (!hit) return false
  hit.click()
  return true
})()`)
log('点选 V3.2:', picked)
await sleep(1000)

const dialogText = await evaluate(`(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find((el) =>
    (el.textContent || '').includes('换个模型，要先整理一下旧对话')
  )
  return dialog ? dialog.innerText : ''
})()`)
const dialogShown = dialogText.includes('换个模型，要先整理一下旧对话')
const plainWording =
  dialogText.includes('不会删除你的聊天记录') &&
  !dialogText.includes('上下文窗口') &&
  !dialogText.includes('token')
log('弹窗出现:', dialogShown, '/ 文案为外行版:', plainWording)

const cancelled = await clickText('先不换，用回原来的模型')
await sleep(700)
const after = await evaluate(`(() => ({
  provider: localStorage.getItem('chat-demo:provider'),
  model: localStorage.getItem('chat-demo:siliconflow-model'),
  dialogGone: !document.body.innerText.includes('换个模型，要先整理一下旧对话'),
}))()`)
log('取消后状态:', JSON.stringify({ cancelled, ...after }))

const checks = [
  ['选到小窗模型时弹出确认框', dialogShown],
  ['文案不含技术术语且说明不删记录', plainWording],
  ['取消按钮可点击', cancelled],
  ['取消后模型未切换', after.model === 'deepseek-ai/DeepSeek-V4.1-Flash'],
  ['取消后通道未切换', after.provider === 'siliconflow'],
  ['取消后弹窗消失', after.dialogGone],
]
let failed = 0
for (const [label, ok] of checks) {
  log(ok ? `通过：${label}` : `失败：${label}`)
  if (!ok) failed += 1
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
log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
