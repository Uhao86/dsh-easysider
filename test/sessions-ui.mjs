#!/usr/bin/env node
/**
 * Browser test for history operations (pin / rename / archive), with a real
 * bridge but no model call. Run: node test/sessions-ui.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { prepareTestDshHome } from './dsh-home.mjs'
import { findChromeForTesting } from '../tools/chrome-path.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(ROOT, '.runtime-sessions-ui')
const EXT = join(ROOT, 'extension')
const PORT = 8793
const BASE = `http://127.0.0.1:${PORT}`
const CHROME = findChromeForTesting()
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

rmSync(RUNTIME, { recursive: true, force: true })
const DSH_HOME = prepareTestDshHome(RUNTIME)
const bridge = spawn(process.execPath, [join(ROOT, 'server', 'bridge.mjs'), '--port', String(PORT), '--dsh-home', DSH_HOME], {
  env: { ...process.env, DSH_SIDEBAR_RUNTIME: RUNTIME },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let bridgeLog = ''
bridge.stdout.on('data', (chunk) => { bridgeLog += chunk })
bridge.stderr.on('data', (chunk) => { bridgeLog += chunk })
let context
let failed = false

function cleanup() {
  try { context?.close() } catch {}
  try { bridge.kill('SIGTERM') } catch {}
  rmSync(RUNTIME, { recursive: true, force: true })
}
function fail(message) {
  failed = true
  console.error(`\n✗ ${message}`)
  if (bridgeLog) console.error(bridgeLog.slice(-1200))
  throw new Error(message)
}
function token() { return JSON.parse(readFileSync(join(RUNTIME, 'config.json'), 'utf8')).token }
const auth = () => ({ 'content-type': 'application/json', 'x-dsh-token': token() })

async function waitBridge() {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return } catch {}
    await sleep(200)
  }
  fail('bridge did not start')
}

async function main() {
  if (!CHROME) fail('找不到 Chrome for Testing。安装 Playwright Chromium 或设置 DSH_TEST_CHROME')
  await waitBridge()
  for (const [id, title] of [['sidebar-sessions-ui-a', 'Alpha 会话'], ['sidebar-sessions-ui-b', 'Beta 会话'], ['sidebar-sessions-ui-c', 'Gamma 会话']]) {
    const response = await fetch(`${BASE}/api/sessions`, { method: 'POST', headers: auth(), body: JSON.stringify({ id, title }) })
    if (!response.ok) fail(`create ${id} failed`)
  }

  context = await chromium.launchPersistentContext(join(RUNTIME, 'chrome-profile'), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 400, height: 900 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
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
    try { extensionId = JSON.parse(text).find((item) => String(item.name ?? '').includes('DSH'))?.id ?? null } catch {}
  }
  if (!extensionId) fail('extension did not load')

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await panel.evaluate(async ({ bridgeUrl, token: value }) => {
    await chrome.storage.local.set({ settings: { bridgeUrl, token: value, model: 'deepseek-flash', includePage: true, screenshot: false, effort: 'auto' } })
  }, { bridgeUrl: BASE, token: token() })
  await panel.reload()
  await panel.waitForFunction(() => document.querySelector('#connBar')?.hidden === true, undefined, { timeout: 15000 })

  await panel.evaluate(() => document.querySelector('#btnHistory').click())
  await panel.waitForSelector('.session-item[data-session="sidebar-sessions-ui-a"]', { timeout: 5000 })

  // Pin Alpha.
  await panel.evaluate(() => document.querySelector('.session-item[data-session="sidebar-sessions-ui-a"] [data-action="pin"]').click())
  await panel.waitForFunction(() => document.querySelector('.session-item[data-session="sidebar-sessions-ui-a"]')?.classList.contains('pinned'), undefined, { timeout: 5000 })
  const first = await panel.evaluate(() => document.querySelector('.session-item')?.dataset.session)
  if (first !== 'sidebar-sessions-ui-a') fail(`pinned session is not first: ${first}`)
  console.log('[history] pin ok')

  // Rename Beta.
  await panel.evaluate(() => document.querySelector('.session-item[data-session="sidebar-sessions-ui-b"] [data-action="rename"]').click())
  await panel.waitForSelector('.session-rename', { timeout: 5000 })
  await panel.evaluate(() => {
    const input = document.querySelector('.session-rename')
    input.value = 'Beta 已改名'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await panel.waitForFunction(() => document.querySelector('.session-item[data-session="sidebar-sessions-ui-b"] .s-title')?.textContent === 'Beta 已改名', undefined, { timeout: 5000 })
  console.log('[history] rename ok')

  // Archive Gamma, then show archived.
  await panel.evaluate(() => document.querySelector('.session-item[data-session="sidebar-sessions-ui-c"] [data-action="archive"]').click())
  await panel.waitForSelector('.session-toggle', { timeout: 5000 })
  await panel.evaluate(() => document.querySelector('.session-toggle').click())
  await panel.waitForSelector('.session-group.archived .session-item[data-session="sidebar-sessions-ui-c"]', { timeout: 5000 })
  console.log('[history] archive ok')

  const list = await (await fetch(`${BASE}/api/sessions`, { headers: auth() })).json()
  const a = list.sessions.find((session) => session.id === 'sidebar-sessions-ui-a')
  const b = list.sessions.find((session) => session.id === 'sidebar-sessions-ui-b')
  const c = list.sessions.find((session) => session.id === 'sidebar-sessions-ui-c')
  if (!a?.pinned) fail('pin not persisted on the bridge')
  if (b?.title !== 'Beta 已改名' || b?.customTitle !== true) fail('rename not persisted on the bridge')
  if (c?.archived !== true) fail('archive not persisted on the bridge')

  await panel.screenshot({ path: join(ROOT, 'test', 'sessions.png') })
  console.log('[history] screenshot -> test/sessions.png')
  console.log('✓ history UI test passed')
}

main()
  .catch((error) => { if (!failed) console.error(error?.stack ?? error); process.exitCode = 1 })
  .finally(async () => { try { await context?.close() } catch {}; cleanup(); process.exit(process.exitCode ?? 0) })
