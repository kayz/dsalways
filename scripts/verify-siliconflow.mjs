/**
 * 硅基流动通道验收：真机（打包后的 exe）+ 本地 mock 服务，验证
 *   1) 通道切换后请求确实走 OpenAI 兼容格式（mock 打印 roles / systemAtFront / enable_thinking）；
 *   2) 对话框里能切换三个模型，R1 的 reasoning_content 变成思考块；
 *   3) 长对话压缩会触发、且界面给出「正在找回之前的对话」提示。
 *
 * 用法：
 *   node scripts/mock-siliconflow.mjs > /tmp/mock.log 2>&1 &
 *   node scripts/verify-siliconflow.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9366)
const MOCK = process.env.MOCK_ORIGIN ?? 'http://127.0.0.1:8899/v1'
// 用 Windows 绝对路径：Git Bash 的 /tmp 与 Node 的 /tmp 不是同一个目录
const MOCK_LOG =
  process.env.MOCK_LOG ??
  'C:/Users/kayz/AppData/Local/Temp/mock-siliconflow.log'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[sf]', ...parts)

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
    const nodes = [...document.querySelectorAll('button, [role="button"], [role="option"], li, div')]
    const hit = nodes.find((node) => {
      const label = (node.textContent || '').trim()
      return label === ${JSON.stringify(text)} && node.offsetParent !== null
    })
    if (!hit) return false
    hit.click()
    return true
  })()`)

const waitForText = async (needle, timeout = 20_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if ((await bodyText()).includes(needle)) return true
    await sleep(300)
  }
  return false
}

/** 注入压缩提示观察器：提示可能一闪而过，靠 DOM 变更捕获 */
const watchCompressNotice = () =>
  evaluate(`(() => {
    window.__compressSeen = window.__compressSeen || false
    if (window.__compressObserver) window.__compressObserver.disconnect()
    const check = () => {
      if (document.body && document.body.innerText.includes('正在找回之前的对话')) {
        window.__compressSeen = true
      }
    }
    window.__compressObserver = new MutationObserver(check)
    window.__compressObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
    check()
    return true
  })()`)

const type = async (text) => {
  const ok = await evaluate(`(() => {
    const area = document.querySelector('textarea')
    if (!area) return false
    area.focus()
    return document.activeElement === area
  })()`)
  if (!ok) throw new Error('没找到输入框')
  await send('Input.insertText', { text })
  await sleep(200)
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    text: '\r',
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  })
}

/** 等回答稳定：正文出现目标文案后再等 1.5 秒无变化 */
const waitSettled = async (needle, timeout = 60_000) => {
  if (!(await waitForText(needle, timeout))) {
    return false
  }
  let last = ''
  for (let i = 0; i < 20; i += 1) {
    await sleep(600)
    const text = await bodyText()
    if (text === last) break
    last = text
  }
  return true
}

await evaluate('document.readyState')
await sleep(1500)
if ((await bodyText()).includes('跳过')) {
  await clickText('跳过')
  await sleep(800)
}

// 1) 切到硅基流动 + 装上 mock 地址（设置项在模块初始化时读取，改完要重载）
await evaluate(`(() => {
  localStorage.setItem('chat-demo:provider', 'siliconflow')
  localStorage.setItem('chat-demo:siliconflow-key', 'sk-mock')
  localStorage.setItem('chat-demo:siliconflow-origin', ${JSON.stringify(MOCK)})
  localStorage.setItem('chat-demo:siliconflow-model', 'deepseek-ai/DeepSeek-V4.1-Flash')
  localStorage.setItem('chat-demo:onboarding-done', 'true')
  // 窗口与保留轮次一起调小，后面几轮就能触发压缩
  localStorage.setItem('chat-demo:context-limit', '8000')
  localStorage.setItem('chat-demo:keep-recent', '2')
  return true
})()`)
await send('Page.reload', { ignoreCache: true })
await sleep(2500)

const afterReload = await bodyText()
log('重载后界面:', afterReload.slice(0, 80).replace(/\s+/g, ' '))

// 2) V4.1-Flash 一轮
await watchCompressNotice()
await type('请用一句话说明你在用哪个通道。')
const flashOk = await waitSettled('这是 deepseek-ai/DeepSeek-V4.1-Flash 的回答')
log('V4.1-Flash 回答:', flashOk ? '已收到' : '超时未收到')

// 3) 在对话框里切到 R1
const opened = await evaluate(`(() => {
  const trigger = document.querySelector('button[aria-label="切换模型"]')
  if (!trigger) return false
  trigger.click()
  return true
})()`)
await sleep(600)
const switched = await clickText('R1')
log('模型下拉可打开:', opened, '/ 选中 R1:', switched)
await sleep(500)
const modelChip = await evaluate(`(() => {
  const trigger = document.querySelector('button[aria-label="切换模型"]')
  return trigger ? trigger.textContent.trim() : 'missing'
})()`)
log('切换后按钮显示:', modelChip)

