/**
 * 本地 mock：一个最小的 SiliconFlow / OpenAI 兼容服务，用于在没有真实 Key 的情况下
 * 验证「请求转换 + 流式翻译 + 界面渲染」整条链路。
 *
 * 启动：node scripts/mock-siliconflow.mjs
 * 应用侧指向它：localStorage['chat-demo:siliconflow-origin'] = 'http://127.0.0.1:8899/v1'
 *
 * 它会把收到的每次请求（模型、角色序列、system 是否在首位）打到 stdout，
 * 方便断言转换结果，而不是只看界面有没有字。
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8899)

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })

const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const server = createServer(async (req, res) => {
  // 故意不实现 OPTIONS：模拟真实服务端不回 CORS 头的情况，验证主进程的预检兜底
  if (req.method === 'OPTIONS') {
    console.log(JSON.stringify({ at: new Date().toISOString(), preflight: req.url }))
    res.writeHead(405).end()
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'deepseek-ai/DeepSeek-V4.1-Flash', object: 'model' },
          { id: 'deepseek-ai/DeepSeek-V3.2', object: 'model' },
          { id: 'deepseek-ai/DeepSeek-R1', object: 'model' },
        ],
      })
    )
    return
  }

  if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    res.writeHead(400).end('bad json')
    return
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const roles = messages.map((message) => message.role)
  const system = messages.find((message) => message.role === 'system')
  const systemText = String(system?.content ?? '')
  const isSummary = systemText.includes('对话记忆压缩器')
  // 摘要 / 记忆抽取都是内部请求，不能算进「对话请求前缀稳定性」的比较
  const isInternal = isSummary || systemText.includes('长期记忆提取器')
  const userText = messages.filter((message) => message.role === 'user').at(-1)?.content ?? ''

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      model: body.model,
      roles,
      systemAtFront: roles[0] === 'system',
      enable_thinking: body.enable_thinking,
      max_tokens: body.max_tokens,
      stream: body.stream,
      isSummary,
      isInternal,
      userChars: userText.length,
      userHead: String(userText).slice(0, 40),
      // 1.3.0 组装协议：普通记忆不再进 system，只按需召回拼在最后一条用户消息前
      systemHead: systemText.slice(0, 160),
      systemHasLongTerm: systemText.includes('【长期记忆】'),
      systemHasPinned: systemText.includes('【置顶记忆】'),
      userHasRecall: String(userText).includes('【相关记忆】'),
    })
  )

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const model = String(body.model ?? '')
  const reasoning = model.endsWith('DeepSeek-R1')
  const answer = isSummary
    ? '【摘要】用户在做本地客户端联调，已确认通道切换、模型切换与压缩提示都正常。'
    : `这是 ${model} 的回答。收到 ${messages.length} 条消息，system ${system ? '存在' : '不存在'}，思考开关 ${body.enable_thinking === undefined ? '未传' : String(body.enable_thinking)}。`

  if (reasoning) {
    for (const piece of ['先想一下：', '用户在做联调，', '按流程回答即可。']) {
      sse(res, { choices: [{ delta: { reasoning_content: piece }, finish_reason: null }] })
      await sleep(60)
    }
  }

  for (const piece of answer.match(/.{1,6}/gs) ?? [answer]) {
    sse(res, { choices: [{ delta: { content: piece }, finish_reason: null }] })
    await sleep(40)
  }

  sse(res, {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1234, completion_tokens: 56, prompt_cache_hit_tokens: 1000 },
  })
  res.write('data: [DONE]\n\n')
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock siliconflow on http://127.0.0.1:${PORT}/v1`)
})
