# DS Always

把 DeepSeek 网页版的历史对话搬到本地，用自己的 API Key 继续聊。带**自动上下文压缩**和**长期记忆**，打包成 Windows / macOS 桌面应用，支持自动更新。

基于 DeepSeek 官方开源的 [`deepseek-ai/chat-demo`](https://github.com/deepseek-ai/chat-demo)（MIT）二次开发。

> **第三方客户端，非 DeepSeek 官方产品。** 图标、应用名、界面文字均与官方产品区分，避免与官方客户端混淆。

| 项目 | 值 |
| --- | --- |
| 本地路径 | `C:\git\dsalways` |
| 私有仓库 | `kayz/dsalways`（`origin`），上游为 `upstream` |
| 当前版本 | 1.0.2 |
| 平台 | Windows（NSIS 安装版 / 免安装版）、macOS（dmg / zip，arm64 + x64） |
| 更新源 | GitHub Release，私有仓库 + 只读令牌 |

## 它解决什么

DeepSeek 限制「长时间不活跃的长对话不能再发消息」之后，旧对话只能读不能续。官方导出包只有 JSON/ZIP，网页端也没法继续。这个工具做三件事：

1. **把导出的历史导入本地**，用你自己的 API Key 接着聊；
2. **长对话自动压缩**：占用到窗口 80% 才压缩，保留最近 20 轮原文，更早的滚成结构化摘要，不会爆上下文也不会丢关键信息；
3. **长期记忆**：每几轮自动抽一次「值得记住的事实」（身份/偏好/项目/技术/约定/结论/待办），下次对话自动带上，可手动增删置顶。

## 上游没有、这里新增的部分

| 模块 | 位置 | 说明 |
|---|---|---|
| Token 估算 | `src/services/assist/tokens.ts` | 中日韩按字、其余按 3.6 字符/token |
| 上下文规划 | `src/services/assist/context.ts` | 决定带哪些轮次原文、是否压缩 |
| 滚动摘要 | `src/services/assist/summary.ts` | 6000 token 一段，前段摘要喂后段，不会无限膨胀 |
| 长期记忆 | `src/services/assist/memory.ts` | 抽取、bigram 去重合并、相关度注入、上限淘汰 |
| 请求期编排 | `src/services/assist/runtime.ts` | 与 chat store 对接，压缩失败自动降级 |
| 新手引导 | `src/components/onboarding/` | 三步向导、剪贴板读 Key、整块拖放导入、文件夹自动打包 |
| 记忆面板 | `src/components/assist/` | 记忆增删置顶、人格设定、上下文参数与上次请求构成 |
| 桌面外壳 | `electron/` + `electron-builder.yml` | 自定义协议承载前端、CORS 兜底、剪贴板桥接 |

存储层新增两个 IndexedDB 存储（DB 版本 11 → 12）：`memories` 跨会话共享，`assist` 存每个会话的摘要进度。导入历史时会清空 `assist`（绑定消息 id），但保留 `memories`。

## 新手路径怎么设计的

目标用户不一定熟悉 API Key、ZIP、拖放这些概念，所以：

- **首次打开直接进三步向导**，不是丢进「设置 → 数据管理」让他自己找；
- **Key 那一步**：写明去哪拿、一键打开页面、**自动检测剪贴板**（桌面端由主进程读，不需要授权），检测到就出现「填入」按钮；
- **导入那一步**：整块区域可拖，**ZIP 和解压后的文件夹都收**（文件夹会在前端重新打包成 ZIP），也可以点按钮选文件或选文件夹；
- **错误说人话**：401 → 「API Key 无效」，断网 →「网络连接失败」，402 →「账户余额不足」，而不是抛一串英文；
- **引导可跳过**，设置里随时能补做。

## 开发

```bash
pnpm install
pnpm dev            # 浏览器开发，http://localhost:8090
pnpm app            # Electron 外壳 + 已构建的前端
pnpm type && pnpm lint
```

`pnpm dev` 跑的是浏览器环境，`window.porter` 桥接不存在，剪贴板读不到时会自动退回 `navigator.clipboard`。

### 跟随上游升级

```bash
git fetch upstream
git merge upstream/main
```

冲突会集中在 `src/services/settings.ts`、`src/services/chat/db.ts`、`src/services/chat/store.ts`、`src/i18n/*`、`src/components/sider/Sider.tsx`、`src/app/App.tsx` 六处——我们对上游的改动全是「加东西」，冲突好解。真正的风险是**上游改 IndexedDB schema**：我们已经把版本从 11 顶到 12，上游再动就得补迁移。每次合并后跑一遍「导入一个 ZIP + 聊两轮 + 打开记忆面板」的冒烟测试。

## 打包

```bash
pnpm build            # 只构建前端，产出 dist/
pnpm app:dist         # 本地打包：NSIS 安装包 + 免安装版（不发布）
node scripts/pack.mjs --publish   # 打包并上传到 GitHub Release（需要 GH_TOKEN）
node scripts/pack.mjs --dir       # 只出 release/win-unpacked，调试用
```

产物在 `release/`：

| 文件 | 说明 |
| --- | --- |
| `DS-Always-Setup-<版本>.exe` | NSIS 安装包，可选安装目录，装到 `%LOCALAPPDATA%\Programs\DSAlways`，建桌面和开始菜单「DS Always」快捷方式 |
| `DS-Always-Portable-<版本>.exe` | 免安装单文件，双击即用（**不支持自动更新**） |
| `latest.yml` + `.blockmap` | 自动更新的清单与差分数据，跟着 Release 一起上传 |

图标由 `build/icon.ico`（Windows）与 `build/icon.icns`（macOS）提供。换图标后重跑打包即可，`afterPack` 钩子会把新图标写进 exe；`build/icon.icns` 由 `node scripts/make-icns.mjs` 从同名 PNG 生成。

本机需要的镜像变量（GitHub 直连容易被卡）：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### macOS

配置已就绪（`dmg` + `zip`，`arm64` 与 `x64` 双架构，`build/entitlements.mac.plist`），但**只能在 macOS 上打**——`dmg` 依赖 `hdiutil`，签名依赖 `codesign`。两条路：

- 本地：在 Mac 上 `pnpm install && node scripts/pack.mjs`
- CI：推一个 `v*` 标签，`.github/workflows/release.yml` 会用 `macos-latest` 跑，产物自动传到同一个 Release

未签名时 Gatekeeper 会拦：用户首次打开需要 `右键 → 打开`，或执行 `xattr -dr com.apple.quarantine "/Applications/DS Always.app"`。要让 macOS 自动更新真正可用，还需要 Apple Developer 账号（$99/年）做 `codesign` + 公证，否则 `autoUpdater` 会因签名校验失败而拒绝安装。

### 为什么关掉 `signAndEditExecutable`

`electron-builder.yml` 里设了 `win.signAndEditExecutable: false`，这不是图省事：

electron-builder 给 exe 写图标/版本号时会先取 `winCodeSign` 归档（里面是 rcedit-x64.exe 和 signtool）。该归档里 `darwin/10.12/lib/libcrypto.dylib`、`libssl.dylib` 是**符号链接**，而在没开「开发者模式」的普通 Windows 账户上，进程没有 `SeCreateSymbolicLinkPrivilege`，7-Zip 解这两个条目会失败并以 `exit 2` 退出，electron-builder 判定解压失败 → 重试 4 次 → 整个打包中止。报错长这样：

```
ERROR: Cannot create symbolic link : 客户没有所需的特权 :
...\Cache\winCodeSign\<随机数>\darwin\10.12\lib\libcrypto.dylib
```

我们本来就没有代码签名证书（签不了名），所以直接跳过这条链路，改用 `scripts/after-pack.cjs`：纯 JS 的 `resedit` 直接改 PE 资源，写图标 + 版本信息（FileVersion / ProductName / Copyright 等），无原生依赖、无符号链接、不需要管理员权限。app-builder-lib 内部写 asar integrity 资源用的也是这个库。

### 验证环境的一个坑

安装包**不能在受限沙箱里跑**：NSIS 会把插件解到 `%TEMP%\nsXXXX.tmp` 再加载 `System.dll`，沙箱的注入会让它以 `0xC0000005`（访问冲突）崩掉，看起来像打包坏了。在正常桌面上双击、或在无沙箱的终端里 `Start-Process` 都正常，实测静默安装 `exit=0`。

## 自动更新

更新源写在安装包的 `resources/app-update.yml`，由 `electron-builder.yml` 里的 `publish` 生成：

```yaml
publish:
  provider: github
  owner: kayz
  repo: dsalways
  private: true
```

客户端是 `electron-updater`：启动后从 `设置 → 关于与更新` 手动检查（`autoDownload = false`，是否下载由用户点），下载完点「重启并安装」，退出时也会自动装上已下载的包。NSIS 的 blockmap 让 96 MB 的包只下几 MB 的差量。

私有仓库意味着**匿名请求读不到 `latest.yml`**（GitHub 返回 404）。三种处理方式，按推荐度排：

| 方案 | 做法 | 体验 | 风险 |
| --- | --- | --- | --- |
| A. 内置**细粒度**只读令牌（推荐） | 建一个 Fine-grained PAT，仅勾 `kayz/dsalways`、权限 `Contents: Read-only`，打包时 `GH_UPDATE_TOKEN=<token> node scripts/pack.mjs --publish` | 用户零操作，开箱能更新 | 令牌在安装包里（`resources/app-update.yml`），拿到安装包的人都能读；范围仅限这一个仓库的只读 |
| B. 用户自己粘贴令牌 | 打包时不设 `GH_UPDATE_TOKEN`，用户在设置里填 | 开箱不能更新，会明确提示「请填写只读更新令牌」 | 泄露面为零 |
| C. 仓库改公开（只公开产物） | `publish` 里去掉 `private: true`，或另建一个只放二进制的公开仓库 | 零操作 | 源码/产物对所有人可见 |

**不要把 `gh auth token` 那种全权限令牌打进安装包**——它带 `repo`、`workflow` 等全部授权，一旦安装包外流，等于交出整个账号。这也是 v1.0.2 之前两个构建被删掉重发的原因。

`--publish` 用的是 `GH_TOKEN`（发布权限），只有 `GH_UPDATE_TOKEN` 才会被写进 `app-update.yml`，两者不要混用。

免安装版（`PORTABLE_EXECUTABLE_DIR` 存在时）会被识别出来并禁用更新——它没有固定安装位置，`autoUpdater` 换不了自己。

## 技术要点

- Electron 用 **`app://porter/` 自定义协议**加载前端，而不是 `file://`。`file://` 在 Chromium 里是不透明源，IndexedDB 会被分区甚至拒绝；自定义标准安全源下 localStorage / IndexedDB / 剪贴板权限都正常。
- 启动脚本会**剔除 `ELECTRON_RUN_AS_NODE`**。宿主环境把这个变量传进子进程时，`electron.exe` 会退化成纯 Node，`require('electron')` 只返回路径字符串，表现为启动即崩。
- 对 `api.deepseek.com` 的响应做 **CORS 兜底**：没带 `Access-Control-Allow-Origin` 时补上，避免自定义协议下被拦。

## 验证记录

装好的 exe 实测过（`%LOCALAPPDATA%\Programs\DSAlways\DSAlways.exe`，CDP 探针）：

- 页面源是 `app://porter`，`document.title` = DS Always，asar 里的 `dist` 能正常加载；
- `localStorage`、`IndexedDB`（含新加的 `memories` / `assist`）都可用；
- `window.porter` 桥接存在，主进程读剪贴板拿到 441 字符；
- 从 `app://` 源直接 `fetch` `https://api.deepseek.com/anthropic/v1/messages`，GET 和 POST 都拿到了**可读的响应体**（无效 Key 的 401 JSON），说明自定义协议下跨域没被拦，真实 Key 能直连；
- 首次启动自动弹三步向导，浅色/深色两套主题都拍过图确认排版。

功能链路（导入 → 连续对话 → 压缩 → 记忆）在浏览器构建里用拦截的 mock 接口跑通过：导入一个 v3 格式 ZIP 后连聊 3 轮，压缩请求发了 2 次、记忆抽取发了 2 次，面板显示「原文 2 轮 / 记忆 3 条 / 摘要 67 / 已压缩 4 轮」。

自动更新整条链路用真实私有仓库验收过（1.0.1 → 1.0.2，全部通过界面点击，不调内部接口）：

1. 未填令牌点「检查更新」→ 提示「更新源是私有仓库：请先在下方填写只读更新令牌…」，不是 404；
2. 粘贴令牌 → 保存后自动重查 → 「发现新版本 1.0.2」；
3. 点「下载更新」→ 进度条走完 → 「新版本已下载，重启后安装」，安装按钮 `opacity: 1`、可点击。

## 已知限制

- 导入是**覆盖式**：一次导入会替换全部本地对话（上游设计如此）。向导里会提示当前已有多少个对话。
- 只支持上游 `export_format_version: 3` 的归档格式。
- 摘要与记忆抽取走 `deepseek-flash`，会产生额外 token 费用；压缩只在超过阈值时触发，记忆默认每 6 条回复一次，都可以在面板里调。
- 未做代码签名，安装时 Windows SmartScreen 可能提示「未知发布者」；macOS 未签名则要用户手动放行。
- 私有仓库的自动更新需要令牌（见上文三种方案），免安装版不支持自动更新。

## 许可

代码沿用上游 MIT 许可，见 `LICENSE`。二次开发部分的修改同样以 MIT 发布。MIT 只覆盖代码，**不覆盖 DeepSeek 的商标与品牌**，本项目据此不使用官方 logo。
