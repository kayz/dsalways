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
| 第二通道 | `src/services/providers.ts`、`src/services/api/siliconflow.ts` | 硅基流动 OpenAI 兼容接入，三模型白名单，窗口取小 |
| 前置指令 | `src/components/settings/ProviderSection.tsx` | 全局文本 + 会话级开关，拼在 system 最前 |
| 压缩提示 | `src/components/session/CompressNotice.tsx` | 「正在找回之前的对话…」+ 分段进度 |

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

### 本机打包/上传的两个坑

**1. `dist` 得先手工清。** 本机的安全层对批量删除有「单轮 50 个文件」上限，`pack.mjs` → `build.mjs` 里删 `dist`（150 多个文件）会被拦成
`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`。打包前先删一次，让 build 阶段删到的是空目录：

```powershell
[System.IO.Directory]::Delete("C:\git\dsalways\dist", $true)
```

**2. `gh` 上传要甩掉宿主注入的代理。** 会话里 `HTTP(S)_PROXY` 指向 `127.0.0.1:64044`，`gh release create` 会在 TLS 握手时超时（`net/http: TLS handshake timeout`），直连反而通：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  gh release create vX.Y.Z -R kayz/dsalways-releases --title "DS Always X.Y.Z" \
  --notes-file docs/发布说明-X.Y.Z.md release/DS-Always-Setup-X.Y.Z.exe \
  release/DS-Always-Portable-X.Y.Z.exe release/latest.yml release/DS-Always-Setup-X.Y.Z.exe.blockmap
```

产物已经打好时，用这条手工建 Release 比再跑一次 `--publish` 更省事，效果等价（`--publish` 只是把这两步串起来）。

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
  repo: dsalways-releases   # 只放产物的公开仓库
```

设计原则：**更新是发布方提供的能力，用户侧不填任何东西。**

- 源码在**私有仓库** `kayz/dsalways`，安装包与 `latest.yml` 放在**公开仓库** `kayz/dsalways-releases` 的 Release 里；
- 公开仓库意味着匿名就能读到更新清单 → 安装包里**不需要内置任何令牌**，也就没有「谁装谁有令牌」的风险；
- 客户端界面只有「检查更新 / 下载更新 / 重启并安装」三个动作，**没有让用户填 token 的输入框**，也**不提供「打开发布页」这类跳转到 GitHub 下载页的入口**——更新只在应用内完成。

客户端行为：启动 8 秒后自动查一次（太早会和首屏请求抢带宽），设置页里也能手动点「检查更新」；`autoDownload = false`，是否下载由用户点；下载完点「重启并安装」→ 应用退出 → 静默安装 → 新版本自动重开。NSIS 的 blockmap 让 80 MB 的包只下几 MB 的差量。

发布：`GH_TOKEN=$(gh auth token) node scripts/pack.mjs --publish`。`--publish` 用的 `GH_TOKEN` 只用来上传，**不会**写进安装包。

发布完必须核对一件事：**Release 不是草稿**。本机到 GitHub 的上传常在 90 MB 的 exe 上超时，`gh release create` 会留下一个 `Draft`，草稿不进「latest」，`/releases/latest/download/latest.yml` 仍指向上一版，用户端就检查不到新版本。

```bash
gh release view vX.Y.Z -R kayz/dsalways-releases --json isDraft,assets \
  -q '"draft=\(.isDraft)", (.assets[] | "\(.name) \(.size)")'
# 补传缺的资产（幂等）
gh release upload vX.Y.Z -R kayz/dsalways-releases <文件…> --clobber
# 草稿转正并设为最新
gh release edit vX.Y.Z -R kayz/dsalways-releases --draft=false --latest
```

上传完成后再比对一次资产 `size` 与本地文件字节数（GitHub 资产下载在本机也容易截断，装到一半报 `exit=2` 就是这个原因）。`/releases/latest` 的 302 在边缘节点有几十秒缓存，刚转正时可能还指向旧 tag，过一会儿再看。


