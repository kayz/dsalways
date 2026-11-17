/**
 * 落地日志：打包后的应用没有终端，出问题只能靠文件。
 * 统一写到 userData/logs/<file>，单个文件超过上限就先清空，避免无限增长。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 每个文件只解析一次路径 */
const paths = new Map()
const DEFAULT_LIMIT = 512 * 1024

/**
 * 追加一行。任何失败都吞掉——日志坏了不能连带把功能弄坏。
 * @param {string} file 文件名，如 'updater.log'
 * @param {string} level info / warn / error / debug
 * @param {unknown[]} parts 空格连接，Error 取 name + message
 * @param {number} [maxBytes] 超过这个大小就先清空
 */
export const appendLog = (file, level, parts, maxBytes = DEFAULT_LIMIT) => {
  try {
    let logPath = paths.get(file)
    if (!logPath) {
      const dir = path.join(app.getPath('userData'), 'logs')
      fs.mkdirSync(dir, { recursive: true })
      logPath = path.join(dir, file)
      paths.set(file, logPath)
      try {
        if (fs.statSync(logPath).size > maxBytes) {
          fs.truncateSync(logPath, 0)
        }
      } catch {
        // 文件还不存在
      }
    }
    const text = parts
      .map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : String(part)))
      .join(' ')
    fs.appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${text}\n`)
  } catch {
    // 写不进去也不能影响主流程
  }
}

/** 渲染进程上报的单行数据：去掉换行，防止一条日志被拆成多行 */
export const appendReport = (file, line) => {
  appendLog(file, 'info', [String(line).replace(/\s+/g, ' ').slice(0, 2000)], 2 * 1024 * 1024)
}
