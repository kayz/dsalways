/**
 * 打包入口：先构建前端，再按当前平台跑 electron-builder。
 *
 * 为什么不直接写 `pnpm build && electron-builder --win`：
 *   - Windows 的 cmd 不认 `VAR=value cmd` 这种前缀，环境变量得在这里设；
 *   - 私有 GitHub 仓库的更新令牌要在打包时注入 app-update.yml，
 *     而 electron-builder 只认命令行上的 -c.publish.token。
 *
 * 用法：
 *   node scripts/pack.mjs              # 打当前平台
 *   node scripts/pack.mjs --publish    # 打并上传到 GitHub Release（需要 GH_TOKEN）
 *   node scripts/pack.mjs --dir        # 只出免安装目录，不生成安装包（调试用）
 *
 * 相关环境变量：
 *   GH_UPDATE_TOKEN  只读 Contents 的细粒度令牌，写进 app-update.yml，客户端拉更新用
 *   GH_TOKEN         发布用的令牌（gh auth token 即可），只在 --publish 时需要
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const wantPublish = args.includes('--publish')
const dirOnly = args.includes('--dir')

const platformFlag = (() => {
  if (process.platform === 'win32') return '--win'
  if (process.platform === 'darwin') return '--mac'
  return '--linux'
})()

const platformName = platformFlag.slice(2)
console.log(`\n[pack] 目标平台：${platformName}${wantPublish ? '（打完后上传到 GitHub Release）' : ''}`)

// 1) 前端
const buildScript = path.join(import.meta.dirname, 'build.mjs')
const build = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' })
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

// 2) 组装 electron-builder 参数
const builderBin = path.join(
  path.dirname(require.resolve('electron-builder/package.json')),
  'cli.js'
)
const builderArgs = [builderBin, platformFlag]
if (dirOnly) {
  builderArgs.push('--dir')
}

const updateToken = process.env.GH_UPDATE_TOKEN?.trim()
if (updateToken) {
  builderArgs.push(`-c.publish.token=${updateToken}`)
  console.log('[pack] 已注入更新令牌 → app-update.yml')
} else {
  console.warn(
    '[pack] 未设置 GH_UPDATE_TOKEN：安装包仍会生成，但客户端拉不到私有仓库的更新。\n' +
      '       个人自用不受影响，给别人装就需要这个令牌（见 README「自动更新」）。'
  )
}

if (wantPublish) {
  if (!process.env.GH_TOKEN) {
    console.error('[pack] --publish 需要 GH_TOKEN（可用 `gh auth token` 取值）')
    process.exit(1)
  }
  builderArgs.push('--publish', 'always')
} else {
  builderArgs.push('--publish', 'never')
}

// 3) 打包
const result = spawnSync(process.execPath, builderArgs, { stdio: 'inherit' })
process.exit(result.status ?? 1)
