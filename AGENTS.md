# AGENTS.md

给 agent 的安装与启动说明。目标：把 DSH EasySider 运行到“需要用户手动加载 Chrome 扩展”为止。

## 规则

- 安装全局软件、处理端口占用、删除文件前，先征得用户同意。
- **不要**自动安装或加载 Chrome 扩展，也不要修改用户的 Chrome profile。
- 不要输出 token、`~/.dsh` 凭据或 `.runtime/` 的内容。
- 用户既然在用 Chrome 扩展，就假设 Chrome 已安装；**不要检查或安装 Chrome**。
- 遇到未覆盖的错误，先看 [warmtips.md](warmtips.md)。

## 0. 预检

```sh
uname -s
node -v
git --version
command -v dsh && dsh --version || echo DSH_MISSING
command -v curl >/dev/null && echo CURL_OK || echo CURL_MISSING
test -s "$HOME/.dsh/.credentials.yaml" && echo CREDENTIALS_OK || echo SIGNIN_REQUIRED
lsof -nP -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true
```

- Node 必须 ≥ 22.19。缺失或过低时先问用户，再按其系统安装。
- git / curl 缺失：停下来让用户安装，不要静默装系统包。
- 8787 被占用：先确认是什么进程，再让用户决定换端口或停掉。

## 1. 安装 DSH（仅 DSH_MISSING）

先问用户，得到同意后：

```sh
npm install -g @deepseek-ai/dsh
dsh --version
```

如果 `dsh` 仍不在 PATH，让用户重开终端，或设置 `DSH_BIN`。不要改用户的 shell 配置。

## 2. 登录（仅 SIGNIN_REQUIRED）

`CREDENTIALS_OK` 为真就跳过。否则：

```sh
LOG="${TMPDIR:-/tmp}/dsh-easysider-web.log"
DSH_HOME="$HOME/.dsh" dsh web --no-open --port 3090 >"$LOG" 2>&1 &
DSH_WEB_PID=$!
sleep 2
cat "$LOG"
```

把日志里打印的 URL 给用户，请其用 DeepSeek 账号登录。等待凭据出现（最多 5 分钟）：

```sh
i=0
while [ "$i" -lt 60 ] && [ ! -s "$HOME/.dsh/.credentials.yaml" ]; do sleep 5; i=$((i+1)); done
kill "$DSH_WEB_PID" 2>/dev/null || true
test -s "$HOME/.dsh/.credentials.yaml" && echo CREDENTIALS_OK || echo SIGNIN_TIMEOUT
```

3090 被占用就换一个端口。超时就问用户是否已登录，或让其在浏览器里完成登录后重试。

## 3. 获取代码

如果当前目录已经是仓库（`package.json` 的 `name` 是 `dsh-easysider`）：

```sh
git pull --ff-only
```

否则：

```sh
git clone https://github.com/Uhao86/dsh-easysider.git
cd dsh-easysider
```

## 4. 启动 bridge

问用户是否要富 UI（可选，推荐）。要：

```sh
./start --with-ui
```

不要：

```sh
./start
```

在后台启动并验证（按上面的选择，保留或去掉 `--with-ui`）：

```sh
mkdir -p .runtime
./start --with-ui > .runtime/bridge.log 2>&1 &
i=0
while [ "$i" -lt 120 ]; do
  curl -sf http://127.0.0.1:8787/api/health >/dev/null && break
  sleep 1; i=$((i+1))
done
curl -s http://127.0.0.1:8787/api/health
node -p "Boolean(require('./.runtime/config.json').token)"
```

确认 `"ok": true`、`"agent.home"` 指向 `~/.dsh`，并且 token 存在（输出 `true`）。记下配对地址 `http://127.0.0.1:8787/`，不要把 token 贴出来。如果健康检查一直失败：

```sh
tail -40 .runtime/bridge.log
```

## 5. STOP：用户手动加载扩展

**在这里停止。** 不要自动装扩展。告诉用户：

1. `chrome://extensions` → 开发者模式 → 加载已解压 → 选择 `<仓库目录>/extension`。
2. 固定图标 → 点击 → **自动获取 Token**。
3. 保持侧边栏打开，装好后回复你。

用户确认后：

```sh
curl -s http://127.0.0.1:8787/api/health
```

直到 `"agent.clients"` 大于 0。若一直为 0，请用户贴扩展的报错或控制台信息，并看 [warmtips.md](warmtips.md)。

## 6. 交接

告诉用户：详细操作在 [operate.md](operate.md)，常见问题在 [warmtips.md](warmtips.md)。
