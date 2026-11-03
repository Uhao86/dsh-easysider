#!/usr/bin/env node
/**
 * Remove one-off/test sessions created while developing the side panel.
 * Real conversations (for example `sidebar-<uuid>` started by a person) are
 * left untouched. Dry-run by default; pass --apply to delete.
 *
 * Usage:
 *   node tools/clean-test-sessions.mjs            # show what would go
 *   node tools/clean-test-sessions.mjs --apply    # delete
 *   node tools/clean-test-sessions.mjs --home ~/.dsh --apply
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const APPLY = process.argv.includes('--apply')
const argHome = process.argv.indexOf('--home')
const argRuntime = process.argv.indexOf('--runtime')
const RUNTIME = resolve(argRuntime >= 0 ? process.argv[argRuntime + 1] : join(ROOT, '.runtime'))

const HOMES = []
const addHome = (path) => { if (path && existsSync(path) && !HOMES.includes(resolve(path))) HOMES.push(resolve(path)) }
if (argHome >= 0) addHome(process.argv[argHome + 1])
else addHome(join(homedir(), '.dsh'))

const ID_PATTERNS = [
  /^sidebar-probe-/,
  /^sidebar-smoke-/,
  /^sidebar-test-/,
  /^sidebar-sessions-test-/,
  /^sidebar-sessions-ui-/,
]
const TEST_CWD = /\.runtime-(test|ui|render|sessions-test|sessions-ui)-cwd/
const TEST_RUNTIME_DIRS = [
  '.runtime-test',
  '.runtime-ui',
  '.runtime-render',
  '.runtime-sessions-test',
  '.runtime-sessions-ui',
]

const isTestId = (name) => ID_PATTERNS.some((pattern) => pattern.test(name))
const isInside = (path, parent) => {
  const child = resolve(path)
  const base = resolve(parent)
  return child === base || child.startsWith(base + sep)
}

function listDirs(dir, depth = 0, out = []) {
  if (depth > 6) return out
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name)
    out.push({ path, name: entry.name, parent: dir })
    listDirs(path, depth + 1, out)
  }
  return out
}

function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += dirSize(path)
      else total += statSync(path).size
    } catch { /* ignore */ }
  }
  return total
}

const candidates = new Map()
const removedIds = new Set()
for (const home of HOMES) {
  const sessionsRoot = join(home, 'sessions')
  if (!existsSync(sessionsRoot)) continue
  for (const entry of listDirs(sessionsRoot)) {
    if (!entry.name.startsWith('sidebar-')) continue
    const testCwd = TEST_CWD.test(entry.parent) || TEST_CWD.test(entry.path)
    if (!isTestId(entry.name) && !testCwd) continue
    if (!isInside(entry.path, sessionsRoot)) continue
    candidates.set(entry.path, { kind: 'session-dir', home, path: entry.path, name: entry.name })
    removedIds.add(entry.name)
  }
}

// Projection caches are keyed by session id; remove the ones that belonged to
// the sessions above, plus any id that still matches a test pattern.
const cacheFiles = []
for (const home of HOMES) {
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  if (!existsSync(cacheDir)) continue
  let entries
  try { entries = readdirSync(cacheDir, { withFileTypes: true }) } catch { continue }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const id = entry.name.slice(0, -5)
    if (!isTestId(id) && !removedIds.has(id)) continue
    const path = join(cacheDir, entry.name)
    if (!isInside(path, cacheDir)) continue
    cacheFiles.push({ kind: 'proj-cache', path })
  }
}
for (const entry of cacheFiles) candidates.set(entry.path, entry)

for (const name of TEST_RUNTIME_DIRS) {
  const path = join(ROOT, name)
  if (existsSync(path) && isInside(path, ROOT)) candidates.set(path, { kind: 'test-runtime', path })
}

console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
console.log(`DSH homes: ${HOMES.join(', ') || '(none)'}`)
console.log(`runtime:   ${RUNTIME}`)

let bytes = 0
for (const candidate of candidates.values()) {
  try {
    const size = candidate.kind === 'proj-cache' ? statSync(candidate.path).size : dirSize(candidate.path)
    bytes += size
    console.log(`${APPLY ? 'delete' : 'would delete'}  ${candidate.kind.padEnd(13)} ${candidate.path}  (${(size / 1024).toFixed(1)} KiB)`)
  } catch (error) {
    console.log(`skip    ${candidate.path}: ${error.message}`)
  }
}

// Clean the sidebar's title index without touching real conversations.
const sessionsFile = join(RUNTIME, 'sessions.json')
let indexRemoved = []
if (existsSync(sessionsFile)) {
  try {
    const parsed = JSON.parse(readFileSync(sessionsFile, 'utf8'))
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    const kept = sessions.filter((session) => {
      if (isTestId(String(session.id ?? ''))) { indexRemoved.push(session.id); return false }
      return true
    })
    if (indexRemoved.length) {
      console.log(`${APPLY ? 'update' : 'would update'}  ${sessionsFile}  (-${indexRemoved.length} test entries; ${kept.length} kept)`)
      if (APPLY) writeFileSync(sessionsFile, JSON.stringify({ sessions: kept }, null, 2) + '\n')
    }
  } catch (error) {
    console.log(`skip    ${sessionsFile}: ${error.message}`)
  }
}

console.log(`\n${candidates.size} path(s)${bytes ? `, ${(bytes / 1024).toFixed(1)} KiB` : ''}; ${indexRemoved.length} title-index entr${indexRemoved.length === 1 ? 'y' : 'ies'}.`)
if (!APPLY) console.log('Nothing changed. Re-run with --apply to delete.')
else {
  for (const candidate of candidates.values()) {
    try { rmSync(candidate.path, { recursive: true, force: true }) } catch (error) { console.error(`failed ${candidate.path}: ${error.message}`) }
  }
  console.log('Done. Kept real `sidebar-<uuid>` conversations.')
}
