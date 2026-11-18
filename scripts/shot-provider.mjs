/**
 * 拍「设置 → 模型接入」的截图，并顺带核对三处状态：
 *   1) 选 DeepSeek 官方时，不应出现任何硅基流动的信息；
 *   2) 选硅基流动但没填 Key 时，不应出现模型选择；
 *   3) 填了 Key 之后才出现「当前模型 / 切换模型」。
 *
 *   node scripts/shot-provider.mjs                    # 用已安装版本，输出到 shots/
 *   DSALWAYS_EXE='release\win-unpacked\DSAlways.exe' node scripts/shot-provider.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9367)
const OUT_DIR = process.env.SHOT_DIR ?? 'shots'
const KEY_PROVIDER = 'chat-demo:provider'
const KEY_SF = 'chat-demo:siliconflow-key'
const KEY_THEME = 'chat-demo:theme-preference'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[shot]', ...parts)

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

const launch = async () => {
  killApp()
  await sleep(800)
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'electron_run_as_node') delete env[key]
  }
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
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
  return { child, target }
}

const connect = async (target) => {
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
  return { ws, send, evaluate }
}

/** 侧边栏底部的设置入口：按 aria-label / title / 文案依次找 */
const openSettings = async (evaluate) => {
  const opened = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"]')]
    const hit = nodes.find((el) => {
      const label = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim()
      return label === '设置' || label === 'Settings'
    })
    if (!hit) return { ok: false }
    hit.click()
    return { ok: true }
  })()`)
  if (!opened.ok) throw new Error('没找到设置入口')
  await sleep(1200)
  const section = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[role="dialog"] *')]
    const hit = nodes.reverse().find((el) => (el.textContent || '').trim() === '模型接入')
    if (!hit) return { ok: false }
    hit.click()
    return { ok: true }
  })()`)
  if (!section.ok) throw new Error('没找到「模型接入」分组')
  await sleep(1200)
}

const panelText = `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  return dialog ? dialog.innerText.replace(/\\n+/g, ' | ').slice(0, 600) : '(no dialog)'
})()`

const run = async (client, { theme, provider, siliconflowKey, file }) => {
  const { send, evaluate } = client
  await evaluate(`(() => {
    localStorage.setItem('${KEY_THEME}', '${theme}')
    localStorage.setItem('${KEY_PROVIDER}', '${provider}')
    ${siliconflowKey ? `localStorage.setItem('${KEY_SF}', '${siliconflowKey}')` : `localStorage.removeItem('${KEY_SF}')`}
    return true
  })()`)
  send('Page.reload', {}).catch(() => {})
  await sleep(2600)
  const toolbar = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[aria-label]')]
    return nodes
      .map((el) => el.getAttribute('aria-label'))
      .filter((label) => label && (label.includes('切换模型') || label.includes('模型')))
  })()`)
  log(`${file} 工具栏模型控件:`, JSON.stringify(toolbar))
  await openSettings(evaluate)
  const text = await evaluate(panelText)
  log(`${file} 面板文案:`, text)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(shot.data, 'base64'))
  log('已保存', path.join(OUT_DIR, file))
}

const { child, target } = await launch()
log('启动 PID', child.pid)
const client = await connect(target)
const { send, evaluate } = client

// 备份用户真实配置：截图需要把 Key 写成 dummy 并切通道，跑完必须还原，
// 否则用户下次打开应用会变成一把假 Key。
const original = await evaluate(`(() => ({
  key: localStorage.getItem('${KEY_SF}'),
  provider: localStorage.getItem('${KEY_PROVIDER}'),
  theme: localStorage.getItem('${KEY_THEME}'),
  model: localStorage.getItem('chat-demo:siliconflow-model'),
  officialModel: localStorage.getItem('chat-demo:deepseek-model'),
}))()`)
log('原配置已备份:', original.key ? `Key 长度 ${original.key.length}` : '无 Key')

/** 点开工具栏下拉，选一项，验证界面交互真的写进了设置 */
const switchModelViaUi = async (label) => {
  const { evaluate } = client
  const opened = await evaluate(`(() => {
    const trigger = document.querySelector('[aria-label="切换模型"]')
    if (!trigger) return { ok: false }
    trigger.click()
    return { ok: true }
  })()`)
  if (!opened.ok) throw new Error('工具栏没有模型下拉')
  await sleep(900)
  const picked = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[role="option"]')]
    const hit = nodes.find((el) => (el.textContent || '').trim() === ${JSON.stringify(label)})
    if (!hit) {
      return {
        ok: false,
        options: [...document.querySelectorAll('[role="option"]')].map((el) => (el.textContent || '').trim()),
      }
    }
    hit.click()
    return { ok: true }
  })()`)
  await sleep(700)
  const state = await evaluate(`(() => ({
    provider: localStorage.getItem('chat-demo:provider'),
    deepseek: localStorage.getItem('chat-demo:deepseek-model'),
    siliconflow: localStorage.getItem('chat-demo:siliconflow-model'),
  }))()`)
  log(
    `界面选「${label}」→ ${picked.ok ? '已点击' : `没找到选项，当时菜单里是 ${JSON.stringify(picked.options)}`}，通道=${state.provider} 官方模型=${state.deepseek} 硅基流动模型=${state.siliconflow}`
  )
  return state
}

