/**
 * 官方通道模型选择验收：真机 + 真实 Key，验证
 *   1) 官方通道工具栏出现模型下拉，两个选项是 V4 Flash / V4 Pro；
 *   2) 选中 V4 Pro 后，实际请求体里的 model 就是 deepseek-v4-pro（读 timing.log）；
 *   3) 切回 Flash 后请求体跟着变回 deepseek-flash。
 *
 * 用法：
 *   DSALWAYS_EXE='release\win-unpacked\DSAlways.exe' node scripts/verify-models.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9369)
const TIMING_LOG =
  process.env.TIMING_LOG ?? 'C:/Users/kayz/AppData/Roaming/ds-always/logs/timing.log'
const PROMPT = process.env.PROMPT ?? '只回复两个字：收到'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[models]', ...parts)

const kill = () => {
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

kill()
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
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? '注入脚本报错')
  return result.result.value
}

const typeAndSend = async (text) => {
  const ok = await evaluate(`(() => {
    const area = document.querySelector('textarea')
    if (!area) return false
    area.focus()
    return document.activeElement === area
  })()`)
  if (!ok) throw new Error('没找到输入框')
  await send('Input.insertText', { text })
  await sleep(200)
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      ...(type === 'keyDown' ? { text: '\r' } : {}),
    })
  }
}

const waitIdle = async (timeout = 90_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const busy = await evaluate(
      `Boolean(document.querySelector('button[aria-label*="停止"], button[aria-label*="Stop"]'))`
    )
    if (!busy) return true
    await sleep(500)
  }
  return false
}

/** 读 timing.log 最后一条：模型与结果 */
const lastTiming = () => {
  if (!fs.existsSync(TIMING_LOG)) return null
  const lines = fs.readFileSync(TIMING_LOG, 'utf8').trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    // 日志行是「时间 [info] {json}」，把前缀切掉再解析
    const brace = lines[i].indexOf('{')
    if (brace < 0) continue
    try {
      return JSON.parse(lines[i].slice(brace))
    } catch {
      // 跳过半行
    }
  }
  return null
}

const runOnce = async (model) => {
  await evaluate(`(() => {
    localStorage.setItem('chat-demo:provider', 'deepseek')
    localStorage.setItem('chat-demo:deepseek-model', '${model}')
    return true
  })()`)
  await send('Page.reload', {})
  await sleep(2800)

  const toolbar = await evaluate(`(() => {
    const label = [...document.querySelectorAll('[aria-label]')]
      .map((el) => el.getAttribute('aria-label'))
      .filter((value) => value && value.includes('模型'))
    const text = document.body ? document.body.innerText : ''
    return { labels: label, hasFlash: text.includes('V4 Flash'), hasPro: text.includes('V4 Pro') }
  })()`)
  log(
    `模型 ${model}：工具栏 ${JSON.stringify(toolbar.labels)}，页面出现 V4 Flash=${toolbar.hasFlash} V4 Pro=${toolbar.hasPro}`
  )

  const before = lastTiming()?.at ?? ''
  await typeAndSend(PROMPT)
  await waitIdle()
  const entry = lastTiming()
  const fresh = entry && entry.at !== before
  log(`模型 ${model}：timing.log →`, fresh ? JSON.stringify(entry) : '没有新记录')
  return { fresh, entry }
}

try {
  const pro = await runOnce('deepseek-v4-pro')
  const flash = await runOnce('deepseek-flash')

  const checks = [
    ['V4 Pro 请求已发出且记录模型', Boolean(pro.fresh) && pro.entry?.model === 'deepseek-v4-pro'],
    ['V4 Pro 请求成功（outcome=done）', pro.entry?.outcome === 'done'],
    [
      'V4 Flash 请求已发出且记录模型',
      Boolean(flash.fresh) && flash.entry?.model === 'deepseek-flash',
    ],
    ['V4 Flash 请求成功（outcome=done）', flash.entry?.outcome === 'done'],
  ]
  let failed = 0
  for (const [label, ok] of checks) {
    log(ok ? `通过：${label}` : `失败：${label}`)
    if (!ok) failed += 1
  }
  log(failed === 0 ? '全部通过' : `${failed} 项失败`)
  process.exitCode = failed === 0 ? 0 : 1
} finally {
  ws.close()
  kill()
}
