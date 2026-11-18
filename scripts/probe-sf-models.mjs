/**
 * 探测硅基流动到底提供哪些 DeepSeek 模型、以及当前注册表里的模型是否真的可用。
 * 只读应用里已保存的 Key，不改任何设置；每个模型最多花几十个 token。
 *
 *   node scripts/probe-sf-models.mjs
 *   node scripts/probe-sf-models.mjs --list-only     # 只列模型，不发对话请求
 */
import { spawn, execFileSync } from 'node:child_process'

const EXE =
  process.env.DSALWAYS_EXE ?? 'C:\\Users\\kayz\\AppData\\Local\\Programs\\DSAlways\\DSAlways.exe'
const PORT = Number(process.env.CDP_PORT ?? 9371)
const BASE = process.env.SF_BASE ?? 'https://api.siliconflow.cn/v1'
const LIST_ONLY = process.argv.includes('--list-only')
/** 当前注册表里的三个 + 用户想加的 V4 Pro 候选名 */
const CANDIDATES = (
  process.env.MODELS ??
  [
    'deepseek-ai/DeepSeek-V4.1-Flash',
    'deepseek-ai/DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-R1',
    'deepseek-ai/DeepSeek-V4-Pro',
  ].join(',')
).split(',')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[sf-probe]', ...parts)

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

const key = await evaluate(`localStorage.getItem('chat-demo:siliconflow-key') || ''`)
const official = await evaluate(`Boolean(localStorage.getItem('chat-demo:api-key'))`)
log('已保存硅基流动 Key:', key ? `${key.slice(0, 6)}…${key.slice(-4)}（长度 ${key.length}）` : '无')
log('已保存官方 Key:', official)

if (!key) {
  ws.close()
  killApp()
  process.exit(2)
}

// 关键：Key 先拿到内存里，再让应用优雅退出——强杀会丢掉未落盘的 localStorage，
// 用户下次打开还得重填。这里等落盘后用 Browser.close 正常关闭。
await sleep(1200)
try {
  await Promise.race([send('Browser.close').catch(() => {}), sleep(1500)])
} catch {
  // 忽略
}
await sleep(800)
killApp()

const auth = { authorization: `Bearer ${key}` }
const listRes = await fetch(`${BASE}/models`, { headers: auth })
const listText = await listRes.text()
log(`GET /models → HTTP ${listRes.status}（${listRes.headers.get('content-type')}）`)

if (!listRes.ok) {
  log('响应:', listText.slice(0, 500))
  process.exit(3)
}

let modelIds = []
try {
  const parsed = JSON.parse(listText)
  modelIds = (parsed.data ?? []).map((item) => item.id)
} catch {
  log('模型列表解析失败:', listText.slice(0, 300))
  process.exit(3)
}

const deepseek = modelIds.filter((id) => /deepseek/i.test(id)).sort()
log(`共 ${modelIds.length} 个模型，其中 DeepSeek 系 ${deepseek.length} 个：`)
for (const id of deepseek) log('  -', id)

if (LIST_ONLY) process.exit(0)

/** 参数组合：先 plain，成功后依次试思考开关；不同模型认的参数不一样，逐个试出来 */
const VARIANTS = [
  { name: 'plain', extra: {} },
  { name: 'enable_thinking=false', extra: { enable_thinking: false } },
  { name: 'enable_thinking=true', extra: { enable_thinking: true } },
  { name: 'thinking_budget=4096', extra: { thinking_budget: 4096 } },
]

const call = async (model, extra, maxTokens = 24) => {
  const started = Date.now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: 'user', content: '只回复两个字：收到' }],
        ...extra,
      }),
    })
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      return {
        ok: res.ok,
        status: res.status,
        ms: Date.now() - started,
        content: json.choices?.[0]?.message?.content ?? '',
        reasoning: json.choices?.[0]?.message?.reasoning_content ?? '',
        finish: json.choices?.[0]?.finish_reason ?? '',
        usage: json.usage ?? null,
        error: res.ok ? '' : (json.message ?? json.error?.message ?? text.slice(0, 200)),
      }
    } catch {
      return { ok: res.ok, status: res.status, ms: Date.now() - started, error: text.slice(0, 200) }
    }
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(error) }
  }
}

log('')
log('=== 逐模型实测（非流式，max_tokens=24） ===')
const results = []
for (const model of CANDIDATES) {
  const inList = modelIds.includes(model)
  log(`— ${model}（在 /models 列表中: ${inList ? '是' : '否'}）`)

  const base = await call(model, {})
  results.push({ model, variant: 'plain', inList, ...base })
  if (base.ok) {
    log(
      `  ✓ plain → HTTP ${base.status}（${base.ms}ms）内容=${JSON.stringify(base.content)} 推理=${base.reasoning ? `有(${base.reasoning.length}字)` : '无'} finish=${base.finish}`
    )
    log(`    usage=${JSON.stringify(base.usage)}`)

    for (const variant of VARIANTS.slice(1)) {
      const out = await call(model, variant.extra)
      results.push({ model, variant: variant.name, inList, ...out })
      log(
        `  ${out.ok ? '✓' : '✗'} ${variant.name} → HTTP ${out.status}（${out.ms}ms）${
          out.ok
            ? `内容=${JSON.stringify(out.content)} 推理=${out.reasoning ? '有' : '无'} finish=${out.finish}`
            : `错误=${String(out.error).replace(/\s+/g, ' ')}`
        }`
      )
    }
  } else {
    log(`  ✗ plain → HTTP ${base.status}（${base.ms}ms）错误=${String(base.error).replace(/\s+/g, ' ')}`)
  }
  log('')
}

log('=== 汇总：模型是否可用 ===')
const byModel = new Map()
for (const item of results) {
  const slot = byModel.get(item.model) ?? { plain: null, okVariants: [], badVariants: [] }
  if (item.variant === 'plain') slot.plain = item
  else if (item.ok) slot.okVariants.push(item.variant)
  else slot.badVariants.push(item.variant)
  byModel.set(item.model, slot)
}
for (const [model, slot] of byModel) {
  const verdict = slot.plain?.ok ? '可用' : '不可用'
  log(
    `${model}\t${verdict}\tHTTP ${slot.plain?.status ?? '-'}\t在列表=${slot.plain?.inList ? '是' : '否'}\t认的参数=${slot.okVariants.length ? slot.okVariants.join(' / ') : '（未测或全不认）'}`
  )
}
