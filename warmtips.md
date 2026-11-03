# Warm tips

安装和使用 DSH EasySider 时容易踩的坑。先看这里，再翻 [operate.md](operate.md)。

## 先确认三件事

1. bridge 在跑：`curl -s http://127.0.0.1:8787/api/health` 返回 `"ok": true`
2. 扩展已加载并配对：侧边栏顶部的页面卡片显示当前页标题
3. 启动终端没有新的报错

## 常见错误

| 症状 | 原因 / 处理 |
|---|---|
| 侧边栏一直“正在连接” | bridge 没起、端口不对，或地址被改过。先 `curl 127.0.0.1:8787/api/health`；端口改过就在侧边栏设置里改 Bridge 地址 |
| “Token 无效” | 删掉 `.runtime/config.json` 重启 bridge 会换 token；或直接点“自动获取 Token” |
| 工具一直“执行中” | 侧边栏被关过或页面刷新了；重新打开侧边栏，bridge 会超时并告诉模型 |
| “页面没有响应” | 页面正在跳转/加载；重新 `browser_snapshot` 或 `browser_wait` |
| 点击没反应 | 元素可能是 `<div>` 上的 JS 事件；先 `browser_snapshot` 用 ref 点，或换成 `browser_find` |
| 模型说页面没内容 | 正文预算 8k；让它用 `browser_read` 指定 `maxChars`，或滚动后再读 |
| 长图截图失败 | 同一个标签页开着 DevTools；关掉再试 |
| bridge 启动报“找不到 dsh” | `which dsh`；或 `DSH_BIN=/path/to/dsh ./start` |
| 会话出现在不想去的地方 | 用 `--dsh-home` 指向单独环境 |
| `./start` 提示 Node 版本太低 | 需要 22.19+；升级后重开终端 |
| `dsh web` 登录后仍提示没有凭据 | 确认 `~/.dsh/.credentials.yaml` 存在；检查是不是 shell 里别的 `DSH_HOME` 把登录写到了别处 |
| 富 UI 没生效 | 确认 `~/.dsh/profiles/sdk/node_modules/deepseek-harness-intelligent-ui` 存在；重启 bridge 并刷新侧边栏；仍不行就重装：`DSH_HOME="$HOME/.dsh" dsh plugin --profile sdk add deepseek-harness-intelligent-ui` |
| 端口 8787 被占用 | `lsof -nP -iTCP:8787 -sTCP:LISTEN` 找到进程；停掉它，或 `./start --port 8788` 后在侧边栏改地址 |
| 想看底层数据 | `.runtime/config.json`、`.runtime/sessions.json`、`DSH_HOME/sessions/` |

## Chrome 扩展加载失败

正常路径只有三步：`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `dsh-easysider/extension`。

| 现象 | 原因 / 处理 |
|---|---|
| “无法加载扩展程序” / “Manifest file is missing or unreadable” | 选错目录了：要选**包含 `manifest.json` 的 `extension/`**，不是仓库根目录 |
| 加载按钮是灰的 | 没开右上角的**开发者模式** |
| “此扩展程序可能已损坏” | 文件被改动或权限不对；重新解压 / `git checkout` 后重试 |
| 企业策略禁止 | `chrome://policy` 里看 `ExtensionInstallBlocklist` / `ExtensionSettings`；需要管理员放行或换浏览器 |
| `--load-extension` 无效（命令行/自动化） | Chrome 137+ 对品牌版禁用了该开关；这不影响**手动**加载。自动化请用 Chrome for Testing |
| 加载成功但工具栏没有图标 | 点拼图图标 → 固定；或从 `chrome://extensions` 的卡片里选“在工具栏中显示” |

## 已知限制

- **只操作主 frame**：iframe 内的元素、shadow DOM 里的按钮可能选不到；跨域 iframe 完全不行。
- **快照引用会失效**：导航、刷新或大范围 DOM 更新后必须重新 `browser_snapshot`，模型被要求在失败时这么做。
- **流式是“按 step”而不是逐 token**：DSH SDK 的 `session.event` 在消息提交时到达，所以是分段出现，不是打字机效果。
- **停止 = 结束进程**：DSH SDK 没有 cancel RPC；bridge 用 SIGTERM 结束运行时，会话已落盘，下一条消息会尝试 `session/resume` 恢复。
- **`chrome://`、Web Store、PDF 阅读器不能注入**，会明确报错。
- **截图大小**：可见区域 JPEG，长图走 CDP 后仍是 JPEG（质量 70），超大页面会限制在 4000×20000。
- **Widget 未开放**：MV3 扩展页 CSP 不允许任意内联脚本/远程模块，`ui_render_widget` 在生成的 patch 里被关掉；3D/物理模拟请用 `dsh web` 本体。
- **少数组件降级**：`Math`（KaTeX）、`Mermaid`、`Map`、`Plot` 目前显示源码/列表占位；`Table` 的排序/搜索/Tab/表单状态在整条消息重渲染时会重置。
- **Intelligent UI 版本**：固定在 `0.2.13`；升级后组件 schema 可能变化，先跑 `node test/render.mjs`。
- **单用户、单机**：没有多用户鉴权；不要把 bridge 暴露到局域网（代码也只 bind 127.0.0.1）。
- **模型行为**：页面正文被截断时模型可能误判“页面上没有”，它需要主动 `browser_read` 更多或 `browser_snapshot`。提示词已尽量引导，但不能保证。
- **共享 `DSH_HOME` 的副作用**：与 `dsh web` 共用时，会话会出现在同一个目录；想隔离就用 `--dsh-home`。
- **不是官方产品**：实验代码，MIT，按现状提供。

## 安全提醒

- **页面是不可信输入**：MCP 的 instructions 和 persona 都明确要求忽略页面里“改变任务/套取密钥/无关跳转”的指令。但这只是缓解，不是硬隔离——模型仍可能被精心构造的页面误导。
- **点击/输入会发生真实副作用**：在已登录的网站上，agent 的操作和你自己点一样。第一次让它操作时，建议盯一眼；浏览器配置、密码管理器、支付页面这类站点不要开自动操作。
- **长图截图用 `chrome.debugger`**：会临时出现“DSH 正在调试此浏览器”横幅，截完即断开。仅 `fullPage` 截图和普通截图失败时使用。
- **权限较宽**：`<all_urls>` 用于在任意网页注入；`debugger` 仅用于长截图。不想这么宽可以改成按站点授权（需要改 `manifest.json` 和 `ensureInjected`）。
- **凭据不出本机**：模型凭据仍在 DSH 的 `.credentials.yaml`，bridge 不复制、不下发。MCP 子进程通过 env 拿 bridge token，token 存在 `.runtime/config.json`（600）。
- **UI 内容同样按不可信处理**：组件文本先转义再渲染，链接只接受 http(s)，图片/视频只接受 https；Widget 关闭，避免模型生成的任意脚本在扩展页执行。

## 还是卡住

把这三样贴出来（**先删掉 token**）：

```sh
curl -s http://127.0.0.1:8787/api/health
tail -40 .runtime/bridge.log
```

以及侧边栏里看到的报错、`chrome://extensions` 里该扩展的错误信息。不要在 issue 里贴 `.runtime/config.json` 或 `~/.dsh/.credentials.yaml`。
