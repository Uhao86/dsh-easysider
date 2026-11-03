# DSH EasySider

A Chrome side panel that puts a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent beside the page you are reading. It understands the current tab, answers questions from the page, and can actually operate the browser: click, type, scroll, navigate, find text, highlight, and take screenshots.

Rich answers render as native cards, tables, charts, timelines and forms through [`deepseek-harness-intelligent-ui`](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) instead of a wall of Markdown.

[简体中文](README.md) · **English**


> **Status:** experimental community project. It is not an official DeepSeek product and is not affiliated with or endorsed by DeepSeek.

---

## Highlights

- **Page-aware chat** — title, URL, readable text, heading outline and the current selection are attached to your message (optional).
- **Browser control** — read the page, snapshot interactive elements with stable `e1…eN` refs, click, type, scroll, find, navigate, highlight, wait and screenshot.
- **Intelligent UI** — the agent can answer with live components (`ui_render`, `ui_compose`, `ui_patch`), and the side panel renders them natively. Edits patch the same card in place.
- **Reasoning effort** — switch between auto / fast / standard / deep / maximum between turns.
- **Session history** — pin, rename, archive and restore conversations.
- **Local by default** — the bridge listens on `127.0.0.1` only and shares the `dsh web` environment (`~/.dsh`), so credentials and the model are the ones you already use.
- **Narrow tool surface** — the side-panel agent has browser tools and web read/search, but **no shell, file system, subagents or workflow tools**.

---

## How it works

```
┌──────────────────────── Chrome ────────────────────────┐
│  side panel (HTML/JS)          content script           │
│  · chat UI + rich UI renderer  · read page / snapshot   │
│  · executes browser tools      · click / type / wait    │
│         │  chrome.tabs / chrome.scripting               │
└─────────┼───────────────────────────────────────────────┘
          │  HTTP + SSE on 127.0.0.1:8787 (bearer token)
┌─────────▼───────────────────────────────────────────────┐
│  server/bridge.mjs                                      │
│  · owns the DSH child process and streams its events     │
│  · routes MCP tool calls to the side panel               │
└─────────┬───────────────────────────────────────────────┘
          │  stdio JSON-RPC
┌─────────▼───────────────────────────────────────────────┐
│  dsh --profile sdk   (DSH_HOME=~/.dsh by default)       │
│  · model, sessions, compaction, credentials              │
│  · browser tools via MCP (server/browser-mcp.mjs)        │
│  · intelligent-ui plugin (optional, recommended)         │
└─────────┬───────────────────────────────────────────────┘
          │  MCP stdio
┌─────────▼───────────────────────────────────────────────┐
│  server/browser-mcp.mjs                                 │
│  forwards each browser_* call back to the bridge         │
└─────────────────────────────────────────────────────────┘
```

### Why `sdk` and not the `web` profile?

`dsh web` is an HTTP application (web server + browser frontend) and does not expose a chat stream to external clients. The bridge needs a long-lived stdio agent, so it uses DSH's `sdk` composition while pointing `DSH_HOME` at the `dsh web` environment. The agent core, model, credentials and session store are the same; only the transport differs. The side panel has its own UI renderer for the intelligent-ui component tree.

If you want the `dsh web` GUI agent to control Chrome too, you can mount the same MCP server into the `web` profile — see [`examples/web-profile-browser.patch.yml`](examples/web-profile-browser.patch.yml).

---

## Requirements

You can start from zero; the quick start installs DSH and intelligent-ui for you.

| Requirement | Notes |
|---|---|
| Node.js ≥ 22.19 | DSH runtime requirement |
| Chrome / Chromium ≥ 116 | Side Panel API |
| Git | Clone the repository |
| A DeepSeek account | Sign-in during the first `dsh web` |
| DSH CLI | Installed in the quick start with npm |
| `deepseek-harness-intelligent-ui` | Installed into the `sdk` profile; optional but recommended |
| macOS only for icon regeneration | `tools/make-icons.mjs` uses `sips` |

