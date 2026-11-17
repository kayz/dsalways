/**
 * 故障注入代理：只用来验证「断流自动续写」，不参与打包。
 *
 * 用法：先 `node scripts/fault-proxy.mjs`，再用
 *   DSAlways.exe --proxy-server=127.0.0.1:8899
 * 启动应用，它的 HTTPS 请求会走这里。前 CUT_CONNECTIONS 个到 api.deepseek.com 的
 * 隧道在 CUT_AFTER_MS 之后被强制掐断（等于网络中途掉线），之后的连接正常放行，
 * 用来看客户端会不会自己从断点接着写。
 *
 * 环境变量：PROXY_PORT / CUT_CONNECTIONS / CUT_AFTER_MS / PROXY_ONLY / PROXY_TTL_MS
 */
import http from 'node:http'
import net from 'node:net'

const PORT = Number(process.env.PROXY_PORT ?? 8899)
const CUT = Number(process.env.CUT_CONNECTIONS ?? 1)
const CUT_AFTER_MS = Number(process.env.CUT_AFTER_MS ?? 10_000)
const ONLY = process.env.PROXY_ONLY ?? 'api.deepseek.com'
const TTL_MS = Number(process.env.PROXY_TTL_MS ?? 10 * 60_000)

const log = (text) => process.stdout.write(`${new Date().toISOString()} ${text}\n`)

let tunnels = 0
let cuts = 0

const server = http.createServer((_req, res) => {
  res.writeHead(400, { 'Content-Type': 'text/plain' })
  res.end('CONNECT only')
})

server.on('connect', (req, clientSocket, head) => {
  const [host, portText] = (req.url ?? '').split(':')
  const port = Number(portText ?? 443)
  tunnels += 1
  const index = tunnels
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head && head.length > 0) {
      upstream.write(head)
    }
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })

  if ((!ONLY || host === ONLY) && cuts < CUT) {
    cuts += 1
    log(`arming cut #${cuts} on tunnel ${index} (${host})`)
    const timer = setTimeout(() => {
      log(`cut #${cuts} fired on tunnel ${index} (${host})`)
      upstream.destroy()
      clientSocket.destroy()
    }, CUT_AFTER_MS)
    timer.unref?.()
  } else {
    log(`pass tunnel ${index} (${host})`)
  }

  const close = () => {
    upstream.destroy()
    clientSocket.destroy()
  }
  upstream.on('error', close)
  clientSocket.on('error', close)
  clientSocket.on('close', () => upstream.destroy())
})

server.listen(PORT, '127.0.0.1', () => {
  log(`listening 127.0.0.1:${PORT} cut=${CUT} after=${CUT_AFTER_MS}ms only=${ONLY ?? '*'}`)
})

setTimeout(() => {
  log('ttl reached, exiting')
  server.close()
  process.exit(0)
}, TTL_MS).unref?.()