await type('换个模型再答一次。')
const r1Ok = await waitSettled('这是 deepseek-ai/DeepSeek-R1 的回答')
const r1Text = await bodyText()
log('R1 回答:', r1Ok ? '已收到' : '超时未收到')
log('R1 思考块:', r1Text.includes('先想一下') ? '有（reasoning_content 已渲染）' : '没有')
log('R1 开关状态:', /R1|始终思考/.test(r1Text) ? '界面有 R1 相关文案' : '无')

// 4) 继续灌长文本：窗口 8000、保留 2 轮，第 2~3 轮就会越过阈值触发压缩
const filler = '这是一段用于撑大上下文的说明文字，目的是让压缩阈值被触发。'.repeat(120)
for (let round = 1; round <= 4; round += 1) {
  await watchCompressNotice()
  await type(`第 ${round} 轮：${filler}`)
  const done = await waitSettled('这是 deepseek-ai/DeepSeek-R1 的回答', 90_000)
  log(`第 ${round} 轮回答:`, done ? 'ok' : '超时')
}
const compressSeen = await evaluate('Boolean(window.__compressSeen)')
log('压缩提示出现过:', compressSeen)

// 5) V3.2：验证 enable_thinking 随开关变化（V4.1 不传、R1 不传、V3.2 才传）
await evaluate(`(() => {
  const trigger = document.querySelector('button[aria-label="切换模型"]')
  if (trigger) trigger.click()
  return true
})()`)
await sleep(600)
await clickText('V3.2')
await sleep(400)
await type('换成 V3.2 再答一次。')
const v32Off = await waitSettled('这是 deepseek-ai/DeepSeek-V3.2 的回答', 60_000)
log('V3.2（思考关）回答:', v32Off ? '已收到' : '超时')

const toggledThinking = await evaluate(`(() => {
  const button = document.querySelector('button[aria-label="深度思考"]')
  if (!button || button.disabled) return 'unavailable'
  button.click()
  return button.getAttribute('aria-pressed')
})()`)
log('深度思考开关:', toggledThinking)
if (toggledThinking !== 'unavailable') {
  await sleep(300)
  await type('这次打开深度思考再答一次。')
  const v32On = await waitSettled('这是 deepseek-ai/DeepSeek-V3.2 的回答', 60_000)
  log('V3.2（思考开）回答:', v32On ? '已收到' : '超时')
}

// 6) 读 mock 侧记录，确认转换结果
const records = fs.existsSync(MOCK_LOG)
  ? fs
      .readFileSync(MOCK_LOG, 'utf8')
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .flatMap((line) => {
        try {
          const record = JSON.parse(line)
          // 预检记录没有 model，只保留真正的对话请求
          return record.preflight ? [] : [record]
        } catch {
          return []
        }
      })
  : []
log('mock 收到请求数:', records.length)
for (const record of records) {
  log(
    '  ',
    `model=${record.model.replace('deepseek-ai/', '')}`,
    `roles=${record.roles.join(',')}`,
    `systemFront=${record.systemAtFront}`,
    `thinking=${record.enable_thinking}`,
    `summary=${record.isSummary}`,
    `userChars=${record.userChars}`
  )
}

const has = (fn) => records.some(fn)
const checks = [
  ['V4.1-Flash 请求已到达', has((r) => r.model === 'deepseek-ai/DeepSeek-V4.1-Flash' && !r.isSummary)],
  ['R1 请求已到达', has((r) => r.model === 'deepseek-ai/DeepSeek-R1' && !r.isSummary)],
  ['V4.1 带 system 角色且在最前', has((r) => r.model.endsWith('Flash') && r.systemAtFront)],
  ['R1 把 system 并进用户消息', has((r) => r.model.endsWith('R1') && !r.roles.includes('system'))],
  ['V3.2 请求已到达', has((r) => r.model.endsWith('V3.2'))],
  ['V3.2 传了 enable_thinking=false', has((r) => r.model.endsWith('V3.2') && r.enable_thinking === false)],
  ['V3.2 思考打开后传了 true', has((r) => r.model.endsWith('V3.2') && r.enable_thinking === true)],
  ['V4.1 未传 enable_thinking', !has((r) => r.model.endsWith('Flash') && r.enable_thinking !== undefined)],
  ['R1 未传 enable_thinking', !has((r) => r.model.endsWith('R1') && r.enable_thinking !== undefined)],
  ['压缩请求已触发', has((r) => r.isSummary)],
  ['对话流式请求带 stream', has((r) => !r.isSummary && r.stream === true)],
  ['压缩提示在界面出现过', compressSeen],
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
