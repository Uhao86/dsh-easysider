#!/usr/bin/env node
/**
 * Real-Chrome UI test (headless new mode, no downloads):
 *   - launches installed Chrome with the unpacked extension
 *   - starts the bridge on an isolated port
 *   - opens the side panel page as a tab next to a controlled test page
 *   - drives the composer and verifies that the agent reads, clicks and
 *     screenshots the page through the extension
 *
 * Costs a few small model turns. Run: node test/ui.mjs
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { prepareTestDshHome } from './dsh-home.mjs'
import { findChromeForTesting } from '../tools/chrome-path.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(ROOT, '.runtime-ui')
const EXT = join(ROOT, 'extension')
const PORT = 8788
const PAGE_PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const PAGE = `http://127.0.0.1:${PAGE_PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
rmSync(RUNTIME, { recursive: true, force: true })
const DSH_HOME = prepareTestDshHome(RUNTIME)

const TEST_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DSH 侧边栏测试页</title></head>
<body style="font:16px/1.6 -apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 20px">
  <h1>DSH 侧边栏测试页</h1>
  <p id="msg">这是一个用于测试 Chrome 侧边栏的页面。它有一个链接、一个输入框和一个按钮。</p>
  <p><a id="link" href="/second.html">前往第二页</a></p>
  <p><input id="q" placeholder="在这里输入点什么" style="padding:6px 8px;width:240px"></p>
  <p><button id="act" style="padding:6px 14px">点击我</button></p>
  <script>
    document.getElementById('act').addEventListener('click', () => {
      document.getElementById('msg').textContent = '已点击按钮，页面内容已更新。'
      document.getElementById('act').textContent = '已点击'
    })
  </script>
</body></html>`

const SECOND_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>第二页</title></head>
<body style="font:16px/1.6 sans-serif;max-width:640px;margin:48px auto"><h1>第二页</h1><p>你成功导航到了第二页。</p><a href="/">返回</a></body></html>`

const pageServer = createServer((req, res) => {
  const html = req.url?.startsWith('/second') ? SECOND_HTML : TEST_HTML
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})

const bridge = spawn(process.execPath, [join(ROOT, 'server', 'bridge.mjs'), '--port', String(PORT), '--dsh-home', DSH_HOME], {
  env: { ...process.env, DSH_SIDEBAR_RUNTIME: RUNTIME },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let bridgeLog = ''
bridge.stdout.on('data', (chunk) => { bridgeLog += chunk; process.stdout.write(`[bridge] ${chunk}`) })
bridge.stderr.on('data', (chunk) => { bridgeLog += chunk; process.stderr.write(`[bridge:err] ${chunk}`) })

let context
let exitCode = 0
async function cleanup() {
  try { await context?.close() } catch {}
  try { bridge.kill('SIGTERM') } catch {}
  pageServer.close()
  await sleep(300)
  rmSync(RUNTIME, { recursive: true, force: true })
}

function fail(message) {
  console.error(`\n✗ ${message}`)
  if (bridgeLog) console.error('\n--- bridge tail ---\n' + bridgeLog.slice(-2500))
  exitCode = 1
  throw new Error(message)
}

async function waitBridge() {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return } catch {}
    await sleep(250)
  }
  throw new Error('bridge did not start')
}

async function snapshotPanel(panel) {
  return await panel.evaluate(() => {
    const messages = [...document.querySelectorAll('.msg.assistant')]
    const last = messages[messages.length - 1]
    return {
      text: last ? [...last.querySelectorAll('.part-text')].map((el) => el.innerText).join('\n\n') : '',
      thinking: Boolean(last?.querySelector('.thinking')),
      tools: last ? [...last.querySelectorAll('.tool')].map((el) => ({ cls: el.className, text: el.innerText })) : [],
      error: last?.querySelector('.msg-error')?.innerText ?? '',
      busy: document.querySelector('#btnStop')?.style.display !== 'none',
      conn: document.querySelector('#connBar')?.hidden ? 'online' : document.querySelector('#connText')?.textContent,
    }
  })
}

async function waitAssistant(panel, { timeout = 150000, expectText = true } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const snap = await snapshotPanel(panel)
    if (snap.error) fail(`assistant error: ${snap.error}`)
    if ((!expectText || snap.text) && !snap.thinking && !snap.busy) return snap
    await sleep(400)
  }
  const snap = await snapshotPanel(panel)
  fail(`timed out waiting for assistant; last state: ${JSON.stringify(snap).slice(0, 800)}`)
}

async function ask(panel, text) {
  console.log(`\n[ui] ask: ${text}`)
  await panel.evaluate((value) => {
    const input = document.querySelector('#input')
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#btnSend').click()
  }, text)
  const snap = await waitAssistant(panel)
  console.log(`[ui] answer: ${snap.text.slice(0, 300).replace(/\n/g, ' ')}`)
  console.log(`[ui] tools: ${snap.tools.map((tool) => tool.text.replace(/\n/g, ' ')).join(' | ')}`)
  return snap
}

async function main() {
  await new Promise((r) => pageServer.listen(PAGE_PORT, '127.0.0.1', r))
  await waitBridge()
  const token = JSON.parse(readFileSync(join(RUNTIME, 'config.json'), 'utf8')).token
  console.log('[ui] bridge + token ready')

  // Branded Chrome 137+ ignores --load-extension; use Chrome for Testing
  // (shipped with Playwright) or set DSH_TEST_CHROME explicitly.
  const chromePath = findChromeForTesting()
  if (!chromePath) fail('找不到 Chrome for Testing。安装 Playwright Chromium 或设置 DSH_TEST_CHROME')

  context = await chromium.launchPersistentContext(join(RUNTIME, 'chrome-profile'), {
    executablePath: chromePath,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
    ],
  })

  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
  let extensionId = worker ? new URL(worker.url()).host : null
  if (!extensionId) {
    const probe = await context.newPage()
    await probe.goto('chrome://extensions-internals').catch(() => {})
    const text = await probe.evaluate(() => document.body.innerText).catch(() => '')
    await probe.close()
    const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
    const entry = (Array.isArray(parsed) ? parsed : []).find((item) => String(item.name ?? '').includes('DSH'))
    extensionId = entry?.id ?? null
  }
  if (!extensionId) fail('extension did not load in the test browser')
  console.log('[ui] extension id:', extensionId)

  const panel = await context.newPage()
  // A real side panel is roughly 380-450 CSS pixels wide.
  await panel.setViewportSize({ width: 400, height: 900 })
  panel.on('console', (message) => { if (message.type() === 'error') console.log('[panel:console]', message.text()) })
  panel.on('pageerror', (error) => console.log('[panel:pageerror]', error.message))
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  // First run: only the bridge URL is known, so the panel must show onboarding
  // and pair itself through /api/pair.
  await panel.evaluate(async ({ bridgeUrl }) => {
    await chrome.storage.local.set({
      settings: { bridgeUrl, token: '', model: 'deepseek-flash', includePage: true, screenshot: false },
    })
  }, { bridgeUrl: BASE })
  await panel.reload()
  await panel.waitForSelector('#onboardPair', { timeout: 10000 }).catch(() => fail('first-run onboarding is missing'))
  await panel.evaluate(() => document.querySelector('#onboardPair').click())
  await panel.waitForFunction(() => document.querySelector('#connBar')?.hidden === true, undefined, { timeout: 20000 })
    .catch(() => fail('side panel did not connect to the bridge after pairing'))
  const pairedToken = await panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.token)
  if (!pairedToken) fail('pairing did not store a token')
  console.log('[ui] paired via onboarding, token length:', pairedToken.length)

  // Static renderer check: no model call needed.
  const sample = await panel.evaluate(() => {
    const tree = {
      root: 'card',
      components: [
        { id: 'card', type: 'Card', props: { title: '渲染检查', subtitle: 'intelligent UI' }, children: ['stack'] },
        { id: 'stack', type: 'Stack', props: { direction: 'vertical', gap: 8 }, children: ['grid', 'chart', 'table', 'tabs'] },
        { id: 'grid', type: 'Grid', props: { columns: 2 }, children: ['s1', 's2'] },
        { id: 's1', type: 'Stat', props: { label: '访问', value: '1,234', delta: '+12%', trend: 'up' } },
        { id: 's2', type: 'Stat', props: { label: '转化', value: '3.2%', delta: '-0.4pp', trend: 'down' } },
        { id: 'chart', type: 'Chart', props: { kind: 'bar', labels: ['一月', '二月', '三月'], series: [{ name: '访问', values: [12, 20, 15] }, { name: '转化', values: [5, 8, 6] }], height: 160 } },
        { id: 'table', type: 'Table', props: { columns: ['名称', '数值'], rows: [['Alpha', 12], ['Beta', 7]], sortable: true, searchable: true } },
        { id: 'tabs', type: 'Tabs', props: { labels: ['概览', '详情'] }, children: ['t1', 't2'] },
        { id: 't1', type: 'Text', props: { text: '**概览** 内容' } },
        { id: 't2', type: 'List', props: { items: ['第一项', '第二项'], ordered: true } },
      ],
    }
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:380px'
    document.body.appendChild(host)
    const rendered = window.DSHUI.renderCatalog(tree, { send() {}, toast() {} })
    host.appendChild(rendered)
    const result = {
      cards: host.querySelectorAll('.ui-card').length,
      stats: host.querySelectorAll('.ui-stat').length,
      charts: host.querySelectorAll('.ui-chart-svg').length,
      tables: host.querySelectorAll('.ui-table').length,
      tabs: host.querySelectorAll('.ui-tab').length,
    }
    host.remove()
    return result
  })
  console.log('[ui] static renderer:', JSON.stringify(sample))
  if (!sample.cards || !sample.stats || !sample.charts || !sample.tables || sample.tabs !== 2) fail('intelligent UI renderer produced an incomplete sample')

  const testPage = await context.newPage()
  await testPage.goto(PAGE, { waitUntil: 'load' })
  await testPage.bringToFront()
  await sleep(500)

  const contextTitle = await panel.evaluate(() => document.querySelector('#pageTitle')?.textContent)
  console.log('[ui] page card title:', contextTitle)
  if (!String(contextTitle).includes('DSH 侧边栏测试页')) fail(`page card did not follow the active tab: ${contextTitle}`)

  // 1. plain answer, page text attached
  const first = await ask(panel, '用一句话说明这个页面是做什么的。')
  if (!first.text.trim()) fail('empty answer for the summary question')

  // 2. snapshot tool
  const second = await ask(panel, '请调用 browser_snapshot 看看页面上的可交互元素，然后告诉我那个链接的文字是什么。')
  if (!second.tools.some((tool) => tool.text.includes('扫描交互元素'))) fail('browser_snapshot tool row missing')
  if (!second.tools.some((tool) => tool.cls.includes('ok'))) fail('browser_snapshot did not succeed')

  // 3. click tool
  const third = await ask(panel, '点击页面上标着「点击我」的按钮，然后确认页面上那段文字变成了什么。')
  await sleep(400)
  const pageText = await testPage.evaluate(() => document.querySelector('#msg')?.textContent)
  if (!String(pageText).includes('已点击按钮')) fail(`click did not change the test page: ${pageText}`)
  if (!/已点击按钮/.test(third.text)) fail(`answer did not confirm the click: ${third.text}`)
  console.log('[ui] click verified on the real page')

  // 4. screenshot tool
  const fourth = await ask(panel, '现在截个图，告诉我你看到的页面主标题是什么。')
  if (!fourth.tools.some((tool) => tool.text.includes('截图'))) fail('browser_screenshot tool row missing')

  // 5. intelligent UI: ui_render should become a native card, not a tool row.
  await panel.evaluate(() => {
    const input = document.querySelector('#input')
    input.value = '请用 ui_render 工具做一个包含 2 个 Stat 和一个柱状图的卡片：本月访问量、转化率，再用柱状图展示最近三个月访问量。数据随意。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#btnSend').click()
  })
  await waitAssistant(panel, { expectText: false })
  const rich = await panel.evaluate(() => ({
    catalogs: document.querySelectorAll('.ui-catalog').length,
    cards: document.querySelectorAll('.ui-catalog .ui-card').length,
    stats: document.querySelectorAll('.ui-stat').length,
    charts: document.querySelectorAll('.ui-chart-svg').length,
    leaked: [...document.querySelectorAll('.tool')].filter((el) => /ui_render|ui_compose/.test(el.innerText)).length,
  }))
  console.log('[ui] ui_render:', JSON.stringify(rich))
  if (!rich.catalogs || !rich.cards) fail('ui_render did not render a catalog card')
  if (!rich.stats && !rich.charts) fail('ui_render rendered no Stat/Chart content')
  if (rich.leaked) fail('ui_render leaked as a plain tool row')

  // 6. ui_patch: edit the card in place (the bridge must forward tool/result meta).
  await panel.evaluate(() => {
    const input = document.querySelector('#input')
    input.value = '把刚才卡片里“本月访问量”的值改成 999，其他内容保持不变。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#btnSend').click()
  })
  await waitAssistant(panel, { expectText: false })
  const patched = await panel.evaluate(() => ({
    stats: [...document.querySelectorAll('.ui-stat')].map((el) => el.innerText.replace(/\n/g, ' ')),
    catalogs: document.querySelectorAll('.ui-catalog').length,
  }))
  console.log('[ui] ui_patch stats:', JSON.stringify(patched))
  if (!patched.stats.some((text) => text.includes('999'))) fail('ui_patch did not update the rendered card')
  if (patched.catalogs !== 1) fail(`ui_patch duplicated the card (${patched.catalogs} catalogs) instead of updating it`)

  // 7. history sheet: pin, rename, archive (uses /api/sessions/update).
  await panel.evaluate(() => document.querySelector('#btnHistory').click())
  await panel.waitForSelector('.session-item', { timeout: 5000 })
  await panel.evaluate(() => document.querySelector('.session-item.active [data-action="pin"]')?.click())
  await panel.waitForFunction(() => document.querySelector('.session-item.active')?.classList.contains('pinned'), undefined, { timeout: 5000 })
    .catch(() => fail('pin did not update the history row'))
  await panel.evaluate(() => {
    const input = document.querySelector('.session-rename')
    if (input) return
    document.querySelector('.session-item.active [data-action="rename"]')?.click()
  })
  await panel.waitForSelector('.session-rename', { timeout: 5000 })
  await panel.evaluate((title) => {
    const input = document.querySelector('.session-rename')
    input.value = title
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, '回归测试会话')
  await panel.waitForFunction(() => document.querySelector('.session-item.active .s-title')?.textContent === '回归测试会话', undefined, { timeout: 5000 })
    .catch(() => fail('rename did not persist in the history row'))
  await panel.evaluate(() => document.querySelector('.session-item.active [data-action="archive"]')?.click())
  await panel.waitForSelector('.session-toggle', { timeout: 5000 })
  await panel.evaluate(() => document.querySelector('.session-toggle')?.click())
  await panel.waitForSelector('.session-group.archived .session-item', { timeout: 5000 })
  const history = await panel.evaluate(() => ({
    pinned: Boolean(document.querySelector('.session-group.archived .session-item.pinned')),
    title: document.querySelector('.session-group.archived .session-item .s-title')?.textContent,
    archived: Boolean(document.querySelector('.session-group.archived .session-item')),
  }))
  console.log('[ui] history:', JSON.stringify(history))
  if (!history.archived || history.title !== '回归测试会话') fail('archived/renamed session not shown correctly')
  await panel.evaluate(() => document.querySelector('#scrim').click())

  const finalState = await panel.evaluate(() => {
    const chat = document.querySelector('#chat')
    return {
      overflowX: chat.scrollWidth - chat.clientWidth,
      runningRows: [...document.querySelectorAll('.tool.running')].length,
      width: document.body.clientWidth,
      scrollGap: chat.scrollHeight - chat.scrollTop - chat.clientHeight,
    }
  })
  console.log('[ui] layout:', JSON.stringify(finalState))
  if (finalState.overflowX > 2) fail(`chat overflows horizontally by ${finalState.overflowX}px`)
  if (finalState.runningRows > 0) fail(`${finalState.runningRows} tool rows never finished (duplicate bus/agent ids?)`)
  if (finalState.scrollGap > 4) fail(`chat did not follow the newest message (gap ${finalState.scrollGap}px)`)

  await panel.bringToFront()
  await panel.screenshot({ path: join(ROOT, '.runtime-ui', 'sidepanel.png') })
  await testPage.bringToFront()
  await testPage.screenshot({ path: join(ROOT, 'test', 'test-page.png') })
  const shots = await panel.evaluate(() => [...document.querySelectorAll('.tool')].map((el) => el.innerText.replace(/\n/g, ' ')))
  console.log('[ui] tool rows:', shots.join(' | '))
  console.log('\n✓ UI test passed')
}

main()
  .catch((error) => {
    if (exitCode === 0) {
      console.error(`\n✗ ${error?.message ?? String(error)}`)
      if (bridgeLog) console.error('\n--- bridge tail ---\n' + bridgeLog.slice(-2500))
      exitCode = 1
    }
  })
  .finally(async () => { await cleanup(); process.exit(exitCode) })