如果哪天要改回「从私有源码仓库更新」：`publish.repo` 改成 `dsalways` 并加 `private: true`，再用 `GH_UPDATE_TOKEN=<细粒度只读 PAT> node scripts/pack.mjs --publish` 打包，令牌会被写进 `app-update.yml`。这种情况下**绝不能用 `gh auth token`**——它带 `repo`、`workflow` 全权限，安装包一旦外流等于交出整个账号。

免安装版（`PORTABLE_EXECUTABLE_DIR` 存在时）会被识别出来并禁用更新——它没有固定安装位置，`autoUpdater` 换不了自己。

## 模型接入：两个通道，三种模型

界面里是「设置 → 模型接入」：

| 通道 | 接口 | 能力 | Key |
| --- | --- | --- | --- |
| DeepSeek 官方 | Anthropic 兼容 `/anthropic/v1` | 内置联网搜索、附件、自动标题、语音与朗读 | 官方控制台 |
| 硅基流动 | OpenAI 兼容 `/chat/completions` | 只提供纯对话 | 硅基流动控制台 |

硅基流动只开放三个模型（刻意收紧，避免用户在几十个模型里选错），**在对话框左下角随时切换**：

| 模型 | 上下文 | 思考 | 说明 |
| --- | --- | --- | --- |
| `deepseek-ai/DeepSeek-V4.1-Flash` | 1M（1048576） | 不支持开关 | 默认，最便宜最快 |
| `deepseek-ai/DeepSeek-V3.2` | 164K（163840） | `enable_thinking` 可开关 | 平衡 |
| `deepseek-ai/DeepSeek-R1` | 164K（163840） | 始终思考 | 推理细但慢 |

实现要点（`src/services/api/siliconflow.ts`）：

- OpenAI 的 chunk 流被翻译成内部 `MessageStreamEvent`，上层渲染逻辑完全复用；
- `reasoning_content` 映射成思考块，`finish_reason` 映射成 `stop_reason`；
- **R1 按官方建议不加 system**，把指令并进第一条用户消息（`inlineSystem`）；
- `enable_thinking` 只发给 V3.2，其它模型不传，避免被服务端拒绝；
- 拿到 `finish_reason` 但没收到 `[DONE]` 也算完整回答，不误判成断流；
- 历史里的 `latest_reminder` 角色改成用户消息前面的一行「当前信息」，思考块与工具块在转换时丢弃（OpenAI 格式里没有对应位置）；
- 附件（`file_id`）无法跨通道，硅基流动下附件入口直接禁用。

**上下文窗口**：压缩阈值按 `min(用户设置, 模型窗口)` 计算（`src/services/providers.ts` 的
`effectiveContextLimit`）。早期模型只有 164K，一旦被当成 128K 以上使用，请求会被服务端
直接拒绝，所以这里必须取小值。

**压缩提示**：长对话首轮发送要先把早前轮次压成摘要，可能几十秒。界面在输入框上方给出
「正在找回之前的对话…（已整理 2/5 段）」并附带「第一次会慢一点」的说明，
而不是让用户对着转圈猜（`src/components/session/CompressNotice.tsx`）。

**前置指令**：设置 → 模型接入里可填一段文本，注入到 system 最前面（人格、记忆、摘要之前），
默认关闭；每个会话在输入框工具栏还有独立开关，互不影响。

界面按通道收敛，避免串味：选官方时不会出现硅基流动的注册链接与能力说明；硅基流动**没保存 Key 时**，
设置页的「当前模型 / 切换模型」与输入框的模型下拉都不出现——没 Key 时切模型没有意义
（1.1.1 修的就是这两处）。

## 技术要点

