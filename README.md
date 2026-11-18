# DS Always

简体中文 | [English](README.en.md)

把 DeepSeek 网页版导出的历史对话搬到本地，用自己的 API Key 继续聊下去。桌面应用，数据全部留在本机。

> **第三方客户端，非 DeepSeek 官方产品。** 本项目基于 DeepSeek 开源的
> [`deepseek-ai/chat-demo`](https://github.com/deepseek-ai/chat-demo)（MIT）二次开发，
> 图标与名称均为自绘，与官方产品区分。使用本项目需要你自己准备 API Key。

## 下载

前往 **[最新版本下载页](https://github.com/kayz/dsalways-releases/releases/latest)**，Windows 用户选其中一个：

| 文件 | 说明 | 自动更新 |
| --- | --- | --- |
| `DS-Always-Setup-*.exe` | 安装版，推荐日常使用 | 支持，应用内一键升级 |
| `DS-Always-Portable-*.exe` | 免安装版，可放 U 盘 | 不支持，需手动换新包 |

也直接下载当前版本：[安装版 1.3.0](https://github.com/kayz/dsalways-releases/releases/download/v1.3.0/DS-Always-Setup-1.3.0.exe) ·
[便携版 1.3.0](https://github.com/kayz/dsalways-releases/releases/download/v1.3.0/DS-Always-Portable-1.3.0.exe)

安装包装到 `%LOCALAPPDATA%\Programs\DSAlways`。未做代码签名，首次运行 Windows SmartScreen
可能提示「未知发布者」，点「更多信息 → 仍要运行」即可。macOS / Linux 请从源码构建。

## 能做什么

- **接着聊旧对话**：导入 DeepSeek 网页版导出的 ZIP（或解压后的文件夹），历史提问与回答原样保留，不用重新讲一遍背景。
- **两个通道、六个模型**：对话框左下角一个下拉同时列出，选模型即切通道，当前用的是哪个渠道哪个模型一眼可见。

  | 通道 | 模型 | 上下文 | 额外能力 |
  | --- | --- | --- | --- |
  | DeepSeek 官方 | V4 Flash / V4 Pro | 1M | 内置联网搜索、附件、自动标题、语音 |
  | 硅基流动 | V4.1 Flash / V4 Pro / V3.2 / R1 | 1M / 1M / 164K / 164K | 纯对话，价格更低 |

- **窗口按模型动态调整**：可用的上下文窗口、输出预留、压缩触发线都从当前模型推导，切到 164K 的模型不会把 1M 攒下的记录硬塞进去；整理旧记录时会明确告诉你为什么在等。
- **省钱的上下文组装**：稳定的内容放前面且尽量不变，临时信息一律放尾部，让服务商的前缀缓存能命中。设置 → 助手与上下文里可以看到**本轮缓存命中率**和近 10 轮曲线。
- **长期记忆与自动压缩**：超过一定长度自动把更早的对话整理成分段笔记；普通记忆按当前提问按需召回，置顶记忆固定在最前。
- **前置指令**：可写一段全局文本放在所有提示词最前，并可按会话单独开关。
- 常规的流式回复、深度思考、Markdown / 代码 / 公式 / Mermaid、明暗主题、分支与重新生成、对话导入导出。

## 第一次打开

启动后是三步向导：**填 API Key → 导入历史对话 → 完成**，可以跳过，之后在设置里补。
两套 Key 分开保存（设置 → 模型接入）；选到还没填 Key 的通道时会自动打开设置页。
错误提示是中文的：401 → Key 无效，402 → 余额不足，断网 → 网络连接失败。

## 从源码运行

需要 Node.js 22.12+ 与 pnpm：

```sh
git clone https://github.com/kayz/dsalways.git
cd dsalways
pnpm install
pnpm dev      # 浏览器调试，http://localhost:8090
pnpm app      # 以桌面应用方式启动
pnpm build && pnpm app:dist   # 打包安装包
```

构建与发布的完整约定、Windows 打包注意事项见 [开发文档](README.dsalways.md)。

## 隐私与许可

- API Key 只存在本机（Electron 的 localStorage），对话与附件在 IndexedDB；应用没有遥测，不上传你的数据。
- 对话内容只发往你选择的通道（DeepSeek 官方或硅基流动），与官方客户端行为一致。
- 代码沿用上游 `deepseek-ai/chat-demo` 的 **MIT** 许可；MIT 只覆盖代码，不覆盖 DeepSeek 的商标与品牌。
- 记忆系统与上下文组装的设计讨论见 [`docs/记忆系统设计.md`](docs/记忆系统设计.md)。