The bridge has **no runtime npm dependencies**. `npm install` is only for the browser tests (`playwright-core`).

## Quick start

Pick one path:

- **Path A — for humans:** copy the commands from zero to your first chat.
- **Path B — for agents:** hand this section to an agent; it checks, installs, starts and verifies everything up to the point where **you must load the extension manually**.

> Commands target macOS / Linux. On Windows use the PowerShell equivalents, Git Bash or WSL.
>
> DSH itself: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

### Path A: for humans (from zero)

#### 0. Check the environment

```sh
node -v            # needs v22.19 or newer
git --version
dsh --version      # "command not found" is expected before step 1
(test -d "/Applications/Google Chrome.app" || command -v google-chrome || command -v chromium) && echo "Chrome ok"
```

- Missing or older Node: install Node 22 (`brew install node` on macOS, `nvm install 22 && nvm use 22` with nvm, or nodejs.org), then reopen the terminal.
- Missing git: `xcode-select --install` on macOS; install Git elsewhere.
- Missing Chrome/Chromium ≥ 116: install Chrome or Chromium.

#### 1. Install DSH and sign in once

```sh
npm install -g @deepseek-ai/dsh
dsh --version
DSH_HOME="$HOME/.dsh" dsh web
```

The browser opens DSH Web. Sign in with your DeepSeek account, confirm the model, then press `Ctrl-C` in the terminal. This creates `~/.dsh` and your credentials.

- Port conflict: `DSH_HOME="$HOME/.dsh" dsh web --port 3090`.
- Do not open a browser automatically: `DSH_HOME="$HOME/.dsh" dsh web --no-open` and open the printed URL manually.
- Keep `DSH_HOME` explicit so an ambient value cannot write the sign-in into another environment.
- Already signed in (`~/.dsh/.credentials.yaml` exists): skip this step.
- If `dsh: command not found`: reopen the terminal, or add npm's global bin directory to `PATH`.

#### 2. Clone and install intelligent UI

```sh
git clone https://github.com/Uhao86/dsh-easysider.git
cd dsh-easysider
DSH_HOME="$HOME/.dsh" dsh plugin --profile sdk add deepseek-harness-intelligent-ui@0.2.13
```

The panel still works without intelligent-ui, but answers fall back to Markdown. When the bridge starts it generates an overlay that disables the 3D widget.

#### 3. Start the bridge

```sh
chmod +x start stop
./start
```

Keep this terminal open. You should see `pairing http://127.0.0.1:8787/`. Stop with `./stop` or `Ctrl-C`.

#### 4. Load the extension and pair

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the repository's `extension/` directory.
3. Pin the icon and click it (or press `Alt+Shift+S`).
4. On first run click **自动获取 Token** (Get token automatically).