- Electron 用 **`app://porter/` 自定义协议**加载前端，而不是 `file://`。`file://` 在 Chromium 里是不透明源，IndexedDB 会被分区甚至拒绝；自定义标准安全源下 localStorage / IndexedDB / 剪贴板权限都正常。
- 启动脚本会**剔除 `ELECTRON_RUN_AS_NODE`**。宿主环境把这个变量传进子进程时，`electron.exe` 会退化成纯 Node，`require('electron')` 只返回路径字符串，表现为启动即崩。
- 对 `api.deepseek.com`、`api.siliconflow.cn` 做 **CORS 兜底**：缺 `Access-Control-Allow-Origin` 就补；带 `Authorization` 的请求会先发 OPTIONS 预检，而服务端不一定回 CORS 头（甚至直接 405），所以预检由主进程改写成 200 并补全 `Allow-Headers` / `Allow-Methods`。不做这一步，硅基流动的请求会在渲染进程里直接 `Failed to fetch`。
- 硅基流动的接口地址支持用 `localStorage['chat-demo:siliconflow-origin']` 覆盖，只用于本地 mock 联调。

## 长回答的稳定性：看门狗、自动续写、首字埋点

上游前端是「流断了就停在那儿」：`interrupted` 且没有错误正文时，界面既没有提示也不会重试，看起来就是"什么都没输出"。这里补了三层：

**1. 两级看门狗**（`src/services/api/client.ts`、`sse.ts`）

| 阶段 | 上限 | 判定 |
| --- | --- | --- |
| 等响应头（含长上下文 prefill） | 180 秒 | 连响应头都没来 → `ApiError('timeout')` |
| 流内字节间隔 | 120 秒 | ping、保活注释、正文增量都算活动，真空转 → `StreamIdleTimeout` → `timeout` |

看门狗只 abort 本次请求（内部 `AbortController`），不碰调用方的 signal，所以**超时不会被误记成"用户点了停止"**（两者在界面上文案完全不同）。

**2. 断流自动续写**（`src/services/chat/store.ts`）

`interrupted` / `timeout` 落到 catch 后，如果满足条件就把**已经写出的部分**当成末尾 assistant 前缀重发一次，最多 2 次：

- 回复仍可作前缀（客户端 `tool_use` 的轮次会被置 `prefix: false`）；
- 没有 `server_tool_use` / 搜索结果 / 模板块（这些不能进前缀）；
- 已写出正文，**或**深度思考已经带完整 signature（长上下文思考几十秒后断流，这种最不能白等）。

续写请求不走压缩与记忆注入（`prepared.prefix` 分支），避免破坏前缀语义；次数用完才落 `error`，界面提示「连接中断，回答没有写完。可以重新生成，或点「继续生成」接着往下写」。

**3. 首字耗时埋点**（`src/services/timing.ts`）

每次请求结束写一行 JSON 到 `%APPDATA%\ds-always\logs\timing.log`（超过 2 MB 自动清空）：

```json
{"at":"...","sessionId":"...","attempt":0,"messages":15,"chars":84213,
 "responseMs":507,"firstEventMs":522,"firstContentMs":1062,"totalMs":2546,"outcome":"done"}
```

`attempt` > 0 表示这一行是断流后的自动续写。看四个时间点就能判断慢在哪：`responseMs` 大 = 排队或 prefill 长（上下文太大）；`firstEventMs - responseMs` 大 = 服务端在建首字；`firstContentMs` 大 = 深度思考还没开始吐字；`totalMs` 大而前面都小 = 生成本身长。

复现断流不用改代码，`scripts/fault-proxy.mjs` 是个故障注入代理：

```bash
CUT_CONNECTIONS=1 CUT_AFTER_MS=2500 node scripts/fault-proxy.mjs
DSALWAYS_EXE='release\win-unpacked\DSAlways.exe' \
  EXTRA_ARGS="--proxy-server=127.0.0.1:8899" node scripts/verify-stream.mjs
```

它只掐 `api.deepseek.com` 的隧道，`CUT_CONNECTIONS` 个连接在 `CUT_AFTER_MS` 后断开，之后的放行——等于"网络掉一下又好了"。脚本会打印文本增长曲线、`timing.log` 里的每条埋点、最终提示文案。

## 验证记录

