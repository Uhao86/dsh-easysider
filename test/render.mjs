#!/usr/bin/env node
/**
 * Renderer-only test: loads the extension in Chrome for Testing, renders a
 * representative intelligent-UI tree into the side panel, checks the DOM and
 * writes a clean screenshot. No model call, no bridge required.
 *
 * Run: node test/render.mjs
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { findChromeForTesting } from '../tools/chrome-path.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXT = join(ROOT, 'extension')
const PROFILE = join(ROOT, '.runtime-render', 'chrome-profile')
const CHROME = findChromeForTesting()

rmSync(join(ROOT, '.runtime-render'), { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })
if (!CHROME) {
  console.error('找不到 Chrome for Testing。安装 Playwright Chromium 或设置 DSH_TEST_CHROME。')
  process.exit(1)
}

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 400, height: 900 },
  deviceScaleFactor: 2,
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
  try {
    const entry = JSON.parse(text).find((item) => String(item.name ?? '').includes('DSH'))
    extensionId = entry?.id ?? null
  } catch { /* ignore */ }
}
if (!extensionId) throw new Error('extension did not load')

const panel = await context.newPage()
await panel.setViewportSize({ width: 400, height: 900 })
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
await panel.waitForFunction(() => Boolean(window.DSHUI && window.DSHMarkdown))

const result = await panel.evaluate(() => {
  document.querySelector('#chat').innerHTML = ''
  const tree = {
    title: '4 月运营概览',
    root: 'card',
    components: [
      { id: 'card', type: 'Card', props: { title: '4 月运营概览', subtitle: '对比 3 月', footer: '数据为示例值' }, children: ['stack'] },
      { id: 'stack', type: 'Stack', props: { gap: 8 }, children: ['stats', 'chart', 'table', 'timeline', 'note'] },
      { id: 'stats', type: 'Grid', props: { columns: 2 }, children: ['s1', 's2', 's3', 's4'] },
      { id: 's1', type: 'Stat', props: { label: '访问量', value: '128,430', delta: '+12.4%', trend: 'up' } },
      { id: 's2', type: 'Stat', props: { label: '转化率', value: '3.82%', delta: '+0.6pp', trend: 'up' } },
      { id: 's3', type: 'Stat', props: { label: '平均时长', value: '4m 32s', delta: '-18s', trend: 'down' } },
      { id: 's4', type: 'Stat', props: { label: '跳出率', value: '41%', delta: '-2.1pp', trend: 'up' } },
      { id: 'chart', type: 'Chart', props: { kind: 'line', title: '近 6 个月访问量', labels: ['11月', '12月', '1月', '2月', '3月', '4月'], series: [{ name: '访问量', values: [42, 55, 61, 58, 74, 98] }, { name: '转化', values: [18, 21, 24, 22, 29, 36] }], height: 170, unit: '千次' } },
      { id: 'table', type: 'Table', props: { columns: ['渠道', '访问', '转化率'], rows: [['自然搜索', 52000, '4.1%'], ['直接访问', 31000, '3.2%'], ['社交媒体', 24000, '3.6%'], ['邮件', 21000, '5.4%']], sortable: true, searchable: true, pageSize: 4, exportable: true } },
      { id: 'timeline', type: 'Timeline', props: { items: [{ title: '活动上线', time: '4/02', text: '春季活动页发布', tone: 'success' }, { title: '渠道调整', time: '4/12', text: '邮件渠道预算 +20%', tone: 'info' }, { title: '待处理', time: '4/28', text: '复盘报告', tone: 'warning' }] } },
      { id: 'note', type: 'Alert', props: { title: '提示', text: '这是一份示例仪表盘，数据用于展示渲染能力。', tone: 'info' } },
    ],
  }
  const host = document.createElement('div')
  host.appendChild(window.DSHUI.renderCatalog(tree, { send() {}, toast() {} }))
  document.querySelector('#chat').appendChild(host)
  return {
    cards: host.querySelectorAll('.ui-card').length,
    stats: host.querySelectorAll('.ui-stat').length,
    charts: host.querySelectorAll('.ui-chart-svg').length,
    rows: host.querySelectorAll('.ui-table tbody tr').length,
    timeline: host.querySelectorAll('.ui-timeline-item').length,
  }
})
console.log('[render] catalog:', JSON.stringify(result))
if (result.stats !== 4 || result.charts !== 1 || result.rows !== 4) throw new Error('catalog render incomplete')

const compose = await panel.evaluate(() => {
  const host = document.createElement('div')
  host.appendChild(window.DSHUI.renderCompose([
    { id: 'm1', type: 'markdown', text: '## 一段说明\n\n**重点**在下面。' },
    { id: 'c1', type: 'catalog', root: 'card', components: [{ id: 'card', type: 'Card', props: { title: '组合块' }, children: ['t'] }, { id: 't', type: 'Text', props: { text: '卡片里的文字' } }] },
    { id: 'm2', type: 'markdown', text: '- 结论一\n- 结论二' },
  ], { send() {}, toast() {} }))
  document.querySelector('#chat').appendChild(host)
  return { markdown: host.querySelectorAll('.part-text').length, cards: host.querySelectorAll('.ui-card').length }
})
console.log('[render] compose:', JSON.stringify(compose))
if (compose.markdown !== 2 || compose.cards !== 1) throw new Error('compose render incomplete')

await panel.evaluate(() => {
  const bar = document.querySelector('#connBar')
  if (bar) bar.hidden = true
  document.querySelector('#pageTitle').textContent = '示例页面 · 运营数据'
  document.querySelector('#pageUrl').textContent = 'https://example.com/dashboard'
  document.querySelector('#pageFavicon').textContent = 'E'
})
await panel.screenshot({ path: join(ROOT, 'test', 'ui-sample.png') })
console.log('[render] screenshot -> test/ui-sample.png')
await context.close()
rmSync(join(ROOT, '.runtime-render'), { recursive: true, force: true })
console.log('✓ renderer test passed')
