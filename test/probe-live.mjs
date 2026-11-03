#!/usr/bin/env node
/**
 * Probe an already-running bridge (the real one on 8787 by default) with a
 * tiny model turn. Useful after `./start` to confirm the shared ~/.dsh
 * credentials, model, and session writes work before involving Chrome.
 *
 * Run: node test/probe-live.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(ROOT, '.runtime', 'config.json'), 'utf8'))
const BASE = `http://127.0.0.1:${config.port}`
const TOKEN = config.token
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prompt = process.env.PROBE_PROMPT || '用一句话回答：1+1 等于几？不要调用任何工具。'

const health = await (await fetch(`${BASE}/api/health`)).json()
console.log('[live] health:', JSON.stringify(health))

const controller = new AbortController()
const sessionId = `sidebar-probe-${Date.now()}`
let final = null
let text = ''
let error = ''

const sse = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(TOKEN)}&clientId=probe-${Date.now()}`, {
  signal: controller.signal,
  headers: { accept: 'text/event-stream' },
})
if (!sse.ok) throw new Error(`SSE HTTP ${sse.status}`)
const reader = sse.body.getReader()
const decoder = new TextDecoder()
let buffer = ''

const reading = (async () => {
  try {
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
        const event = JSON.parse(data)
        if (event.type === 'chunk') text += event.text
        if (event.type === 'final') final = event
        if (event.type === 'error') error = event.message
        if (event.type === 'tool' && event.phase === 'call') {
          console.log(`[live] tool ${event.name} ${JSON.stringify(event.args).slice(0, 300)}`)
        }
      }
    }
  } catch (readError) {
    if (readError.name !== 'AbortError') console.error('[live] stream:', readError.message)
  }
})()

await sleep(250)
const receipt = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dsh-token': TOKEN },
  body: JSON.stringify({
    clientId: 'probe',
    sessionId,
    text: prompt,
  }),
})
const body = await receipt.json()
console.log('[live] chat:', JSON.stringify(body))
if (!receipt.ok) throw new Error(body.error || 'chat failed')

const started = Date.now()
while (!final && Date.now() - started < 90000) await sleep(300)
controller.abort()
await reading

if (error) throw new Error(error)
if (!final) throw new Error('no final event')
console.log(`[live] final: ${final.reason}`)
console.log(`[live] answer: ${text.trim()}`)
if (!text.trim()) throw new Error('empty answer')
console.log('✓ live probe passed')
