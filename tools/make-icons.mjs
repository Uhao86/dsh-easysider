#!/usr/bin/env node
/**
 * Render tools/whale-icon.html into the extension's PNG icon set.
 *
 * The whale art is a source HTML/SVG file so it can be edited directly; a
 * headless Chrome rasterizes it at 512px and macOS `sips` downsizes the result.
 * On other platforms, install ImageMagick and replace the resize step.
 *
 * Usage: node tools/make-icons.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAnyChrome } from './chrome-path.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'extension', 'icons')
const GIRL_HTML = join(ROOT, 'tools', 'whale-girl-icon.html')
const GIRL_IMAGE = join(ROOT, 'tools', 'whale-girl.webp')
const ANIMAL_HTML = join(ROOT, 'tools', 'whale-icon.html')
const MASTER = join(tmpdir(), 'dsh-whale-icon-512.png')
const MAX_SOURCE_BYTES = 1_500_000

// Prefer the DeepSeek whale-girl persona; fall back to the blue animal if the
// source image is missing or unusually large for an extension icon.
const girlAvailable = existsSync(GIRL_HTML) && existsSync(GIRL_IMAGE) && statSync(GIRL_IMAGE).size <= MAX_SOURCE_BYTES
const SOURCE = girlAvailable ? GIRL_HTML : ANIMAL_HTML
console.log(girlAvailable ? '[icons] using whale-girl anthropomorphic icon' : '[icons] using blue whale animal icon')

const chrome = findAnyChrome()
if (!chrome) {
  console.error('找不到 Chrome。设置 DSH_TEST_CHROME，或安装 Chrome / Chrome for Testing。')
  process.exit(1)
}
if (!existsSync(SOURCE)) {
  console.error(`缺少图标源文件：${SOURCE}`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
rmSync(MASTER, { force: true })

const render = spawnSync(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=512,512',
  '--default-background-color=00000000',
  `--screenshot=${MASTER}`,
  `file://${SOURCE}`,
], { stdio: 'inherit' })

if (render.status !== 0 || !existsSync(MASTER)) {
  console.error('Chrome 截图失败')
  process.exit(1)
}
console.log(`master 512px: ${statSync(MASTER).size} bytes`)

for (const size of [128, 48, 32, 16]) {
  const target = join(OUT, `icon${size}.png`)
  const resize = spawnSync('/usr/bin/sips', ['-z', String(size), String(size), MASTER, '--out', target], { stdio: 'ignore' })
  if (resize.status !== 0) {
    console.error(`sips 缩放 ${size}px 失败（非 macOS 请改用 ImageMagick）`)
    process.exit(1)
  }
  console.log(`icons/icon${size}.png  ${statSync(target).size} bytes`)
}

rmSync(MASTER, { force: true })
