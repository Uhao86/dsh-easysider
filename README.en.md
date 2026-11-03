# DSH EasySider

> A Chrome super sidebar for `dsh web`.

[简体中文](README.md) · **English**

Put a DeepSeek Harness agent in a Chrome side panel: read the current page, click, type, take screenshots, and answer with cards and charts. It reuses `dsh web`'s `~/.dsh` — the same sign-in, model and session store.

<p align="center"><img src="test/ui-sample.png" width="320" alt="KPI tiles, a line chart and a table in the side panel"></p>

## One sentence for your agent

Send this to the agent you already use (Claude Code, Codex, DSH, …):

> Clone and set up https://github.com/Uhao86/dsh-easysider: read `AGENTS.md` first and follow it until I need to load the Chrome extension manually.

It will check the environment, sign in to DSH and start the bridge, then stop at “load the extension”. The full agent runbook is [AGENTS.md](AGENTS.md).

## Manual installation

Requires Node.js 22.19+.

```sh
git clone https://github.com/Uhao86/dsh-easysider.git
cd dsh-easysider
./start
```

`./start` checks Node/DSH, offers to install DSH if missing, opens `dsh web` once if you are not signed in, and starts the bridge. When you see `pairing http://127.0.0.1:8787/`:

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
2. Click the whale-girl icon in the toolbar (or press `Alt+Shift+S`) → **自动获取 Token**.

On Windows use Git Bash. Detailed setup, configuration and tools are in [operate.md](operate.md); errors, limits and troubleshooting are in [warmtips.md](warmtips.md). Both are currently in Chinese.

## Optional: intelligent UI

Recommended, not required — without it answers fall back to Markdown.

```sh
./start --with-ui
```

Or install the plugin first and start normally:

```sh
DSH_HOME="$HOME/.dsh" dsh plugin --profile sdk add deepseek-harness-intelligent-ui
./start
```

## What it does

- Reads the page: title, text, selection, visible-area screenshot, interactive-element snapshot.
- Operates the browser: click, type, scroll, find, back/forward, open links, wait.
- Multi-turn sessions with pin, rename and archive; survives tab switches and bridge restarts.
- Reasoning effort: fast / standard / deep / maximum.
- Context menu; `Alt+Shift+S` shortcut.
- Optional rich UI: cards, KPIs, tables, charts, timelines, Choice / Form.

<p align="center"><img src="test/sessions.png" width="320" alt="Session history: pin, rename, archive"></p>

## Privacy

The bridge listens on `127.0.0.1` only and every API call needs a token. Page text, the selection and any screenshot you attach are sent to the model provider configured in DSH. See [Privacy & permissions](operate.md#隐私与权限).

## Thanks

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — agent runtime, SDK and MCP client (MIT).
- [deepseek-harness-intelligent-ui](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) — rich-UI components and the `ui_render` / `ui_compose` / `ui_patch` tools (MIT).
- [Sutera-Diffusus/dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume) — whale-girl artwork (MIT © Sutera-Diffusus; illustrations by [@SuteraWu](https://github.com/SuteraWu)).
- [Playwright](https://github.com/microsoft/playwright) — browser tests, dev dependency only (Apache-2.0).

The first prototype lived in the [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) workspace; the current code does not depend on it. Full notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT — see [LICENSE](LICENSE). This is an independent community project, not affiliated with DeepSeek.