装好的 exe 实测过（`%LOCALAPPDATA%\Programs\DSAlways\DSAlways.exe`，CDP 探针）：

- 页面源是 `app://porter`，`document.title` = DS Always，asar 里的 `dist` 能正常加载；
- `localStorage`、`IndexedDB`（含新加的 `memories` / `assist`）都可用；
- `window.porter` 桥接存在，主进程读剪贴板拿到 441 字符；
- 从 `app://` 源直接 `fetch` `https://api.deepseek.com/anthropic/v1/messages`，GET 和 POST 都拿到了**可读的响应体**（无效 Key 的 401 JSON），说明自定义协议下跨域没被拦，真实 Key 能直连；
- 首次启动自动弹三步向导，浅色/深色两套主题都拍过图确认排版。

功能链路（导入 → 连续对话 → 压缩 → 记忆）在浏览器构建里用拦截的 mock 接口跑通过：导入一个 v3 格式 ZIP 后连聊 3 轮，压缩请求发了 2 次、记忆抽取发了 2 次，面板显示「原文 2 轮 / 记忆 3 条 / 摘要 67 / 已压缩 4 轮」。

自动更新整条链路用真实 Release 验收过（1.0.6 → 1.0.7 → 1.0.8 → 1.0.9 → 1.0.10 → 1.0.11 → 1.1.0 → 1.1.1，全部通过界面点击，不调内部接口，安装包里没有任何令牌）：

1. 打开 设置 → 关于与更新 → 显示「本机版本 1.0.x / 发现新版本 1.0.y」（启动时已自动查过）；
2. 点「下载更新」→ 进度条走完 → 「新版本已下载，重启后安装」，按钮变为可点；
3. 点「重启并安装」→ 应用退出 → NSIS 静默安装（`--updated /S --force-run`）→ 新版本**自动重新打开**；
4. 再开设置页：`input[type="password"]` 数量为 **0**，本机版本已是新版本，状态变为「已是最新版本」。

`scripts/verify-update.mjs` 就是这套验收的脚本（CDP 直连打包后的 exe，不依赖 playwright）：
```bash
node scripts/verify-update.mjs            # 从当前已安装版本升级到线上最新版，全程点界面
node scripts/verify-update.mjs --ui-only  # 只看界面：令牌输入框数量、版本、更新状态
```

更新过程的应用侧日志在 `%APPDATA%\ds-always\logs\updater.log`（超过 512 KB 自动清空）。打包后的应用没有终端，用户报「更新装不上」时先要这个文件——里面能直接看到下载落点、`Executing: ... --updated,/S,--force-run` 这行以及安装器的报错。

> 排查时注意：NSIS 升级是「先删旧目录再解压新文件」，**中间有 1–2 秒 `DSAlways.exe` 是不存在的**。用脚本轮询版本号时要忽略空值，否则会把成功的更新误判成失败（本项目就被这个坑绕过一次）。

流式健壮性（1.0.11）用故障注入代理跑过 5 组真机场景，全程点界面：

| 场景 | 代理参数 | `timing.log` | 界面结果 |
| --- | --- | --- | --- |
| 正常网络 | 无 | 1 条，`attempt=0 done`，响应头 507ms / 首字 1062ms / 总 2546ms | 正常出字，无误杀 |
| 正文写到一半断 1 次 | `CUT=1 AFTER=2500` | `attempt=0 resumed` → `attempt=1 done` | 接着写，无错误提示 |
| 正文中断 2 次（用满上限） | `CUT=2 AFTER=1500` | `attempt=0/1 resumed` → `attempt=2 done` | 最终答案完整，无提示 |
| 思考已签名、正文未开始就断 | `CUT=1 AFTER=2500` | `attempt=0 resumed` → `done` | 同上 |
| 思考中途断（无签名，不能作前缀） | `CUT=4 AFTER=1500` | 1 条 `error(interrupted)` | 显示「连接中断，回答没有写完。可以重新生成，或点「继续生成」接着往下写」 |

