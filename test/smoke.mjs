#!/usr/bin/env node
/**
 * End-to-end smoke test for the bridge + MCP + DSH wiring, without Chrome.
 *
 * It starts the bridge on a throwaway port with an isolated .runtime-test dir,
 * connects a fake "extension" over SSE, and asks the real agent to call
 * browser_status. The fake client answers the tool call with canned tab data.
 * Passing means: dsh sdk booted, MCP handshake worked, the tool call crossed
 * the bridge, and the model's final answer streamed back.
 *
 * Costs one small model turn. Run: node test/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareTestDshHome } from './dsh-home.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(ROOT, '.runtime-test')
const PORT = 8791
const BASE = `http://127.0.0.1:${PORT}`

rmSync(RUNTIME, { recursive: true, force: true })
const DSH_HOME = prepareTestDshHome(RUNTIME)

const bridge = spawn(process.execPath, [join(ROOT, 'server', 'bridge.mjs'), '--port', String(PORT), '--dsh-home', DSH_HOME], {
  env: { ...process.env, DSH_SIDEBAR_RUNTIME: RUNTIME },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let bridgeLog = ''
bridge.stdout.on('data', (chunk) => { bridgeLog += chunk; process.stdout.write(`[bridge] ${chunk}`) })
bridge.stderr.on('data', (chunk) => { bridgeLog += chunk; process.stderr.write(`[bridge:err] ${chunk}`) })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (message) => { console.error(`\n✗ ${message}`); cleanup(); process.exit(1) }

let finished = false
function cleanup() {
  if (finished) return
  finished = true
  try { bridge.kill('SIGTERM') } catch {}
  rmSync(RUNTIME, { recursive: true, force: true })
}

async function waitHealth(timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(250)
  }
  throw new Error('bridge did not become healthy')
}

function readToken() {
  const file = join(RUNTIME, 'config.json')
  if (!existsSync(file)) throw new Error('missing config.json')
  return JSON.parse(readFileSync(file, 'utf8')).token
}

let token = ''
let sawToolCall = false
let sawFinal = false
let sawChunk = false
let finalAnswer = ''
let error = ''

async function handleEvent(event) {
  if (event.type === 'hello') {
    console.log(`[test] hello model=${event.model}`)
    return
  }
  if (event.type === 'tool.call') {
    sawToolCall = true
    console.log(`[test] tool.call ${event.name} ${JSON.stringify(event.args)}`)
    const canned = event.name === 'browser_status'
      ? '活动标签页：#1 「Example Domain」 https://example.com/\n\n打开中的标签页（2）：\n● #1 「Example Domain」 https://example.com/\n- #2 「Docs」 https://example.com/docs'
      : '（测试替身）操作已完成。'
    const response = await fetch(`${BASE}/api/tool-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-token': token },
      body: JSON.stringify({ callId: event.callId, ok: true, result: { text: canned } }),
    })
    if (!response.ok) console.error('[test] tool-result failed', response.status)
    return
  }
  if (event.type === 'tool' && event.phase === 'call') {
    console.log(`[test] session tool: ${event.name}`)
    return
  }
  if (event.type === 'chunk') {
    sawChunk = true
    finalAnswer += event.text
    return
  }
  if (event.type === 'final') {
    sawFinal = true
    console.log(`[test] final reason=${event.reason}${event.message ? ` message=${event.message}` : ''}`)
    return
  }
  if (event.type === 'error') {
    error = event.message
    console.error('[test] bridge error:', event.message)
  }
}

async function readSse(controller) {
  const response = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(token)}&clientId=smoke`, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  })
  if (!response.ok) throw new Error(`SSE HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const data = frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('')
      if (!data) continue
      try { await handleEvent(JSON.parse(data)) } catch (parseError) { console.error('[test] bad frame', parseError.message) }
    }
  }
}

async function main() {
  const health = await waitHealth()
  console.log(`[test] bridge healthy: ${JSON.stringify(health)}`)
  token = readToken()

  const unauthorized = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  if (unauthorized.status !== 401) fail(`expected 401 without token, got ${unauthorized.status}`)
  console.log('[test] token enforcement ok')

  const controller = new AbortController()
  const ssePromise = readSse(controller).catch((sseError) => { if (sseError.name !== 'AbortError') console.error('[test] sse ended:', sseError.message) })

  await sleep(300)
  const sessionId = `sidebar-smoke-${Date.now()}`
  const started = Date.now()
  const chatResponse = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-token': token },
    body: JSON.stringify({
      clientId: 'smoke',
      sessionId,
      text: '请务必先调用 browser_status 工具查看浏览器标签页，然后用一句话告诉我：一共打开了几个标签页？活动标签页是什么？',
      context: { url: 'https://example.com/', title: 'Example Domain' },
    }),
  })
  const chatBody = await chatResponse.json()
  if (!chatResponse.ok || !chatBody.ok) fail(`chat failed: ${JSON.stringify(chatBody)}`)
  console.log(`[test] prompt accepted (${chatBody.messageId ?? 'no messageId'})`)

  while (!sawFinal && Date.now() - started < 150000) await sleep(500)
  controller.abort()
  await ssePromise

  if (error) fail(`bridge reported: ${error}`)
  if (!sawFinal) fail('no final event within 150s')
  if (!sawToolCall) fail('the agent never called a browser_* tool (MCP bridge broken?)')
  if (!sawChunk) fail('no assistant text streamed back')
  console.log('\n[test] final answer:\n' + finalAnswer.trim() + '\n')
  console.log('✓ smoke test passed')
  cleanup()
  process.exit(0)
}

main().catch((mainError) => {
  console.error('\n[test] fatal:', mainError)
  cleanup()
  process.exit(1)
})

process.on('SIGINT', () => { cleanup(); process.exit(1) })
process.on('exit', cleanup)