try {
  await run(client, { theme: 'light', provider: 'deepseek', file: 'provider-official.png' })
  // 关掉设置弹窗，回到对话页再拍下拉
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      ...(type === 'keyDown' ? { text: '\u001b' } : {}),
    })
  }
  await sleep(800)
  // 展开模型下拉拍一张：确认 5 个模型同屏、按通道分组显示
  const openMenu = await evaluate(`(() => {
    const trigger = document.querySelector('[aria-label="切换模型"]')
    if (!trigger) return { ok: false }
    trigger.click()
    return { ok: true }
  })()`)
  if (openMenu.ok) {
    await sleep(700)
    const labels = await evaluate(
      `(() => [...document.querySelectorAll('[role="option"]')].map((el) => (el.textContent || '').trim()))()`
    )
    log('下拉里的模型项:', JSON.stringify(labels))
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT_DIR, 'model-menu.png'), Buffer.from(shot.data, 'base64'))
    log('已保存', path.join(OUT_DIR, 'model-menu.png'))
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        ...(type === 'keyDown' ? { text: '\u001b' } : {}),
      })
    }
    await sleep(500)
  }
  await switchModelViaUi('官方 · V4 Pro')
  // 从合并列表里选硅基流动的模型，应当顺带把通道切过去
  await switchModelViaUi('硅基流动 · V3.2')
  await switchModelViaUi('硅基流动 · R1')
  await run(client, { theme: 'light', provider: 'siliconflow', file: 'provider-sf-nokey.png' })
  await run(client, {
    theme: 'light',
    provider: 'siliconflow',
    siliconflowKey: 'sk-verify-dummy-key',
    file: 'provider-sf-withkey.png',
  })
  await run(client, {
    theme: 'dark',
    provider: 'siliconflow',
    siliconflowKey: 'sk-verify-dummy-key',
    file: 'provider-sf-dark.png',
  })
} finally {
  // 还原被截图改写过的配置，并让 localStorage 真正落盘（强杀会丢掉刚写入的删除）
  try {
    await evaluate(`(() => {
      const original = ${JSON.stringify(original)}
      const put = (name, value) => {
        if (value === null || value === undefined) localStorage.removeItem(name)
        else localStorage.setItem(name, value)
      }
      put('${KEY_SF}', original.key)
      put('${KEY_PROVIDER}', original.provider)
      put('${KEY_THEME}', original.theme)
      put('chat-demo:siliconflow-model', original.model)
      put('chat-demo:deepseek-model', original.officialModel)
      return true
    })()`)
    log('已恢复原配置')
    await sleep(1200)
    await Promise.race([send('Browser.close').catch(() => {}), sleep(1500)])
    await sleep(800)
  } catch (error) {
    log('恢复配置失败:', String(error))
  }
  try {
    client.ws.close()
  } catch {
    // 已断开
  }
  killApp()
}
