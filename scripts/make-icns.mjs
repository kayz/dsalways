/**
 * 用 build/icon-*.png 组装 macOS 的 .icns。
 *
 * electron-builder 也能从 png 转 icns，但它依赖 macOS 的 iconutil / 下载额外工具，
 * 在 Windows 上不可靠。ICNS 本身是极简容器（'icns' + 总长度 + 若干 [类型, 长度, PNG]），
 * 现代 macOS 的 icp4..ic10 都直接收 PNG 数据，所以自己拼最稳。
 */
import fs from 'node:fs'
import path from 'node:path'

/** type code → 像素边长；这些类型在 10.7+ 都接受 PNG 负载 */
const SLOTS = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

/** PNG 头里读真实尺寸，避免把放错的文件塞进错误的槽位 */
const pngSize = (buffer) => {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const BE32 = (value) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value, 0)
  return buffer
}

const build = () => {
  const dir = path.join(process.cwd(), 'build')
  const entries = []

  for (const [type, size] of SLOTS) {
    const file = path.join(dir, `icon-${size}.png`)
    if (!fs.existsSync(file)) {
      throw new Error(`make-icns: 缺少 ${file}（先跑 scripts/make-icons 或提供 icon-${size}.png）`)
    }
    const data = fs.readFileSync(file)
    const actual = pngSize(data)
    if (!actual || actual.width !== size || actual.height !== size) {
      throw new Error(
        `make-icns: ${path.basename(file)} 实际是 ${actual?.width}x${actual?.height}，期望 ${size}x${size}`,
      )
    }
    // 每项 = 4 字节类型 + 4 字节长度（含这 8 字节头）+ 数据
    entries.push(Buffer.concat([Buffer.from(type, 'ascii'), BE32(data.length + 8), data]))
  }

  const body = Buffer.concat(entries)
  const header = Buffer.concat([Buffer.from('icns', 'ascii'), BE32(body.length + 8)])
  const out = path.join(dir, 'icon.icns')
  fs.writeFileSync(out, Buffer.concat([header, body]))
  console.log(`  • icon.icns  ${(fs.statSync(out).size / 1024).toFixed(0)} KB  ${SLOTS.length} 个尺寸`)
}

build()