If loading fails, see [Chrome extension installation](#chrome-extension-installation). Otherwise continue to **Try it** below.

### Path B: for agents (up to the manual extension install)

Hand this section to the agent. The agent must:

- Ask before any global install, port takeover or file deletion.
- **Never install the Chrome extension automatically** and never modify the user's Chrome profile.
- Never commit tokens, `.runtime` or `~/.dsh` credentials, and never print them into a public place.

#### B0. Preflight (check everything first)

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

Expected: Node ≥ v22.19, git and Chrome present, port 8787 free. If Node or Chrome is missing, stop and tell the user; do not silently install system software. If 8787 is occupied, identify the process and ask before touching it.

#### B1. Install missing Node / DSH (with consent)

If Node is missing or older than 22.19:

```sh
# macOS
brew install node
# or with nvm
nvm install 22 && nvm use 22
node -v
```

Missing git: `xcode-select --install` on macOS, or the platform package manager.

If DSH is missing:

```sh
npm install -g @deepseek-ai/dsh
dsh --version
```

Do not silently change PATH or global packages; stop and ask if an install needs sudo, fails, or if Chrome is missing.

#### B2. Sign in only when needed

```sh
LOG="${TMPDIR:-/tmp}/dsh-easysider-web.log"
DSH_HOME="$HOME/.dsh" dsh web --no-open --port 3090 > "$LOG" 2>&1 &
DSH_WEB_PID=$!
sleep 2
cat "$LOG"
# Give the URL to the user. Wait for credentials (up to 5 minutes).
i=0
while [ "$i" -lt 60 ] && [ ! -s "$HOME/.dsh/.credentials.yaml" ]; do sleep 5; i=$((i+1)); done
kill "$DSH_WEB_PID" 2>/dev/null || true
test -s "$HOME/.dsh/.credentials.yaml" && echo "CREDENTIALS_OK" || echo "SIGNIN_TIMEOUT"
```

Skip this when `CREDENTIALS_OK` is already true. If the user already runs `dsh web`, let them sign in there instead.

#### B3. Clone or update

```sh
if [ -f package.json ] && grep -q '"name": "dsh-easysider"' package.json; then
  git pull --ff-only
elif [ -d dsh-easysider/.git ]; then
  cd dsh-easysider && git pull --ff-only
else
  git clone https://github.com/Uhao86/dsh-easysider.git && cd dsh-easysider
fi
```

#### B4. Install intelligent UI

```sh
DSH_HOME="$HOME/.dsh" dsh plugin --profile sdk add deepseek-harness-intelligent-ui@0.2.13
test -d "$HOME/.dsh/profiles/sdk/node_modules/deepseek-harness-intelligent-ui" && echo "UI_PLUGIN_OK"
```

#### B5. Start the bridge and verify

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

Verify `"ok": true`, `"home"` points at `~/.dsh`, and the token exists. Note the pairing URL `http://127.0.0.1:8787/`.

#### B6. STOP — hand off to the user

**The agent stops here.** Do not install the Chrome extension automatically. Tell the user:

1. Open `chrome://extensions` and enable Developer mode.
2. Load unpacked → select `<repository>/extension`.
3. Pin the icon → click it → click **自动获取 Token**, and keep the side panel open.
4. Reply when it is installed.

After the user confirms, poll `curl -s http://127.0.0.1:8787/api/health` until `"clients"` is greater than 0, then hand over **Try it**. If it stays at 0, ask for the extension error or the panel console.

## Try it

Prerequisites: the bridge is running on `127.0.0.1:8787`, and the extension is loaded and paired.

1. Open <https://example.com> (or any normal page).
2. Click the whale-girl toolbar icon or press `Alt+Shift+S`.
3. On first run click **自动获取 Token**. The page card at the top shows the current tab title when connected.
4. Ask `Summarize this page in three bullets.` The answer arrives in your language; tool rows appear when the agent reads the DOM.
5. Try an action: `Click the “More information” link on the page.`
6. Try rich UI: `Use ui_render to make a card with 2 Stat tiles, a bar chart and a table.` Without intelligent-ui this falls back to Markdown.
7. Try reasoning: set **思考** to `深入` (Deep) and ask a harder question.
8. Try history: open the history icon at the top right; pin, rename or archive a conversation.

If the panel stays on "Connecting", confirm the bridge terminal is still open and `curl http://127.0.0.1:8787/api/health` works; then see [Troubleshooting](#troubleshooting).

---

## Browser tools

The model sees `mcp__browser__browser_*`; the UI shows short Chinese labels.

| Tool | What it does |
|---|---|
| `browser_status` | List tabs and identify the active one |
| `browser_read` | Title, URL, selection, heading outline and main text |
| `browser_snapshot` | Interactive elements with stable refs (`e1…eN`) |
| `browser_open` | Navigate the active tab or a new tab, then wait for load |
| `browser_click` | Click by ref, CSS selector or visible text |
| `browser_type` | Type into an input, optionally submit |
| `browser_scroll` | Up/down/top/bottom, or scroll an element into view |
| `browser_find` | Find visible text and return snippets plus refs |
| `browser_screenshot` | Visible area (default) or full page via CDP |
| `browser_history` | Back, forward, reload |
| `browser_highlight` | Draw a box around refs or a text match |
| `browser_wait` | Wait for a selector, text, or a fixed delay |

`web_search` and `web_fetch` come from DSH itself.

Refs are stable for the lifetime of a page but become stale after navigation or a large DOM update; the agent is instructed to take a fresh snapshot on failure.

---

## Intelligent UI

When the `intelligent-ui` plugin is installed, the side panel renders these DSH tools natively:

| Tool | Purpose |
|---|---|
| `ui_render` | Declarative component tree |
| `ui_compose` | Markdown prose interleaved with component blocks |
| `ui_patch` | Update a previously rendered card in place (works across messages) |

Supported components include Card, Stack, Grid, Tabs, Text, Code, Alert, Badge, Divider, Stat, Progress, List, Table (sort/search/page/CSV), Chart (bar/line/area/pie), Scatter, Heatmap, Timeline, CodeDiff, FileTree, JsonView, Image, Gallery, Video, Choice, Button and Form.

<p align="center"><img src="test/ui-sample.png" width="320" alt="Rich UI in the side panel"></p>

<p align="center"><em>Rich UI rendered natively: KPI tiles, a line chart and a sortable table. <code>ui_patch</code> updates the card in place.</em></p>

Known gaps:

- `ui_render_widget` (3D / custom HTML) is **disabled** by the generated profile patch: MV3's extension CSP blocks arbitrary inline and remote scripts. Use the full `dsh web` app for widgets.
- `Math` (KaTeX), `Mermaid`, `Map` and `Plot` currently show a source/list fallback.
- Table sorting, tab selection and form state reset when the whole message is re-rendered.

---

## Reasoning effort

Use the **思考** selector next to the composer. The options are Chinese in the current UI:

| UI label | `reasoningEffort` |
|---|---|
| 自动 (Auto) | omitted (model default) |
| 快速 (Fast) | `off` |
| 标准 (Standard) | `low` |
| 深入 (Deep) | `high` |
| 极限 (Maximum) | `max` |

Changing it while idle calls `POST /api/settings`, persists the choice, and restarts the DSH runtime so the next message uses the new effort. While a turn is running the request is refused (HTTP 409) to avoid killing it mid-flight.

---

## Session history

The **历史对话** sheet supports (the icons are 置顶 / 重命名 / 归档):

- **Pin** — pinned conversations sort above recent ones.
- **Rename** — inline edit; Enter saves, Esc cancels. Custom titles are never overwritten by the first message.
- **Archive / restore** — archived conversations fold into “Show archived”.

<p align="center"><img src="test/sessions.png" width="320" alt="Session history: pin, rename, archive"></p>

<p align="center"><em>The history sheet: pin, rename and archive.</em></p>

The title index lives in `.runtime/sessions.json`; full session logs live under `DSH_HOME/sessions/`. For development cleanup:

```sh
node tools/clean-test-sessions.mjs          # dry run
node tools/clean-test-sessions.mjs --apply  # remove probe/smoke/test sessions
```

The cleanup only removes `sidebar-probe-*`, `sidebar-smoke-*`, `sidebar-test-*`, `sidebar-sessions-*` and sessions under test-only home directories. Real `sidebar-<uuid>` conversations are kept.

---

## Configuration

The bridge accepts flags or environment variables and persists port, token, model and effort in `.runtime/config.json` (mode 600). `DSH_HOME` is resolved at every launch and is not persisted.

| Flag | Environment | Default |
|---|---|---|
| `--port` | `DSH_SIDEBAR_PORT` | `8787` |
| `--model` | `DSH_SIDEBAR_MODEL` | `deepseek-flash` |
| `--provider` | `DSH_SIDEBAR_PROVIDER` | `deepseek-official` |
| `--dsh-home` | `DSH_SIDEBAR_DSH_HOME` | `~/.dsh` |
| `--max-page-chars` | `DSH_SIDEBAR_MAX_PAGE_CHARS` | `8000` |
| `--reasoning-effort` | `DSH_SIDEBAR_EFFORT` | `auto` |
| runtime directory | `DSH_SIDEBAR_RUNTIME` | `.runtime` |
| `dsh` binary | `DSH_BIN` | auto-detected |

In the side-panel **设置** you can change the bridge URL and token, and toggle **页面** (attach page text) and **截图** (attach the visible area).

Session ids look like `sidebar-<uuid>`. UI message caches live in `chrome.storage.local`; full events live in `DSH_HOME/sessions/`.

---

## Privacy, security and permissions

**Local bridge.** The bridge binds `127.0.0.1` only. Every API call needs the random token; the pairing endpoint accepts extension/local origins. Delete `.runtime/config.json` to rotate the token.

**What leaves your machine.** Page text, the selected text, and screenshots you attach are sent to the model provider configured in DSH (`deepseek-official` by default) as part of the prompt. DSH's own data-handling terms apply. This project adds no telemetry, analytics or cloud service.

**Local data.** The token is stored in `.runtime/config.json` (0600) and `chrome.storage.local`; conversations are stored in `~/.dsh/sessions/` and the UI cache in `chrome.storage.local`.

**Permissions.**

| Permission | Why |
|---|---|
| `sidePanel` | The UI itself |
| `tabs` | Read tab title/URL, list tabs, navigate |
| `scripting` + `<all_urls>` | Inject the content script into the page you ask about |
| `activeTab` | User-invoked access to the current tab |
| `storage` | Settings and local message cache |
| `contextMenus` | “Summarize this page / explain selection” |
| `debugger` | Full-page screenshot via Chrome DevTools Protocol |

You can narrow `<all_urls>` to specific sites if you only use the panel there; `ensureInjected` will then fail gracefully elsewhere.

**Prompt injection.** Page content is untrusted input. The agent is instructed to ignore page text that tries to change its task, exfiltrate secrets or trigger unrelated navigation. This is a mitigation, not a hard sandbox.

**Real side effects.** Clicking and typing affect the same session you use in Chrome, including logged-in sites. Do not let the agent operate payment, password-manager or browser-settings pages unattended.

**No local execution.** The generated `sdk` overlay disables `bash`, PowerShell, file read/write, subagents, workflows, goals and plan mode. The agent can read pages, call browser tools and use web search/fetch.

---


## Chrome extension installation

Load unpacked is the supported path (the extension is not on the Chrome Web Store):

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this repository's `extension/` directory
4. Pin the toolbar icon

| Symptom | Check |
|---|---|
| "Could not load extension" / manifest missing | Select the `extension/` folder that contains `manifest.json`, not the repository root |
| The Load button is greyed out | Developer mode is off |
| "This extension may have been corrupted" | Re-clone or re-download; check file permissions |
| Blocked by enterprise policy | `chrome://policy`: `ExtensionInstallBlocklist` / `ExtensionSettings`; ask an admin or use another browser |
| `--load-extension` has no effect (automation) | Chrome 137+ gates the command-line flag for branded builds; manual loading is unaffected. Use Chrome for Testing for automation |
| Icon missing from the toolbar | Pin it from the puzzle menu or the extension card |

If manual loading still fails, choose one of these paths: (1) manual troubleshooting, (2) Chrome for Testing for automated verification, or (3) no-browser tests (`node test/smoke.mjs`, `node test/sessions.mjs`).

## Limitations

- Main frame only; cross-origin iframes and much of shadow DOM are out of reach.
- Refs go stale after navigation or large DOM changes.
- Streaming arrives per committed step, not token by token.
- Stop kills the DSH runtime; the session is persisted and the next message attempts `session/resume`.
- `chrome://`, the Web Store and the PDF viewer cannot be scripted.
- Full-page screenshots use `chrome.debugger` and show Chrome's debugging banner briefly.
- The side panel shares `~/.dsh` with `dsh web`; sidebar conversations appear in the same session directory unless you pass `--dsh-home`.
- The side-panel chrome (buttons, labels) is Chinese-only for now; the assistant answers in your language.
- Experimental; APIs and the component renderer may change.

---

## Development

```sh
npm install                 # playwright-core, only for tests
node --check server/bridge.mjs

node test/render.mjs        # rich UI renderer + compose, no model
node test/sessions.mjs      # session API: pin / rename / archive
node test/sessions-ui.mjs   # history sheet in a real Chrome, no model
node test/smoke.mjs         # bridge + MCP + one small model turn
node test/ui.mjs            # real Chrome: pairing, read, click, screenshot, ui_render, ui_patch
node test/probe-live.mjs    # probe a running bridge on 8787
```

The browser tests need Chrome for Testing (branded Chrome 137+ ignores `--load-extension`). They auto-discover Playwright's Chromium cache; set `DSH_TEST_CHROME=/path/to/chrome` to override. The tests create isolated `DSH_HOME`s under `.runtime-*` and only symlink the credentials file, so they do not write to your real session directory. `test/ui.mjs` also expects the intelligent-ui plugin in the `sdk` profile; skip it if you have not installed the plugin.

To regenerate icons:

```sh
node tools/make-icons.mjs
```

It uses the anthropomorphic whale-girl image by default and falls back to the blue whale when the source is missing or exceeds 1.5 MB. macOS `sips` is required for resizing.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel keeps “Connecting” | Is `./start` running? `curl 127.0.0.1:8787/api/health`; is the Bridge URL correct? |
| “Token invalid” | Delete `.runtime/config.json` and restart, or click **Get token automatically** |
| Tool stays “Running” | The panel was closed; reopen it. The bridge times out and tells the model |
| “Page did not respond” | The page is navigating; take a fresh snapshot or use `browser_wait` |
| Click does nothing | The element may be a `<div>` with a JS listener; use `browser_snapshot` and a ref, or `browser_find` |
| Model says the page has no content | Attach more text via `browser_read` with a larger `maxChars`, or scroll and retry |
| Full-page screenshot fails | Close DevTools on that tab |
| `dsh` not found | `which dsh`, or set `DSH_BIN` |
| Extension will not load | Select the `extension/` folder (it contains `manifest.json`), not the repository root; enable Developer mode |

---

## Project layout

```
.
├── server/
│   ├── bridge.mjs          # local HTTP/SSE bridge + DSH child + tool routing
│   └── browser-mcp.mjs     # stdio MCP server exposing browser_* tools
├── extension/
│   ├── manifest.json
│   ├── background.js       # context menu / open side panel
│   ├── sidepanel.html/css/js
│   ├── markdown.js         # shared Markdown renderer
│   ├── ui-render.js        # intelligent-ui component tree renderer
│   ├── content.js          # page text, snapshot, click, type, highlight, wait
│   └── icons/
├── examples/
│   └── web-profile-browser.patch.yml
├── test/
├── tools/
└── start / stop
```

---

## Contributing

Issues and pull requests are welcome. Please:

- Keep the bridge runtime dependency-free (`node:http` / `node:child_process` only).
- Run `node --check` on changed JS and the no-model tests before opening a PR.
- Never commit `.runtime/`, `.runtime-*`, tokens, `.pem`, `.crx` or a real `~/.dsh` session.
- Describe browser-tool changes with the exact selector/ref behavior you tested.

---

## Upstream projects & credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — agent runtime, SDK protocol, MCP client.
- [deepseek-harness-intelligent-ui](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) — component catalog and tool contract.
- [Sutera-Diffusus/dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume) — DeepSeek whale-girl artwork (MIT © Sutera-Diffusus; illustrations by [@SuteraWu](https://github.com/SuteraWu)). Full text in [tools/ICON-CREDITS.md](tools/ICON-CREDITS.md).
- [Playwright](https://github.com/microsoft/playwright) — browser tests (dev dependency).

The project was initially prototyped in the [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) workspace; no code from that repository is bundled and the current build depends only on the projects above. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the consolidated notices.

---

## License

MIT — see [LICENSE](LICENSE). Third-party notices, including the whale-girl artwork and intelligent-ui, are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

DeepSeek, DSH and related names are trademarks of their respective owners. DSH EasySider is an independent community project.

