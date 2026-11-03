/**
 * Locate a Chrome for Testing binary for the browser tests and icon renderer.
 *
 * Playwright's browser cache is searched newest-revision first; set
 * DSH_TEST_CHROME to point at any Chromium/Chrome binary explicitly.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAC_APP = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const RELATIVE = [
  `chrome-mac-arm64/${MAC_APP}`,
  `chrome-mac-x64/${MAC_APP}`,
  'chrome-linux/chrome',
  'chrome-win/chrome.exe',
]

function newestRevision(cacheDir) {
  if (!existsSync(cacheDir)) return []
  try {
    return readdirSync(cacheDir)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  } catch {
    return []
  }
}

export function findChromeForTesting() {
  if (process.env.DSH_TEST_CHROME && existsSync(process.env.DSH_TEST_CHROME)) return process.env.DSH_TEST_CHROME

  const caches = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
  ]
  for (const cache of caches) {
    for (const revision of newestRevision(cache)) {
      for (const relative of RELATIVE) {
        const candidate = join(cache, revision, relative)
        if (existsSync(candidate)) return candidate
      }
    }
  }

  // Standalone installations sometimes live in /Applications.
  for (const candidate of [
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Branded Chrome can render local HTML (icons) but cannot load unpacked extensions. */
export function findAnyChrome() {
  return findChromeForTesting()
    ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
      .find((candidate) => existsSync(candidate))
    ?? null
}