最后一行是刻意的取舍：思考块没有签名时，把它当前缀回传服务端会被拒，所以不硬续，直接给明确提示——**任何情况下界面都不再出现"静默空白"**。

硅基流动通道（新增）用本地 mock 服务 + CDP 直连打包后的 exe 验收，12 项断言全部通过：

| # | 断言 | 说明 |
| --- | --- | --- |
| 1 | V4.1-Flash 请求已到达 | 默认模型走 `stream=true` 的 chat/completions |
| 2 | R1 请求已到达 | 同一个会话里切模型后立即按新模型发 |
| 3 | V4.1 带 system 角色且在最前 | OpenAI 格式下 `roles[0] === 'system'` |
| 4 | R1 把 system 并进用户消息 | `roles` 里没有 `system`，指令并入首条 user |
| 5 | V3.2 请求已到达 | 切换生效 |
| 6 | V3.2 传了 `enable_thinking=false` | 思考开关默认关 |
| 7 | V3.2 思考打开后传了 `true` | 开关能真实改变请求体 |
| 8 | V4.1 未传 `enable_thinking` | 免得被服务端拒 |
| 9 | R1 未传 `enable_thinking` | 同上（R1 始终思考） |
| 10 | 压缩请求已触发 | `isSummary` 请求确实发出 |
| 11 | 对话流式请求带 `stream` | 不是一次性返回 |
| 12 | 压缩提示在界面出现过 | 输入框上方出现「正在找回之前的对话…」 |

验收环境里有两处刻意设计：mock 服务**故意对 OPTIONS 返回 405**，用来证明主进程的预检改写（200 + `Allow-Headers`）真的兜住了——不兜的话渲染进程直接 `Failed to fetch`；接口地址用 `localStorage['chat-demo:siliconflow-origin']` 指到 `127.0.0.1:8899`，所以打包后的 exe 也能被脚本驱动，不需要真实 Key。

mock 侧日志还确认了两件事：**摘要/记忆这类内部请求固定走 V4.1-Flash**（用户选的是 R1 也照样），因为它们是机械任务、用最便宜的即可；R1 的 `reasoning_content` 在界面上正常渲染成思考块。

```bash
node scripts/mock-siliconflow.mjs > /tmp/mock-siliconflow.log 2>&1 &
DSALWAYS_EXE='release\win-unpacked\DSAlways.exe' node scripts/verify-siliconflow.mjs
```

## 已知限制

- 导入是**覆盖式**：一次导入会替换全部本地对话（上游设计如此）。向导里会提示当前已有多少个对话。
- 只支持上游 `export_format_version: 3` 的归档格式。
- 摘要与记忆抽取会产生额外 token 费用；压缩只在超过阈值时触发，记忆默认每 6 条回复一次，都可以在面板里调。官方通道用 `deepseek-flash`，硅基流动通道固定用 `DeepSeek-V4.1-Flash`（不跟随用户在对话框里选的模型，避免用 R1 做机械摘要又慢又贵）。
- 硅基流动只提供纯对话：附件、联网搜索、自动标题、语音输入与朗读都依赖官方通道，切过去后这些入口会被禁用（界面上有对应文案）。两种 Key 可以同时保存，切回官方通道即可恢复。
- 未做代码签名，安装时 Windows SmartScreen 可能提示「未知发布者」；macOS 未签名则要用户手动放行。
- 自动更新只对安装版生效，免安装版不行；更新源是公开的产物仓库，安装包里不含任何令牌。
- 断流续写最多 2 次；思考块没有签名（思考中途断）时无法续写，只能重新生成。
- 首字耗时只落文件、不在界面展示；要看去 `%APPDATA%\ds-always\logs\timing.log`。

## 许可

代码沿用上游 MIT 许可，见 `LICENSE`。二次开发部分的修改同样以 MIT 发布。MIT 只覆盖代码，**不覆盖 DeepSeek 的商标与品牌**，本项目据此不使用官方 logo。
