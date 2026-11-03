#!/usr/bin/env node
/**
 * Session history API test: create, rename, pin, archive and sort — no model
 * call and no DSH runtime needed.
 *
 * Run: node test/sessions.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareTestDshHome } from './dsh-home.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(ROOT, '.runtime-sessions-test')
const PORT = 8792
const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

rmSync(RUNTIME, { recursive: true, force: true })
const DSH_HOME = prepareTestDshHome(RUNTIME)
const bridge = spawn(process.execPath, [join(ROOT, 'server', 'bridge.mjs'), '--port', String(PORT), '--dsh-home', DSH_HOME], {
  env: { ...process.env, DSH_SIDEBAR_RUNTIME: RUNTIME },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
bridge.stdout.on('data', (chunk) => { log += chunk })
bridge.stderr.on('data', (chunk) => { log += chunk })

function cleanup() {
  try { bridge.kill('SIGTERM') } catch {}
  rmSync(RUNTIME, { recursive: true, force: true })
}
function fail(message) {
  console.error(`\n✗ ${message}`)
  console.error(log.slice(-1500))
  cleanup()
  process.exit(1)
}

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return } catch {}
    await sleep(200)
  }
  fail('bridge did not start')
}

const token = () => JSON.parse(readFileSync(join(RUNTIME, 'config.json'), 'utf8')).token
const authHeaders = () => ({ 'content-type': 'application/json', 'x-dsh-token': token() })

async function post(path, body, withAuth = true) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: withAuth ? authHeaders() : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

async function main() {
  await waitHealth()
  console.log('[sessions] bridge ready')

  const unauthorized = await post('/api/sessions', { id: 'x' }, false)
  if (unauthorized.status !== 401) fail(`expected 401, got ${unauthorized.status}`)
  console.log('[sessions] auth enforced')

  for (const id of ['sidebar-sessions-test-a', 'sidebar-sessions-test-b', 'sidebar-sessions-test-c']) {
    const created = await post('/api/sessions', { id, title: '新对话' })
    if (!created.body.ok) fail(`create ${id} failed: ${JSON.stringify(created.body)}`)
  }
  console.log('[sessions] created 3')

  const renamed = await post('/api/sessions/update', { id: 'sidebar-sessions-test-a', title: '  改过的   标题  ' })
  if (!renamed.body.ok || renamed.body.session.title !== '改过的 标题') fail(`rename failed: ${JSON.stringify(renamed.body)}`)

  const pinned = await post('/api/sessions/update', { id: 'sidebar-sessions-test-b', pinned: true })
  if (!pinned.body.ok || pinned.body.session.pinned !== true) fail('pin failed')

  const archived = await post('/api/sessions/update', { id: 'sidebar-sessions-test-c', archived: true })
  if (!archived.body.ok || archived.body.session.archived !== true) fail('archive failed')

  const missing = await post('/api/sessions/update', { id: 'sidebar-nope', pinned: true })
  if (missing.status !== 404) fail(`expected 404 for unknown session, got ${missing.status}`)

  const list = await (await fetch(`${BASE}/api/sessions`, { headers: authHeaders() })).json()
  const sessions = list.sessions || []
  const a = sessions.find((session) => session.id === 'sidebar-sessions-test-a')
  const b = sessions.find((session) => session.id === 'sidebar-sessions-test-b')
  const c = sessions.find((session) => session.id === 'sidebar-sessions-test-c')
  if (!a || a.title !== '改过的 标题' || a.customTitle !== true) fail('renamed title not persisted')
  if (!b || b.pinned !== true) fail('pin not persisted')
  if (!c || c.archived !== true) fail('archive not persisted')
  if (sessions[0].id !== 'sidebar-sessions-test-b') fail(`pinned session is not first: ${sessions.map((s) => s.id).join(',')}`)
  if (sessions.at(-1).id !== 'sidebar-sessions-test-c') fail('archived session is not last')
  console.log('[sessions] rename / pin / archive / sort ok')

  const unarchived = await post('/api/sessions/update', { id: 'sidebar-sessions-test-c', archived: false })
  if (!unarchived.body.ok || unarchived.body.session.archived !== false) fail('unarchive failed')
  console.log('[sessions] unarchive ok')

  console.log('✓ session API test passed')
  cleanup()
  process.exit(0)
}

main().catch((error) => fail(error?.message ?? String(error)))
process.on('SIGINT', () => { cleanup(); process.exit(1) })
