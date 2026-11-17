import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** 跨平台构建：不用 shell 的 rm -rf / NODE_ENV=，Windows 上 pnpm 走 cmd 会直接失败 */
const require = createRequire(import.meta.url)
const rspackBin = path.join(
  path.dirname(require.resolve('@rspack/cli/package.json')),
  'bin',
  'rspack.js'
)

rmSync('dist', { recursive: true, force: true })

const child = spawn(process.execPath, [rspackBin, 'build', '-c', 'rspack.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})
child.on('exit', (code) => process.exit(code ?? 1))
