import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
/** 在普通 Node 里 require('electron') 返回可执行文件路径 */
const electronPath = require('electron')

/**
 * 宿主环境可能把 ELECTRON_RUN_AS_NODE 传进子进程，
 * 那样 electron.exe 会退化成纯 Node，require('electron') 只拿到路径字符串，
 * 表现为 app 为 undefined、启动即崩。启动前统一剔除。
 */
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') {
    delete env[key]
  }
}
delete env.ELECTRON_NO_ATTACH_CONSOLE

const args = ['.', ...process.argv.slice(2)]
const child = spawn(electronPath, args, { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
