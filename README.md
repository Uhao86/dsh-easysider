# DSH EasySider

> Chrome 超级侧边栏，基于 `dsh web`。

[English](README.en.md) · **简体中文**

一个 Chrome MV3 侧边栏：像 Gemini 那样读当前页面、回答问题，并**真的操作浏览器**——点击、输入、滚动、跳转、截图。

它把 [DeepSeek Harness](https://www.deepseek.com/en/harness/) 的 agent 放进 Chrome，运行在 **`dsh web` 的同一个 `DSH_HOME`（默认 `~/.dsh`）** 里：登录凭据、模型选择、会话目录都和 `dsh web` 共用。


## 富 UI 与思考强度

- **富 UI**：侧边栏直接挂载了 [`deepseek-harness-intelligent-ui`](https://www.npmjs.com/package/deepseek-harness-intelligent-ui)（0.2.13）。模型的 `ui_render` / `ui_compose` / `ui_patch` 不会显示成一行工具调用，而是渲染成原生卡片、KPI、表格、折线/柱状/面积/饼图、散点、热力图、时间线、代码 diff、文件树、JSON、图片、Choice/Form/Button 等组件。
- **原位更新**：`ui_patch` 会改之前消息里的同一张卡，而不是再贴一张（跨消息也能定位）。
- **思考强度**：输入框旁可选 `自动 / 快速 / 标准 / 深入 / 极限`，对应 SDK 的 `reasoningEffort`（省略 / `off` / `low` / `high` / `max`）。切换会重启 DSH 运行时，下一轮生效。

<p align="center"><img src="test/ui-sample.png" width="320" alt="富 UI：KPI、折线图、可排序表格"></p>

<p align="center"><em>图：侧边栏里的富 UI——KPI、折线图、可排序表格；<code>ui_patch</code> 会原位更新这张卡。</em></p>

---

## 它现在能做什么

- **读懂当前页**：标题、URL、正文、标题大纲、用户选中的文字。发消息时自动附带（可关）。
- **截图理解**：附带当前可见区域截图，模型能看布局、图片、按钮状态。
- **交互元素快照**：把链接、按钮、输入框、下拉框编成稳定的 `e1…eN` 引用，模型按引用操作。
- **真实操作**：点击、输入（可提交）、滚动、页内查找、前进/后退/刷新、打开链接（当前页或新标签页）、等待元素出现。
- **高亮**：在页面上直接框出模型要说的位置，操作时也会自动闪一下。
- **多轮对话**：会话保存在 `DSH_HOME/sessions/`，换标签页、关侧边栏、重启 bridge 都能接着聊；历史列表支持**置顶、重命名、归档/取消归档**。
- **停止**：随时打断当前回合，下一条消息继续同一会话。
- **富 UI**：卡片、KPI、表格、图表、时间线、Choice/Form，而不是只有一大段 Markdown。
- **思考强度**：快速 / 标准 / 深入 / 极限，随时切换。
- **页面右键菜单**："用 DSH 总结这个页面 / 解释选中内容"。
- **快捷键**：`Alt+Shift+S` 打开侧边栏（可在 `chrome://extensions/shortcuts` 改）。


---

## 架构

```
┌──────────────────────── Chrome ────────────────────────┐
│  sidepanel.html/js          content.js                 │
│  · 聊天 UI / Markdown       · 读正文、元素快照          │
│  · SSE 接收 / 工具执行       · 点击、输入、高亮、等待     │
│         │  chrome.tabs / chrome.scripting              │
└─────────┼──────────────────────────────────────────────┘
          │  HTTP + SSE（127.0.0.1，token）
┌─────────▼──────────────────────────────────────────────┐
│  server/bridge.mjs        ：8787                        │
│  · 持有 DSH 子进程，转发事件                             │
│  · /api/chat  /api/stream  /api/tool-result  /api/pair  │
│  · 把 MCP 工具调用路由给侧边栏                            │
└─────────┬──────────────────────────────────────────────┘
          │  stdio JSON-RPC（newline framed）
┌─────────▼──────────────────────────────────────────────┐
│  DSH_HOME=~/.dsh                                       │
│  dsh --profile sdk --patch .runtime/sidebar.patch.yml   │
│  · 模型 / 会话 / 压缩 / 附件 / 与 dsh web 相同凭据        │
│  · 禁用了 bash、文件、子代理、workflow 等本地工具          │
│  · 挂载 MCP server：server/browser-mcp.mjs               │
│  · 挂载 intelligent-ui：ui_render / ui_compose / ui_patch │
└─────────┬──────────────────────────────────────────────┘
          │  MCP stdio（12 个 browser_* 工具）
┌─────────▼──────────────────────────────────────────────┐
│  server/browser-mcp.mjs                                 │
│  每个工具调用 POST 回 bridge /internal/tool → 侧边栏执行  │
└────────────────────────────────────────────────────────┘
```

### 为什么是 `sdk` 而不是 `web`

`dsh web` 的 profile 组合是 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`，后者是一个 HTTP 应用（Web 服务器 + 浏览器前端），没有给外部客户端留聊天接口。bridge 需要一个能通过 stdio 长连接驱动的 agent，所以用 DSH 自带的 `sdk` 传输组合，但把 `DSH_HOME` 指向 `dsh web` 的环境。两者的 agent 底座（`dsh-base`、模型、工具、凭据、会话存储）是同一套；区别只在传输层。

要"字面意义上"让 `dsh web` 的 GUI agent 也拥有浏览器工具，见[与 dsh web profile 的关系](#与-dsh-web-profile-的关系)。

工具集被刻意收窄为"浏览器 + 联网读取"：没有 shell、没有文件读写、没有子代理。因为页面内容是不可信输入，不能给它本地执行权。

---

## 前置条件

从零开始也只需要这几样；下面的快速开始会把 DSH 和 intelligent-ui 装好。

- **Node.js ≥ 22.19**：DSH 运行时要求
- **Chrome / Chromium ≥ 116**：侧边栏 API
- **Git**：拉取仓库
- **一个 DeepSeek 账号**：第一次 `dsh web` 时登录
- **DSH CLI**：快速开始里用 npm 安装
- **intelligent-ui**：快速开始里装进 `sdk` profile；不装也能用，只是没有富 UI
- macOS 仅在重新生成图标时需要 `sips`

> bridge 本身没有运行时 npm 依赖；`npm install` 只用于浏览器测试（`playwright-core`）。

## 快速开始

两种走法，任选一种：

- **路径 A：给人** —— 从零开始，复制命令到第一次对话。
- **路径 B：给 agent** —— 把这一节交给 agent，它负责检查、安装、启动和验证，直到"需要你手动加载扩展"为止。

> 下面的命令以 macOS / Linux 为准；Windows 用 PowerShell 等价命令，或 Git Bash / WSL。
>
> DSH 本身见 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

### 路径 A：给人（从零开始）

#### 0. 检查环境

```sh
node -v            # 需要 v22.19 或更高
git --version
dsh --version      # 没装会报 command not found，下一步安装
(test -d "/Applications/Google Chrome.app" || command -v google-chrome || command -v chromium) && echo "Chrome ok"
```

- Node 低于 22.19 或没有：安装 Node 22（macOS `brew install node`；或 nvm `nvm install 22 && nvm use 22`；其他平台 nodejs.org），重开终端。
- 没有 git：macOS 可运行 `xcode-select --install`，其他平台安装 Git。
- 没有 Chrome/Chromium ≥ 116：安装 Chrome 或 Chromium。

#### 1. 安装 DSH 并登录一次

```sh
npm install -g @deepseek-ai/dsh
dsh --version
DSH_HOME="$HOME/.dsh" dsh web
```

浏览器会打开 DSH Web。用 DeepSeek 账号登录、确认模型后，回终端按 `Ctrl-C`。这一步会生成 `~/.dsh` 和登录凭据。

- 端口冲突：`DSH_HOME="$HOME/.dsh" dsh web --port 3090`。
- 不希望自动开浏览器：`DSH_HOME="$HOME/.dsh" dsh web --no-open`，手动打开打印的地址。
- 显式带上 `DSH_HOME`，避免 shell 里已有的 `DSH_HOME` 把登录写到别的环境。
- 已经登录过（`~/.dsh/.credentials.yaml` 存在）可以跳过这一步。
- 如果 `dsh: command not found`：重开终端，或把 npm 全局 bin 加入 `PATH`。

#### 2. 拉仓库，安装 intelligent UI

```sh
git clone https://github.com/Uhao86/dsh-easysider.git
cd dsh-easysider
DSH_HOME="$HOME/.dsh" dsh plugin --profile sdk add deepseek-harness-intelligent-ui@0.2.13
```

不装 intelligent-ui 也能跑，只是模型输出会退回纯 Markdown。bridge 启动时会为它生成关闭 3D widget 的覆盖层。

#### 3. 启动 bridge

```sh
chmod +x start stop
./start
```

保持这个终端开着。看到 `pairing http://127.0.0.1:8787/` 即成功。停止用 `./stop` 或 `Ctrl-C`。

#### 4. 加载扩展并配对

1. 打开 `chrome://extensions`，开启 **开发者模式**。
2. **加载已解压的扩展程序** → 选择仓库里的 `extension/` 目录。
3. 把图标固定到工具栏，点它（或 `Alt+Shift+S`）。
4. 第一次点 **自动获取 Token**。

如果加载失败，看 [Chrome 扩展安装](#chrome-扩展安装) 的排查表。完成后进入下面的「第一次使用」。

### 路径 B：给 agent（执行到手动装扩展前）

把这一节交给 agent。Agent 必须：

- 在任何全局安装、处理端口占用、删除文件之前先征得用户同意。
- **不要自动安装 Chrome 扩展**，也不要修改用户的 Chrome profile。
- 不要把 token、`.runtime`、`~/.dsh` 凭据写进仓库或公开输出。

#### B0. Preflight（全部检查完再动手）

```sh
uname -s
node -v
git --version
command -v dsh && dsh --version || echo "DSH_MISSING"
command -v curl >/dev/null && echo "CURL_OK" || echo "CURL_MISSING"
test -s "$HOME/.dsh/.credentials.yaml" && echo "CREDENTIALS_OK" || echo "SIGNIN_REQUIRED"
test -d "/Applications/Google Chrome.app" || command -v google-chrome || command -v chromium || echo "CHROME_MISSING"
lsof -nP -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true
```

期望：Node ≥ v22.19，git/Chrome 存在，8787 空闲。Node 或 Chrome 缺失就停下来告诉用户，不要静默安装系统软件；8787 被占用就先确认进程再处理。

#### B1. 安装缺失的 Node / DSH（先征得同意）

Node 缺失或低于 22.19：

```sh
# macOS
brew install node
# 或使用 nvm
nvm install 22 && nvm use 22
node -v
```

没有 git：macOS 用 `xcode-select --install`，其他平台用对应包管理器安装。

DSH 缺失：

```sh
npm install -g @deepseek-ai/dsh
dsh --version
```

不要静默改 PATH 或全局包；安装失败、需要 sudo、或 Chrome 缺失时，停下来让用户处理。

#### B2. 仅在需要时登录 dsh web

```sh
LOG="${TMPDIR:-/tmp}/dsh-easysider-web.log"
DSH_HOME="$HOME/.dsh" dsh web --no-open --port 3090 > "$LOG" 2>&1 &
DSH_WEB_PID=$!
sleep 2
cat "$LOG"
# 把打印的 URL 给用户，请其登录；等待凭据出现（最多 5 分钟）
i=0
while [ "$i" -lt 60 ] && [ ! -s "$HOME/.dsh/.credentials.yaml" ]; do sleep 5; i=$((i+1)); done
kill "$DSH_WEB_PID" 2>/dev/null || true
test -s "$HOME/.dsh/.credentials.yaml" && echo "CREDENTIALS_OK" || echo "SIGNIN_TIMEOUT"
```

如果 `CREDENTIALS_OK` 已经是真，跳过这一步。如果用户已有一个 `dsh web` 在跑，直接用它完成登录。

#### B3. 克隆或更新仓库

```sh
if [ -f package.json ] && grep -q '"name": "dsh-easysider"' package.json; then
  git pull --ff-only
elif [ -d dsh-easysider/.git ]; then
  cd dsh-easysider && git pull --ff-only
else
  git clone https://github.com/Uhao86/dsh-easysider.git && cd dsh-easysider
fi
```

#### B4. 安装 intelligent UI

```sh
DSH_HOME="$HOME/.dsh" dsh plugin --profile sdk add deepseek-harness-intelligent-ui@0.2.13
test -d "$HOME/.dsh/profiles/sdk/node_modules/deepseek-harness-intelligent-ui" && echo "UI_PLUGIN_OK"
```

#### B5. 启动 bridge 并验证

```sh
mkdir -p .runtime
chmod +x start stop
./start > .runtime/bridge.log 2>&1 &
i=0
while [ "$i" -lt 40 ]; do
  curl -sf http://127.0.0.1:8787/api/health >/dev/null && break
  sleep 0.5; i=$((i+1))
done
curl -s http://127.0.0.1:8787/api/health
node -p "require('./.runtime/config.json').token"
```

确认响应里 `"ok": true`、`"home"` 指向 `~/.dsh`，并记下 token 和配对地址 `http://127.0.0.1:8787/`。

#### B6. STOP：交给用户手动装扩展

**Agent 在这里停止。** 不要自动装 Chrome 扩展。明确告诉用户：

1. 打开 `chrome://extensions`，开启开发者模式。
2. 加载已解压的扩展程序 → 选择 `<仓库目录>/extension`。
3. 固定图标 → 点击 → 点 **自动获取 Token**，并保持侧边栏打开。
4. 装好后回复你。

用户确认后，轮询 `curl -s http://127.0.0.1:8787/api/health`，直到 `"clients"` 大于 0；然后把下面的「第一次使用」交给用户。如果一直是 0，让用户贴扩展报错或控制台信息。

## 第一次使用

前提：bridge 在 `127.0.0.1:8787` 运行，扩展已加载并配对。

1. 打开 <https://example.com>（或任意普通网页）。
2. 点工具栏鲸娘图标，或按 `Alt+Shift+S`。
3. 第一次会看到"先连接本地 bridge"；点 **自动获取 Token**。顶部页面卡片出现当前页标题即连接成功。
4. 输入 `总结这个页面，用三点`。回答会以你的语言出现；需要读 DOM 时会出现工具行。
5. 试浏览器操作：`点击页面上的 “More information” 链接`。
6. 试富 UI：`用 ui_render 做一个包含 2 个 Stat、一个柱状图和一个表格的卡片`。没装 intelligent-ui 时会退化为 Markdown。
7. 试思考：把 **思考** 切到 `深入`，再问一个复杂点的问题。
8. 试历史：点右上角历史图标，置顶 / 重命名 / 归档。

如果侧边栏一直显示"正在连接"，先确认 bridge 终端还开着、`curl http://127.0.0.1:8787/api/health` 正常，再看 [排错](#排错)。

---

## 工具清单

模型看到的是 `mcp__browser__browser_*`，界面上显示为中文动作。

| 工具 | 作用 |
|---|---|
| `browser_status` | 列出标签页，标出活动标签页 |
| `browser_read` | 标题、URL、选中文字、标题大纲、正文（默认 14k 字符，上限 60k） |
| `browser_snapshot` | 可交互元素 + 稳定 `ref`（`e1…`），跳转/刷新后需重新快照 |
| `browser_open` | 打开 URL（当前标签页或新标签页），等待加载 |
| `browser_click` | 按 `ref` / CSS selector / 可见文字点击 |
| `browser_type` | 输入，可清空、可提交表单 |
| `browser_scroll` | 上/下/顶/底，或把某个元素滚到视口 |
| `browser_find` | 页内查找文字，返回片段和可点击元素的 ref |
| `browser_screenshot` | 可见区域截图；`fullPage` 用 CDP 截长图 |
| `browser_history` | 后退 / 前进 / 刷新 |
| `browser_highlight` | 高亮 ref 或一段文字，不点击 |
| `browser_wait` | 等 selector / 文字出现，或固定等待 |

intelligent-ui 的宿主工具（不是 MCP，侧边栏直接渲染）：

| 工具 | 作用 |
|---|---|
| `ui_render` | 一棵声明式组件树：Card / Stack / Grid / Tabs / Stat / Table / Chart / Scatter / Heatmap / Timeline / Choice / Form … |
| `ui_compose` | 在一个回答里穿插 Markdown 与组件，适合“解释 + 图 + 结论” |
| `ui_patch` | 按 `uiId` 原位修改之前渲染的组件树（跨消息） |

Widget（`ui_render_widget`）默认不开放：MV3 扩展页的 CSP 会拦住任意内联/3D 脚本，渲染出来也不可靠。需要时可在 profile 里打开 `enableWidget` 并自行补 iframe 运行时。

另有 DSH 自带的联网工具：`web_search`（搜索）和 `web_fetch`（抓取网页）。

---

## 历史会话

侧边栏的“历史对话”面板支持：

- **置顶**：固定在列表最上方；置顶优先于最近活动排序。
- **重命名**：行内编辑，Enter 保存、Esc 取消；自定义标题不会被首条消息覆盖。
- **归档 / 取消归档**：归档后从主列表折叠到“显示已归档”，可随时恢复。
- 点行切换会话；当前会话有高亮。

<p align="center"><img src="test/sessions.png" width="320" alt="历史会话：置顶、重命名、归档"></p>

<p align="center"><em>图：历史对话面板的置顶、重命名、归档。</em></p>

bridge 的会话索引在 `.runtime/sessions.json`，消息本体在 `DSH_HOME/sessions/`。相关 API：

```http
GET  /api/sessions                     # 全部会话（含 pinned/archived）
POST /api/sessions                     # { id?, title? } 创建空会话
POST /api/sessions/update              # { id, title?, pinned?, archived? }
```

清理开发/测试留下的一次性会话（**不会**动真实 `sidebar-<uuid>` 对话）：

```sh
node tools/clean-test-sessions.mjs          # 预览
node tools/clean-test-sessions.mjs --apply  # 删除 sidebar-probe-*/smoke-*/test-* 及测试专用 home
```


## 配置

bridge 的参数可用命令行或环境变量，端口/token/模型写入 `.runtime/config.json` 后下次沿用（`DSH_HOME` 不持久化，每次按当前环境解析）：

```sh
./start --port 8787 --model deepseek-flash --dsh-home ~/.dsh
```

| 参数 | 环境变量 | 默认 |
|---|---|---|
| `--port` | `DSH_SIDEBAR_PORT` | `8787` |
| `--model` | `DSH_SIDEBAR_MODEL` | `deepseek-flash` |
| `--provider` | `DSH_SIDEBAR_PROVIDER` | `deepseek-official` |
| `--dsh-home` | `DSH_SIDEBAR_DSH_HOME` | `~/.dsh`（dsh web 的环境） |
| `--max-page-chars` | `DSH_SIDEBAR_MAX_PAGE_CHARS` | `8000` |
| `--reasoning-effort` | `DSH_SIDEBAR_EFFORT` | `auto`（省略；可 `off/low/high/max`） |
| runtime 目录 | `DSH_SIDEBAR_RUNTIME` | `.runtime` |
| `dsh` 路径 | `DSH_BIN` | 自动探测 |

> bridge **不读取** shell 里的 `DSH_HOME`：如果它为别的 harness 导出过，继承它会悄悄换回旧环境。要覆盖默认值用 `--dsh-home` 或 `DSH_SIDEBAR_DSH_HOME`。

> 注意：`DSH_HOME` 与 `dsh web` 共用时，侧边栏产生的会话（`sidebar-*`）也会出现在 `dsh web` 的会话目录里。如果不想混在一起，用 `--dsh-home` 指向单独的环境。

侧边栏设置里可改 Bridge 地址、token，以及两个开关：

- **页面**：是否附带正文（默认开，8k 字符预算）
- **截图**：是否附带当前可见区域截图（默认关）

输入框旁的 **思考** 下拉直接调 `POST /api/settings`：

```json
{ "reasoningEffort": "off" }
```

回合进行中会返回 409（避免中途杀掉运行时）；空闲时 bridge 会优雅关闭当前 DSH 进程，下一条消息按新强度重新初始化。

会话 ID 形如 `sidebar-<uuid>`，历史列表存在 `.runtime/sessions.json`，完整事件在 `DSH_HOME/sessions/`。UI 消息缓存在 `chrome.storage.local`。

### 换模型

```sh
./start --model <model-id>
```

模型必须能在 `deepseek-official` 路由上使用；其他 provider 可用 `--provider`。

---

## 与 dsh web profile 的关系

| 共享 | 不共享 |
|---|---|
| `DSH_HOME`（凭据、模型、会话目录） | `dsh web` 的 HTTP/Web GUI 进程 |
| DSH 版本、plugin 生态、`dsh-base` 工具 | Web 前端的 RPC 协议 |
| 同样的 `deepseek-flash` 模型 | — |
| 同一套 MCP 工具服务 | — |

如果你想让 **`dsh web` 自己的 GUI agent** 也能控制 Chrome，把下面的 overlay 合进
`~/.dsh/profiles/web/cordis.patch.yml`，重启 `dsh web`：

```yaml
- insert:
    - id: mcp-browser-sidebar
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: node
        args:
          - /absolute/path/to/dsh-easysider/server/browser-mcp.mjs
        env:
          DSH_SIDEBAR_RUNTIME: /absolute/path/to/dsh-easysider/.runtime
        toolCallTimeoutMs: 90000
```

完整示例见 [`examples/web-profile-browser.patch.yml`](examples/web-profile-browser.patch.yml)。这样 `dsh web` 里的 agent 会多出 `mcp__browser__*` 工具；执行仍然发生在 Chrome 侧边栏里，所以侧边栏要开着。注意 bridge 必须先启动（`.runtime/config.json` 里是当前端口和 token）。

---

## Chrome 扩展安装

正常路径只有三步：`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `dsh-easysider/extension`。

如果加载失败，先按错误文案排查：

| 现象 | 原因 / 处理 |
|---|---|
| "无法加载扩展程序" / "Manifest file is missing or unreadable" | 选错目录了：要选**包含 `manifest.json` 的 `extension/`**，不是仓库根目录 |
| 加载按钮是灰的 | 没开右上角的**开发者模式** |
| "此扩展程序可能已损坏" | 文件被改动或权限不对；重新解压/`git checkout` 后重试 |
| 企业策略禁止 | `chrome://policy` 里看 `ExtensionInstallBlocklist` / `ExtensionSettings`；需要管理员放行或换浏览器 |
| `--load-extension` 无效（命令行/自动化） | Chrome 137+ 对品牌版禁用了该开关；这不影响**手动**加载。自动化请用 Chrome for Testing |
| 加载成功但工具栏没有图标 | 点拼图图标 → 固定；或从 `chrome://extensions` 点"扩展程序"卡片里的"在工具栏中显示" |

如果手动加载仍然不通，可以从这三条里选一条继续（告诉我一声即可）：

1. **手动加载**（推荐，最接近真实使用）：你装好后我继续用自动化脚本验证 bridge/agent，UI 由你实际点一遍。
2. **Chrome for Testing**：机器上已有 Playwright 的 Chrome for Testing，我可以继续跑完整的真浏览器自动化（读页/点击/截图），但它是独立 profile，不带你日常登录态。
3. **只做无浏览器验证**：`node test/smoke.mjs` 用假扩展验证协议链路；UI 和浏览器操作留到你手动确认。

---

## 图标与素材

默认使用 **DeepSeek 鲸娘（拟人形态）** 的圆形头像：

- 素材来自 [Sutera-Diffusus/dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)（MIT © Sutera-Diffusus；插画 [@SuteraWu](https://github.com/SuteraWu)），经由 `deepseek-harness-intelligent-ui` 的 demo 素材取得。
- 完整署名和 MIT 文本见 [`tools/ICON-CREDITS.md`](tools/ICON-CREDITS.md)。
- 源图 53 KB；渲染出的 128px 图标约 32 KB，远低于扩展的体积限制。
- 如果源图缺失或超过 1.5 MB，`make-icons.mjs` 会自动回退到原创的**蓝色鲸鱼（动物形态）**。
- 这是同人网络形象，不是 DeepSeek 官方素材，也不代表官方认可。



## 隐私与权限

**只在本机。** bridge 只绑定 `127.0.0.1`，每个 API 都需要随机 token；`/api/pair` 只接受扩展来源或本机页面。删除 `.runtime/config.json` 会轮换 token。

**会离开本机的内容。** 当前页正文、选中文字和你勾选附带的截图会随提示词发送给 DSH 配置的模型服务（默认 `deepseek-official`）。适用 DSH 自身的数据处理条款；本项目不额外增加遥测、分析或云端服务。

**本地数据。** token 存在 `.runtime/config.json`（0600）和 `chrome.storage.local`；会话在 `~/.dsh/sessions/`，UI 消息缓存在 `chrome.storage.local`。

**权限。**

| 权限 | 用途 |
|---|---|
| `sidePanel` | 侧边栏 UI |
| `tabs` | 读取标签页标题/URL、列出标签页、导航 |
| `scripting` + `<all_urls>` | 在你询问的页面上注入内容脚本 |
| `activeTab` | 用户触发时访问当前标签页 |
| `storage` | 设置与本地消息缓存 |
| `contextMenus` | 右键"总结本页 / 解释选中" |
| `debugger` | 通过 DevTools Protocol 截长图 |

如果只在少数站点使用，可以把 `<all_urls>` 收窄；`ensureInjected` 在其他站点会给出明确错误。

## 安全说明

- **只监听本机**：bridge 绑定 `127.0.0.1`，每个 API 都要 token；`/api/pair` 只接受扩展来源或本机页面。
- **没有本地执行权**：侧边栏 agent 的 profile 禁用了 `bash`、`pwsh`、文件读写、子代理、workflow、goal、plan mode。它只能读网页、调浏览器工具、联网搜索/抓取。
- **页面是不可信输入**：MCP 的 instructions 和 persona 都明确要求忽略页面里"改变任务/套取密钥/无关跳转"的指令。但这只是缓解，不是硬隔离——模型仍可能被精心构造的页面误导。
- **点击/输入会发生真实副作用**：在已登录的网站上，agent 的操作和你自己点一样。第一次让它操作时，建议盯一眼；浏览器配置、密码管理器、支付页面这类站点不要开自动操作。
- **长图截图用 `chrome.debugger`**：会临时出现"DSH 正在调试此浏览器"横幅，截完即断开。仅 `fullPage` 截图和普通截图失败时使用。
- **权限较宽**：`<all_urls>` 用于在任意网页注入；`debugger` 仅用于长截图。不想这么宽可以改成按站点授权（需要改 `manifest.json` 和 `ensureInjected`）。
- **凭据不出本机**：模型凭据仍在 DSH 的 `.credentials.yaml`，bridge 不复制、不下发。MCP 子进程通过 env 拿 bridge token，token 存在 `.runtime/config.json`（600）。
- **UI 内容同样按不可信处理**：组件文本先转义再渲染，链接只接受 http(s)，图片/视频只接受 https；Widget 关闭，避免模型生成的任意脚本在扩展页执行。

---

## 开发

```sh
node --check server/bridge.mjs            # 语法
node tools/make-icons.mjs                 # 重新生成图标
node test/smoke.mjs                       # 不启动 Chrome：bridge + MCP + 模型一整轮
node test/ui.mjs                          # 真 Chrome：配对、读页、快照、点击、截图、ui_render、ui_patch
node test/render.mjs                      # 纯渲染：组件树 + compose，不调模型
node test/sessions.mjs                    # 会话 pin/rename/archive API
node test/sessions-ui.mjs                 # 历史面板的 pin/rename/archive（无模型）
node test/probe-live.mjs                  # 探测已在跑的 bridge（默认 8787，共享 ~/.dsh）
node tools/clean-test-sessions.mjs --apply  # 清掉本轮开发产生的一次性会话
```

`test/smoke.mjs` 用假扩展（SSE + 罐头工具结果）验证协议链路，会花一次很小的模型调用。
`test/ui.mjs` 需要 Chrome for Testing（品牌 Chrome 137+ 不再接受 `--load-extension`）。脚本会自动搜索
Playwright 的 Chromium 缓存（macOS/Linux/Windows），也可以用 `DSH_TEST_CHROME` 指定。这些测试都会创建
`.runtime-test` / `.runtime-ui` / `.runtime-render` / `.runtime-sessions-*` 里的隔离 `DSH_HOME`
（只软链 `~/.dsh/.credentials.yaml`），不会写你的正式会话目录。`test/ui.mjs` 会检查 `ui_render` 渲染成卡片、`ui_patch` 原位更新且不重复出卡片；它要求 `sdk` profile 已安装 intelligent-ui，否则跳过该测试；
`test/sessions-ui.mjs` 用真实面板验证置顶/重命名/归档。

### 目录

```
dsh-easysider/
├── server/
│   ├── bridge.mjs          # 本地 HTTP/SSE + DSH 子进程 + 工具路由
│   └── browser-mcp.mjs     # stdio MCP server，12 个 browser_* 工具
├── extension/
│   ├── manifest.json
│   ├── background.js       # 右键菜单 / 打开侧边栏
│   ├── sidepanel.html/css/js
│   ├── markdown.js         # 共享的 Markdown 渲染
│   ├── ui-render.js        # intelligent-ui 组件树的原生渲染器
│   ├── content.js          # 正文、快照、点击、输入、高亮、等待
│   └── icons/              # 鲸娘图标（tools/whale-girl-icon.html 渲染）
├── examples/
│   └── web-profile-browser.patch.yml
├── test/
│   ├── smoke.mjs
│   ├── ui.mjs
│   ├── render.mjs
│   ├── sessions.mjs
│   ├── sessions-ui.mjs
│   └── dsh-home.mjs
├── tools/
│   ├── whale-girl-icon.html   # 拟人形态（默认）
│   ├── whale-girl.webp        # 鲸娘素材（MIT，见 ICON-CREDITS.md）
│   ├── whale-icon.html        # 动物形态（回退）
│   ├── ICON-CREDITS.md
│   ├── clean-test-sessions.mjs
│   └── make-icons.mjs
├── start / stop
└── .runtime/               # 生成物：patch、token、会话标题、pid（gitignore）
```

### 改工具

1. 在 `server/browser-mcp.mjs` 的 `TOOLS` 里加 schema（名字 `browser_xxx`）。
2. 在 `extension/sidepanel.js` 的 `executeTool` 里加分支。
3. 如果需要在页面里做事，在 `extension/content.js` 的 `handlers` 里加操作。
4. 重启 bridge（`./start` 会重写 patch），侧边栏刷新即可。

### 改 UI 组件

- 组件的真实契约在 `deepseek-harness-intelligent-ui` 的 `src/catalog/catalog.js`。
- 渲染实现集中在 `extension/ui-render.js` 的 `renderCatalog` 的 `switch (node.type)`。
- 未知类型会降级成“暂不支持 + props 预览”，不会让整条消息渲染失败。
- 改完图标：`node tools/make-icons.mjs`（默认用 `tools/whale-girl-icon.html`；源图缺失或超过 1.5 MB 时自动回退到 `tools/whale-icon.html`）。

---

## 已知限制

- **只操作主 frame**：iframe 内的元素、shadow DOM 里的按钮可能选不到；跨域 iframe 完全不行。
- **快照引用会失效**：导航、刷新或大范围 DOM 更新后必须重新 `browser_snapshot`，模型被要求在失败时这么做。
- **流式是"按 step"而不是逐 token**：DSH SDK 的 `session.event` 在消息提交时到达，所以是分段出现，不是打字机效果。
- **停止=结束进程**：DSH SDK 没有 cancel RPC；bridge 用 SIGTERM 结束运行时，会话已落盘，下一条消息会尝试 `session/resume` 恢复。
- **`chrome://`、Web Store、PDF 阅读器不能注入**，会明确报错。
- **截图大小**：可见区域 JPEG，长图走 CDP 后仍是 JPEG（质量 70），超大页面会限制在 4000×20000。
- **Widget 未开放**：MV3 扩展页 CSP 不允许任意内联脚本/远程模块，`ui_render_widget` 在生成的 patch 里被关掉；3D/物理模拟请用 `dsh web` 本体。
- **少数组件降级**：`Math`（KaTeX）、`Mermaid`、`Map`、`Plot` 目前显示源码/列表占位；`Table` 的排序/搜索/Tab/表单状态在整条消息重渲染时会重置。
- **Intelligent UI 版本**：固定在 `0.2.13`；升级后组件 schema 可能变化，先跑 `node test/render.mjs`。
- **单用户、单机**：没有多用户鉴权；不要把 bridge 暴露到局域网（代码也只 bind 127.0.0.1）。
- **模型行为**：页面正文被截断时模型可能误判"页面上没有"，它需要主动 `browser_read` 更多或 `browser_snapshot`。提示词已尽量引导，但不能保证。
- **共享 `DSH_HOME` 的副作用**：与 `dsh web` 共用时，会话会出现在同一个目录；想隔离就用 `--dsh-home`。
- **不是官方产品**：实验代码，MIT，按现状提供。

---

## 排错

| 症状 | 先看 |
|---|---|
| 侧边栏一直"正在连接" | bridge 起了吗？`curl 127.0.0.1:8787/api/health`；端口改过就在设置里改地址 |
| "Token 无效" | 删掉 `.runtime/config.json` 重启 bridge 会换 token；或直接点"自动获取" |
| 工具一直"执行中" | 侧边栏被关过；重新打开侧边栏，bridge 会超时并告诉模型 |
| "页面没有响应" | 页面在跳转/加载；重新快照或 `browser_wait` |
| 点击没反应 | 元素可能是 `<div>` 上的 JS 事件；先 `browser_snapshot` 用 ref 点，或换成 `browser_find` |
| 模型说页面没内容 | 正文预算 8k；让它用 `browser_read` 指定 `maxChars`，或滚动后再读 |
| 长图截图失败 | 有 DevTools 打开着同一个标签页，关掉再试 |
| bridge 启动报 `找不到 dsh` | `which dsh`，或设置 `DSH_BIN=/path/to/dsh` |
| 会话出现在不想去的地方 | 用 `--dsh-home` 指向单独环境 |
| 想看底层数据 | `.runtime/config.json`、`.runtime/sessions.json`、`DSH_HOME/sessions/` |


## 上游与致谢

本项目建立在以下开源项目之上，感谢作者和维护者：

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — agent 运行时、SDK 协议、MCP 客户端（MIT）。
- [deepseek-harness-intelligent-ui](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) — 富 UI 组件目录与 `ui_render` / `ui_compose` / `ui_patch` 工具契约（MIT）。
- [Sutera-Diffusus/dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume) — DeepSeek 鲸娘素材（MIT © Sutera-Diffusus；插画 [@SuteraWu](https://github.com/SuteraWu)），完整许可见 [tools/ICON-CREDITS.md](tools/ICON-CREDITS.md)。
- [Playwright](https://github.com/microsoft/playwright) — 浏览器测试，仅开发依赖（Apache-2.0）。

早期原型在 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 工作区中开发；当前代码与构建不依赖该仓库。

第三方许可汇总见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## License

MIT，见 [LICENSE](LICENSE)。第三方素材和依赖的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：
intelligent-ui（MIT）、DSH（MIT）、鲸娘素材（MIT © Sutera-Diffusus / 插画 @SuteraWu）、playwright-core（Apache-2.0，仅开发依赖）。

本项目与 DeepSeek 官方无隶属关系；`DSH EasySider` 是社区工具。
