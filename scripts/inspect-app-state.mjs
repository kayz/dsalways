/**
 * 只读检查应用 localStorage 里与模型接入相关的状态（Key 打码）。
 * 用于排查「网络错误」这类问题：先看请求到底发去哪、Key 存了什么。
 *
 *   node scripts/inspect-app-state.mjs
 */
import { spawn, execFileSync } from 'node:child_process'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9373)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[state]', ...parts)

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

const snapshot = await evaluate(`(() => {
  const mask = (value) => {
    if (!value) return null
    return value.length <= 8 ? value : value.slice(0, 6) + '…' + value.slice(-4) + '（长度 ' + value.length + '）'
  }
  return {
    provider: localStorage.getItem('chat-demo:provider'),
    siliconflowKey: mask(localStorage.getItem('chat-demo:siliconflow-key')),
    officialKey: mask(localStorage.getItem('chat-demo:api-key')),
    siliconflowOrigin: localStorage.getItem('chat-demo:siliconflow-origin'),
    siliconflowModel: localStorage.getItem('chat-demo:siliconflow-model'),
    deepseekModel: localStorage.getItem('chat-demo:deepseek-model'),
    contextLimit: localStorage.getItem('chat-demo:context-limit'),
  }
})()`)

log('provider            :', snapshot.provider)
log('硅基流动 Key        :', snapshot.siliconflowKey)
log('官方 Key            :', snapshot.officialKey)
log('硅基流动请求改道地址:', snapshot.siliconflowOrigin ?? '（无，走官方域名）')
log('硅基流动模型        :', snapshot.siliconflowModel)
log('官方模型            :', snapshot.deepseekModel)
log('上下文上限          :', snapshot.contextLimit)

if (process.argv.includes('--restore-defaults')) {
  const restored = await evaluate(`(() => {
    // 验收脚本会把窗口压小以触发压缩，跑完必须还原，否则 1M 模型也会频繁压缩。
    const before = {
      contextLimit: localStorage.getItem('chat-demo:context-limit'),
      keepRecent: localStorage.getItem('chat-demo:keep-recent'),
      model: localStorage.getItem('chat-demo:siliconflow-model'),
    }
    localStorage.removeItem('chat-demo:context-limit')
    localStorage.removeItem('chat-demo:keep-recent')
    localStorage.setItem('chat-demo:siliconflow-model', 'deepseek-ai/DeepSeek-V4.1-Flash')
    return {
      before,
      after: {
        contextLimit: localStorage.getItem('chat-demo:context-limit'),
        keepRecent: localStorage.getItem('chat-demo:keep-recent'),
        model: localStorage.getItem('chat-demo:siliconflow-model'),
      },
    }
  })()`)
  log('')
  log('恢复前:', JSON.stringify(restored.before))
  log('恢复后:', JSON.stringify(restored.after), '（两项已删除 = 回默认：窗口跟随模型、保留 10 轮）')

  await sleep(1200)
  try {
    await Promise.race([send('Browser.close').catch(() => {}), sleep(1500)])
  } catch {
    // 忽略
  }
  await sleep(800)
}

if (process.argv.includes('--clear-origin')) {
  const removed = await evaluate(`(() => {
    const value = localStorage.getItem('chat-demo:siliconflow-origin')
    localStorage.removeItem('chat-demo:siliconflow-origin')
    return value
  })()`)
  log('')
  log(`已清除请求改道地址: ${removed ?? '（本来就没有）'}`)
  log('清除后内存中重读:', await evaluate(`localStorage.getItem('chat-demo:siliconflow-origin')`))

  // 关键：不能强杀。localStorage 是异步落盘的，Stop-Process -Force 会把刚删掉的键丢掉，
  // 下次启动又读回旧值。这里先等落盘，再用 Browser.close 让 Electron 正常退出。
  await sleep(1500)
  try {
    await send('Browser.close')
    log('已发送 Browser.close，等待优雅退出')
  } catch (error) {
    log('Browser.close 失败，退回强杀:', String(error))
  }
  for (let i = 0; i < 20; i += 1) {
    await sleep(500)
    try {
      const still = execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        '(Get-Process DSAlways -ErrorAction SilentlyContinue | Measure-Object).Count',
      ])
        .toString()
        .trim()
      if (still === '0') {
        log('进程已全部退出')
        break
      }
    } catch {
      // 忽略
    }
  }
}

ws.close()
killApp()
