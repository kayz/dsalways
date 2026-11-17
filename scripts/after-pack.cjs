/**
 * electron-builder afterPack 钩子：给 app 的 exe 写入图标与版本信息。
 *
 * 为什么不用 electron-builder 自带的 rcedit：
 *   它会先把 winCodeSign 归档解到缓存目录，而该归档里的 darwin/*.dylib 是符号链接；
 *   在未开启「开发者模式」的 Windows 上（普通用户没有 SeCreateSymbolicLinkPrivilege）
 *   7-Zip 解压这两个链接会失败并以 exit 2 退出，导致整个打包中止。
 *   见 electron-builder.yml 里 win.signAndEditExecutable: false 的说明。
 *
 * 这里改用纯 JS 的 resedit 直接改 PE 资源（app-builder-lib 内部对 asar integrity
 * 也是用它），无原生依赖、无符号链接、无需管理员权限。
 */
const fs = require('node:fs')
const path = require('node:path')

const { Data, NtExecutable, NtExecutableResource, Resource } = require('resedit')

const INFO = {
  FileDescription: 'DS Always',
  ProductName: 'DS Always',
  OriginalFilename: 'DSAlways.exe',
  CompanyName: 'kayz',
  LegalCopyright: '第三方客户端，与 DeepSeek 官方无关',
  InternalName: 'DSAlways',
}

const patchExecutable = (exePath, icoPath, version) => {
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const res = NtExecutableResource.from(exe)

  // 图标：替换 RT_GROUP_ICON 里 id=1 的组（electron.exe 默认主图标就是 1）
  if (icoPath && fs.existsSync(icoPath)) {
    const iconFile = Data.IconFile.from(fs.readFileSync(icoPath))
    Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      1033,
      iconFile.icons.map((item) => item.data),
    )
  }

  // 版本信息：保留原 block 结构，只改文件和产品版本号与字符串表
  const [vi] = Resource.VersionInfo.fromEntries(res.entries)
  if (vi) {
    const [major, minor, patch] = version.split('.').map((v) => Number.parseInt(v, 10) || 0)
    vi.setFileVersion(major, minor, patch, 0)
    vi.setProductVersion(major, minor, patch, 0)
    // 语言 1033 / 代码页 1200（UTF-16），才能放中文
    vi.setStringValues({ lang: 1033, codepage: 1200 }, INFO)
    vi.outputToResourceEntries(res.entries)
  }

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
}

exports.default = async (context) => {
  if (context.electronPlatformName !== 'win32') return

  const { appOutDir, packager } = context
  const exeName = `${packager.appInfo.productFilename}.exe`
  const exePath = path.join(appOutDir, exeName)

  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack: 找不到 ${exePath}`)
  }

  const icoPath = path.join(packager.projectDir, 'build', 'icon.ico')
  patchExecutable(exePath, icoPath, packager.appInfo.version)
  console.log(`  • patched exe resources  file=${exeName} icon=${path.basename(icoPath)} version=${packager.appInfo.version}`)
}
