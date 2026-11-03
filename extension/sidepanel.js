/**
 * DSH side panel (dsh web profile).
 *
 * Owns the bridge connection (SSE + POST), the conversation UI, and the
 * browser tool executor. The bridge routes MCP tool calls from the DSH agent
 * here; `executeTool` performs them with chrome.tabs / chrome.scripting.
 */
'use strict'

const { escapeHtml, inlineMarkdown, renderMarkdown } = window.DSHMarkdown
const $ = (selector) => document.querySelector(selector)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const uid = () => Math.random().toString(36).slice(2, 10)

const DEFAULTS = {
  bridgeUrl: 'http://127.0.0.1:8787',
  token: '',
  model: 'deepseek-flash',
  includePage: true,
  screenshot: false,
  effort: 'auto',
}

const state = {
  settings: { ...DEFAULTS },
  sessionId: '',
  clientId: `c_${uid()}`,
  messages: [],
  sessions: [],
  tab: null,
  es: null,
  connected: false,
  busy: false,
  liveAssistantId: null,
  showArchived: false,
  searchFailures: 0,
  lastCapture: null,
}

const TOOL_META = {
  browser_status: { label: '查看标签页', icon: 'i-globe' },
  browser_read: { label: '读取页面', icon: 'i-page' },
  browser_snapshot: { label: '扫描交互元素', icon: 'i-page' },
  browser_open: { label: '打开网页', icon: 'i-globe' },
  browser_click: { label: '点击', icon: 'i-chevron' },
  browser_type: { label: '输入', icon: 'i-chevron' },
  browser_scroll: { label: '滚动', icon: 'i-chevron' },
  browser_find: { label: '页内查找', icon: 'i-globe' },
  browser_screenshot: { label: '截图', icon: 'i-camera' },
  browser_history: { label: '浏览历史', icon: 'i-history' },
  browser_highlight: { label: '高亮', icon: 'i-spark' },
  browser_wait: { label: '等待页面', icon: 'i-spinner' },
  web_search: { label: '联网搜索', icon: 'i-globe' },
  web_fetch: { label: '抓取网页', icon: 'i-globe' },
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
function debounce(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

function baseUrl() {
  return (state.settings.bridgeUrl || DEFAULTS.bridgeUrl).replace(/\/+$/, '')
}

function headers() {
  return { 'content-type': 'application/json', 'x-dsh-token': state.settings.token }
}

function toast(message, ms = 2200) {
  const el = $('#toast')
  el.textContent = message
  el.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { el.hidden = true }, ms)
}

function formatTime(ts) {
  const date = new Date(ts)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */
let stickToBottom = true

function isNearBottom() {
  const chat = $('#chat')
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120
}

function renderAll({ keepScroll = false } = {}) {
  const chat = $('#chat')
  const stick = keepScroll ? stickToBottom : true
  const scrollTop = chat.scrollTop
  chat.innerHTML = ''

  if (!state.messages.length) {
    chat.appendChild(renderEmpty())
  } else {
    for (const message of state.messages) chat.appendChild(renderMessage(message))
  }

  if (stick) { chat.scrollTop = chat.scrollHeight; stickToBottom = true }
  else chat.scrollTop = scrollTop

  $('#btnSend').disabled = !$('#input').value.trim() || state.busy
  $('#btnStop').hidden = !state.busy
  $('#btnStop').style.display = state.busy ? 'grid' : 'none'
  const effort = $('#effort')
  if (effort) {
    effort.disabled = state.busy
    effort.closest('.effort')?.classList.toggle('busy', state.busy)
  }
}

function renderEmpty() {
  const wrap = document.createElement('div')
  wrap.className = 'empty'
  wrap.innerHTML = `
    <div class="empty-logo"><img src="icons/icon128.png" alt=""></div>
    <h1>让这个页面说人话</h1>
    <p>我可以读这页、回答问题，也能替你点击、填写和跳转。</p>
    <div class="empty-actions">
      ${['总结这个页面', '解释我选中的内容', '这页上我能做什么？', '把要点列成清单'].map((text) => `<button class="suggest" data-suggest="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join('')}
    </div>
    ${state.settings.token ? '' : onboardingHtml()}
  `
  wrap.querySelectorAll('[data-suggest]').forEach((button) => {
    button.addEventListener('click', () => { $('#input').value = button.dataset.suggest; autoGrow(); void send() })
  })
  const pairBtn = wrap.querySelector('#onboardPair')
  if (pairBtn) pairBtn.addEventListener('click', () => void pairBridge())
  return wrap
}

function onboardingHtml() {
  return `
    <div class="onboard">
      <h3>先连接本地 bridge（约 30 秒）</h3>
      <ol>
        <li>在 <code>sidebar/</code> 目录运行 <code>./start</code></li>
        <li>点下面的按钮自动取 token，或打开 <code>127.0.0.1:8787</code> 复制</li>
        <li>回到这里开始提问</li>
      </ol>
      <button class="btn primary" id="onboardPair">自动获取 Token</button>
    </div>
  `
}

function renderMessage(message) {
  const wrap = document.createElement('div')
  wrap.className = `msg ${message.role}`
  wrap.dataset.id = message.id

  if (message.role === 'user') {
    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    bubble.textContent = message.text
    wrap.appendChild(bubble)
    const meta = document.createElement('div')
    meta.className = 'meta'
    const chips = []
    if (message.meta?.page) {
      const chars = Number(message.meta.chars) || 0
      chips.push(chars >= 1000 ? `页面 ${(chars / 1000).toFixed(1)}k` : `页面 ${chars} 字`)
    }
    if (message.meta?.selection) chips.push('选中')
    if (message.meta?.shot) chips.push('截图')
    meta.innerHTML = `<span>${formatTime(message.at || Date.now())}</span>${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join('')}`
    wrap.appendChild(meta)
    return wrap
  }

  const who = document.createElement('div')
  who.className = 'who'
  who.innerHTML = `<span class="mark"><svg><use href="#i-spark"/></svg></span><span>DSH Agent</span>${message.model ? `<span>·</span><span>${escapeHtml(message.model)}</span>` : ''}`
  wrap.appendChild(who)

  for (const part of message.parts || []) {
    if (part.kind === 'text') {
      const el = document.createElement('div')
      el.className = 'part-text'
      el.innerHTML = renderMarkdown(part.text)
      wrap.appendChild(el)
    } else if (part.kind === 'reasoning' && part.text?.trim()) {
      const details = document.createElement('details')
      details.className = 'part-reasoning'
      const summary = document.createElement('summary')
      summary.textContent = `思考过程 · ${part.text.trim().length} 字`
      const body = document.createElement('div')
      body.className = 'r-body'
      body.textContent = part.text
      details.append(summary, body)
      wrap.appendChild(details)
    } else if (part.kind === 'tool') {
      wrap.appendChild(renderTool(part))
    } else if (part.kind === 'ui' || part.kind === 'compose' || part.kind === 'widget') {
      wrap.appendChild(renderRichPart(part))
    }
  }

  if (message.thinking) {
    const thinking = document.createElement('div')
    thinking.className = 'thinking'
    thinking.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span>正在处理…</span>'
    wrap.appendChild(thinking)
  }

  if (message.error) {
    const error = document.createElement('div')
    error.className = 'msg-error'
    error.innerHTML = `<svg><use href="#i-alert"/></svg><span>${escapeHtml(message.error)}</span>`
    wrap.appendChild(error)
  }
  if (message.note) {
    const note = document.createElement('div')
    note.className = 'msg-note'
    note.textContent = message.note
    wrap.appendChild(note)
  }

  wrap.addEventListener('click', (event) => {
    const copy = event.target.closest('[data-copy]')
    if (copy) {
      const code = copy.parentElement.querySelector('code')?.textContent ?? ''
      navigator.clipboard.writeText(code).then(() => toast('已复制'), () => toast('复制失败'))
    }
  })
  return wrap
}

function renderRichPart(part) {
  const section = document.createElement('section')
  section.className = 'ui-rich-part'
  if (part.dropped) {
    const note = document.createElement('div')
    note.className = 'ui-empty'
    note.textContent = '这条 UI 太大，未保存在本机会话缓存里；刷新后需要让 agent 重新生成。'
    section.appendChild(note)
    return section
  }
  try {
    if (part.kind === 'ui' && part.tree) {
      section.appendChild(window.DSHUI.renderCatalog(part.tree, uiOptions()))
    } else if (part.kind === 'compose' && Array.isArray(part.blocks)) {
      section.appendChild(window.DSHUI.renderCompose(part.blocks, uiOptions()))
    } else if (part.kind === 'widget' && part.html) {
      section.appendChild(window.DSHUI.renderWidget(part, uiOptions()))
    }
  } catch (error) {
    console.warn('[dsh] ui render failed', error)
    const note = document.createElement('div')
    note.className = 'ui-empty'
    note.textContent = `UI 渲染失败：${error.message}`
    section.appendChild(note)
  }
  if (part.error) {
    const error = document.createElement('div')
    error.className = 'msg-error'
    error.innerHTML = `<svg><use href="#i-alert"/></svg><span>${escapeHtml(part.error)}</span>`
    section.appendChild(error)
  }
  return section
}

function uiOptions() {
  return {
    send: (text) => { void sendText(text) },
    sendNew: (text) => { void sendTextInNewSession(text) },
    toast,
  }
}

async function sendTextInNewSession(text) {
  await newSession()
  sendText(text)
}

function sendText(text) {
  if (state.busy) { toast('正在生成，等这一轮结束'); return }
  const input = $('#input')
  input.value = String(text ?? '')
  autoGrow()
  void send()
}

function renderTool(part) {
  const meta = TOOL_META[part.name] || { label: part.name, icon: 'i-plug' }
  const el = document.createElement('div')
  const statusClass = part.status === 'running' ? 'running' : part.status === 'error' ? 'bad' : 'ok'
  el.className = `tool ${statusClass}${part.expanded ? ' expanded' : ''}`
  el.dataset.call = part.callId || ''
  const icon = part.status === 'running' ? 'i-spinner' : part.status === 'error' ? 'i-alert' : 'i-check'
  const statusText = part.status === 'running' ? '执行中' : part.status === 'error' ? '失败' : '完成'
  el.innerHTML = `
    <span class="t-icon"><svg><use href="#${icon}"/></svg></span>
    <span class="t-name">${escapeHtml(meta.label)}</span>
    <span class="t-arg">${escapeHtml(summarizeArgs(part.name, part.args))}</span>
    <span class="t-status">${statusText}</span>
    <div class="t-detail">${escapeHtml(part.detail || (part.args ? JSON.stringify(part.args, null, 2) : ''))}</div>
  `
  el.addEventListener('click', () => {
    part.expanded = !part.expanded
    el.classList.toggle('expanded', part.expanded)
  })
  return el
}

function summarizeArgs(name, args) {
  if (!args || typeof args !== 'object') return ''
  switch (name) {
    case 'browser_open': return args.url ?? ''
    case 'browser_click': return args.ref || args.selector || args.text || ''
    case 'browser_type': return `${args.ref || args.selector || ''} ← ${String(args.text ?? '').slice(0, 30)}`
    case 'browser_find': return String(args.query ?? '')
    case 'browser_scroll': return args.ref || args.direction || ''
    case 'browser_history': return args.action ?? ''
    case 'browser_highlight': return (args.refs || []).join(', ') || args.text || ''
    case 'browser_wait': return args.selector || args.text || (args.ms ? `${args.ms}ms` : '')
    case 'browser_read':
    case 'browser_snapshot': return args.tabId ? `tab ${args.tabId}` : ''
    case 'web_search': return String(args.query ?? '')
    case 'web_fetch': return String(args.url ?? '')
    default: return ''
  }
}

function updateTool(callId, patch) {
  for (const message of state.messages) {
    const part = (message.parts || []).find((entry) => entry.kind === 'tool' && entry.callId === callId)
    if (part) { Object.assign(part, patch); return part }
  }
  return null
}

/**
 * The agent's tool-call id (session event) and the bridge's bus id (SSE
 * tool.call) are different identifiers for the same invocation. Match on
 * either, and fall back to the single running tool with the same name when the
 * two events race.
 */
function findToolPart(message, callId, name) {
  const parts = message.parts || []
  const byId = parts.find((part) => part.kind === 'tool' && (part.callId === callId || part.busCallId === callId))
  if (byId) return byId
  const running = parts.filter((part) => part.kind === 'tool' && part.status === 'running' && !part.busCallId && part.name === name)
  return running.length === 1 ? running[0] : null
}

function ensureAssistant() {
  let message = state.messages.find((entry) => entry.id === state.liveAssistantId)
  if (!message) {
    message = { id: uid(), role: 'assistant', parts: [], at: Date.now(), model: state.settings.model }
    state.messages.push(message)
    state.liveAssistantId = message.id
  }
  return message
}

function lastPart(message) {
  return message.parts[message.parts.length - 1]
}

/* ------------------------------------------------------------------ *
 * settings + storage
 * ------------------------------------------------------------------ */
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings')
  state.settings = { ...DEFAULTS, ...(settings || {}) }
  $('#setBridge').value = state.settings.bridgeUrl
  $('#setToken').value = state.settings.token
  $('#setModel').textContent = state.settings.model
  $('#footModel').textContent = state.settings.model
  $('#ctxState').textContent = ''
  $('#togglePage').classList.toggle('on', state.settings.includePage)
  $('#toggleShot').classList.toggle('on', state.settings.screenshot)
  $('#effort').value = state.settings.effort || 'auto'
}

async function persistSettings() {
  await chrome.storage.local.set({ settings: state.settings })
}

async function loadSession() {
  const stored = await chrome.storage.local.get(['sessionId'])
  state.sessionId = stored.sessionId || `sidebar-${crypto.randomUUID()}`
  const chats = await chrome.storage.local.get(`chat:${state.sessionId}`)
  state.messages = Array.isArray(chats[`chat:${state.sessionId}`]) ? chats[`chat:${state.sessionId}`] : []
  state.messages.forEach((message) => { message.parts?.forEach((part) => { if (part.kind === 'tool' && part.status === 'running') { part.status = 'error'; part.detail = '侧边栏关闭，执行结果丢失' } }) })
  await chrome.storage.local.set({ sessionId: state.sessionId })
  $('#setSession').textContent = state.sessionId
}

function messagesForStorage() {
  const clone = state.messages.slice(-60).map((message) => ({
    ...message,
    parts: (message.parts || []).map((part) => {
      if (part.kind !== 'ui' && part.kind !== 'compose' && part.kind !== 'widget') return part
      const copy = { ...part }
      if (JSON.stringify(copy).length > 80_000) {
        delete copy.tree
        delete copy.blocks
        delete copy.html
        delete copy.css
        delete copy.jsFunctions
        delete copy.jsExpressions
        copy.dropped = true
      }
      return copy
    }),
  }))
  let text = JSON.stringify(clone)
  while (text.length > 3_000_000 && clone.length > 1) {
    clone.shift()
    text = JSON.stringify(clone)
  }
  return clone
}

const persistChat = debounce(() => {
  chrome.storage.local.set({ [`chat:${state.sessionId}`]: messagesForStorage() })
}, 350)

async function newSession() {
  await chrome.storage.local.set({ sessionId: state.sessionId })
  state.sessionId = `sidebar-${crypto.randomUUID()}`
  state.messages = []
  state.liveAssistantId = null
  state.busy = false
  await chrome.storage.local.set({ sessionId: state.sessionId })
  $('#setSession').textContent = state.sessionId
  persistChat()
  renderAll()
  closeSheets()
  toast('新对话已开始')
  $('#input').focus()
  if (state.settings.token) {
    try {
      await fetch(`${baseUrl()}/api/sessions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: state.sessionId, title: '新对话' }),
      })
      void refreshSessions()
    } catch { /* bridge offline */ }
  }
}

async function switchSession(sessionId) {
  if (sessionId === state.sessionId) { closeSheets(); return }
  persistChat()
  state.sessionId = sessionId
  state.messages = []
  state.liveAssistantId = null
  state.busy = false
  await chrome.storage.local.set({ sessionId })
  const chats = await chrome.storage.local.get(`chat:${sessionId}`)
  state.messages = Array.isArray(chats[`chat:${sessionId}`]) ? chats[`chat:${sessionId}`] : []
  $('#setSession').textContent = sessionId
  renderAll()
  closeSheets()
  void refreshSessions()
}

/* ------------------------------------------------------------------ *
 * connection
 * ------------------------------------------------------------------ */
function setConn(kind, text) {
  const bar = $('#connBar')
  const dot = $('#connDot')
  if (kind === 'online') {
    state.connected = true
    bar.hidden = true
    return
  }
  state.connected = false
  bar.hidden = false
  bar.classList.toggle('bad', kind === 'error' || kind === 'unpaired')
  dot.style.background = kind === 'error' ? 'var(--red)' : kind === 'unpaired' ? 'var(--muted-2)' : 'var(--amber)'
  $('#connText').textContent = text
}

function connect() {
  if (state.es) { state.es.close(); state.es = null }
  if (!state.settings.token) { setConn('unpaired', '未连接本地 bridge'); renderAll({ keepScroll: true }); return }

  const url = `${baseUrl()}/api/stream?token=${encodeURIComponent(state.settings.token)}&clientId=${encodeURIComponent(state.clientId)}`
  let opened = false
  try {
    state.es = new EventSource(url)
  } catch (error) {
    setConn('error', `无法连接 ${baseUrl()}`)
    return
  }
  state.es.onopen = () => { opened = true; state.searchFailures = 0; setConn('online') }
  state.es.onmessage = (event) => {
    let data
    try { data = JSON.parse(event.data) } catch { return }
    handleBridgeEvent(data)
  }
  state.es.onerror = () => {
    if (opened) { setConn('retrying', '连接断开，正在重连…') }
    else { setConn('retrying', `正在连接 ${baseUrl()}…（bridge 起了吗？）`) }
    void probeToken()
  }
}

const probeToken = debounce(async () => {
  if (!state.settings.token) return
  try {
    const response = await fetch(`${baseUrl()}/api/sessions?token=${encodeURIComponent(state.settings.token)}`)
    if (response.status === 401) setConn('unpaired', 'Token 无效，请在设置里重新获取')
    else if (response.ok) setConn('retrying', 'bridge 在线，正在建立事件流…')
  } catch {
    setConn('retrying', `连不上 ${baseUrl()}，先运行 ./start`)
  }
}, 700)

async function checkHealth() {
  try {
    const response = await fetch(`${baseUrl()}/api/health`)
    if (!response.ok) return
    const health = await response.json()
    if (health.model) {
      state.settings.model = health.model
      $('#footModel').textContent = health.model
      $('#setModel').textContent = health.model
      const live = state.messages.find((message) => message.role === 'assistant' && !message.model)
      if (live) live.model = health.model
    }
    if (health.reasoningEffort) {
      state.settings.effort = health.reasoningEffort
      $('#effort').value = health.reasoningEffort
    }
  } catch { /* bridge not running yet */ }
}

async function pairBridge() {
  const base = ($('#setBridge').value || state.settings.bridgeUrl || DEFAULTS.bridgeUrl).replace(/\/+$/, '')
  try {
    const response = await fetch(`${base}/api/pair`)
    const data = await response.json()
    if (!response.ok || !data.token) throw new Error(data.error || `HTTP ${response.status}`)
    state.settings.bridgeUrl = base
    state.settings.token = data.token
    if (data.model) state.settings.model = data.model
    $('#setBridge').value = base
    $('#setToken').value = data.token
    $('#setModel').textContent = state.settings.model
    $('#footModel').textContent = state.settings.model
    await persistSettings()
    connect()
    renderAll({ keepScroll: true })
    toast('已连接 bridge')
  } catch (error) {
    toast(`获取失败：${error.message}`)
    setConn('error', `无法从 ${base} 获取 token`)
  }
}

/* ------------------------------------------------------------------ *
 * context bar
 * ------------------------------------------------------------------ */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

async function refreshContext() {
  try {
    const tab = await activeTab()
    state.tab = tab
    if (!tab) {
      $('#pageTitle').textContent = '没有活动标签页'
      $('#pageUrl').textContent = ''
      return
    }
    const host = (() => { try { return new URL(tab.url).hostname.replace(/^www\./, '') } catch { return '' } })()
    $('#pageTitle').textContent = tab.title || host || '未命名页面'
    $('#pageUrl').textContent = tab.url || ''
    $('#pageFavicon').textContent = (host || '·').slice(0, 1).toUpperCase()
    $('#pageBadge').hidden = !state.lastCapture?.selection
    const selectable = /^https?:/i.test(tab.url || '')
    $('#pageCard').style.opacity = selectable ? '1' : '.6'
  } catch (error) {
    console.warn('[dsh] refreshContext', error)
  }
}

/* ------------------------------------------------------------------ *
 * bridge events
 * ------------------------------------------------------------------ */
function handleBridgeEvent(event) {
  switch (event.type) {
    case 'hello':
      state.settings.model = event.model || state.settings.model
      $('#footModel').textContent = state.settings.model
      void checkHealth()
      break
    case 'status':
      if (event.sessionId && event.sessionId !== state.sessionId) return
      state.busy = event.status === 'running'
      if (state.busy) {
        const message = ensureAssistant()
        message.thinking = true
      }
      renderAll({ keepScroll: true })
      break
    case 'turn':
      if (event.sessionId && event.sessionId !== state.sessionId) return
      if (event.phase === 'start') {
        state.busy = true
        if (!state.liveAssistantId) {
          const last = state.messages[state.messages.length - 1]
          if (last?.role === 'assistant' && !(last.parts || []).length) {
            state.liveAssistantId = last.id
            last.thinking = true
          } else {
            ensureAssistant().thinking = true
          }
        }
        renderAll({ keepScroll: true })
      }
      break
    case 'chunk': {
      if (event.sessionId && event.sessionId !== state.sessionId) return
      const message = ensureAssistant()
      message.thinking = false
      const part = lastPart(message)
      if (part?.kind === 'text') part.text += `\n\n${event.text}`
      else message.parts.push({ kind: 'text', text: event.text })
      persistChat()
      renderAll({ keepScroll: true })
      break
    }
    case 'reasoning': {
      if (event.sessionId && event.sessionId !== state.sessionId) return
      const message = ensureAssistant()
      const existing = message.parts.find((part) => part.kind === 'reasoning')
      if (existing) existing.text = event.text
      else message.parts.push({ kind: 'reasoning', text: event.text })
      renderAll({ keepScroll: true })
      break
    }
    case 'tool': {
      if (event.sessionId && event.sessionId !== state.sessionId) return
      const message = ensureAssistant()
      message.thinking = false
      const name = event.name || ''
      const rich = name === 'ui_render' || name === 'ui_compose' || name === 'ui_render_widget'
      const patch = name === 'ui_patch'

      if (event.phase === 'call') {
        if (rich && event.args && typeof event.args === 'object') {
          const existing = (message.parts || []).find((part) => part.callId === event.callId && (part.kind === 'ui' || part.kind === 'compose' || part.kind === 'widget'))
          if (name === 'ui_render') {
            const part = existing || { kind: 'ui', callId: event.callId, uiId: event.callId, version: 1, status: 'running' }
            part.tree = event.args
            part.status = 'running'
            if (!existing) message.parts.push(part)
          } else if (name === 'ui_compose') {
            const part = existing || { kind: 'compose', callId: event.callId, status: 'running' }
            part.blocks = event.args.blocks || []
            part.title = event.args.title
            part.status = 'running'
            if (!existing) message.parts.push(part)
          } else {
            const part = existing || { kind: 'widget', callId: event.callId, status: 'running' }
            Object.assign(part, event.args)
            part.kind = 'widget'
            part.callId = event.callId
            part.status = 'running'
            if (!existing) message.parts.push(part)
          }
        } else if (!patch) {
          const existing = findToolPart(message, event.callId, event.name)
          if (!existing) {
            message.parts.push({
              kind: 'tool',
              callId: event.callId,
              name: event.name,
              args: event.args,
              status: 'running',
              detail: '',
            })
          } else {
            existing.callId = event.callId
            existing.name = event.name
            existing.args = event.args
            existing.status = 'running'
          }
        }
      } else if (event.phase === 'result') {
        if (patch) {
          const ui = event.meta?.ui
          if (ui && typeof ui === 'object' && typeof ui.uiId === 'string') {
            // The UI being patched usually lives in an earlier assistant message,
            // so search the whole conversation, not just the current bubble.
            let part = null
            for (const entry of state.messages) {
              part = (entry.parts || []).find((candidate) => candidate.kind === 'ui' && candidate.uiId === ui.uiId)
              if (part) break
            }
            if (!part) {
              part = { kind: 'ui', callId: event.callId, uiId: ui.uiId, version: ui.version ?? 1, tree: ui }
              message.parts.push(part)
            } else {
              part.tree = ui
              part.version = ui.version ?? part.version
            }
            part.status = event.isError ? 'error' : 'ok'
            if (event.isError) part.error = event.preview || 'UI 更新失败'
          }
        } else if (rich) {
          const part = (message.parts || []).find((entry) => entry.callId === event.callId && (entry.kind === 'ui' || entry.kind === 'compose' || entry.kind === 'widget'))
          if (part) {
            part.status = event.isError ? 'error' : 'ok'
            if (event.isError) part.error = event.preview || 'UI 渲染失败'
          }
        } else {
          const existing = (message.parts || []).find((part) => part.kind === 'tool' && (part.callId === event.callId || part.busCallId === event.callId))
          if (existing) {
            existing.status = event.isError ? 'error' : 'ok'
            existing.detail = event.preview || ''
          }
        }
      }
      persistChat()
      renderAll({ keepScroll: true })
      break
    }
    case 'tool.call':
      void runBrowserTool(event)
      break
    case 'final': {
      if (event.sessionId && event.sessionId !== state.sessionId) return
      state.busy = false
      const message = state.messages.find((entry) => entry.id === state.liveAssistantId)
      if (message) {
        message.thinking = false
        if (event.reason === 'error') message.error = event.message || '本轮执行失败'
        else if (event.reason === 'aborted') message.note = '已停止'
        else if (event.reason === 'max-tokens') message.note = '达到输出上限'
        const hasContent = (message.parts || []).some((part) => part.kind !== 'tool' || part.status === 'ok' || part.status === 'error')
        if (!hasContent && !message.error) state.messages = state.messages.filter((entry) => entry.id !== message.id)
      }
      state.liveAssistantId = null
      persistChat()
      renderAll({ keepScroll: true })
      void refreshContext()
      break
    }
    case 'stopped':
      state.busy = false
      for (const message of state.messages) {
        if (message.id === state.liveAssistantId) { message.thinking = false; message.note = '已停止' }
        ;(message.parts || []).forEach((part) => { if (part.kind === 'tool' && part.status === 'running') { part.status = 'error'; part.detail = '已停止' } })
      }
      state.liveAssistantId = null
      renderAll({ keepScroll: true })
      break
    case 'settings':
      state.settings.effort = event.reasoningEffort || 'auto'
      $('#effort').value = state.settings.effort
      break
    case 'sessions':
      state.sessions = event.sessions || []
      renderSessionList()
      break
    case 'error':
      toast(event.message || 'bridge 报错')
      break
    default:
      break
  }
}

/* ------------------------------------------------------------------ *
 * sending
 * ------------------------------------------------------------------ */
function autoGrow() {
  const input = $('#input')
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`
}

async function capturePageContext() {
  const tab = await activeTab()
  if (!tab) return null
  const context = { url: tab.url, title: tab.title, selection: '', pageText: '' }
  if (!/^https?:/i.test(tab.url || '')) return context
  try {
    await ensureInjected(tab)
    const maxChars = state.settings.includePage ? 8000 : 400
    const result = await callContent(tab, { op: 'read', maxChars }, 7000)
    if (result?.ok) {
      context.selection = result.selection || ''
      if (state.settings.includePage) context.pageText = result.text || ''
      state.lastCapture = { chars: result.chars || context.pageText.length, selection: context.selection }
      $('#pageBadge').hidden = !context.selection
      const chars = result.chars || 0
      $('#ctxState').textContent = state.settings.includePage
        ? (chars >= 1000 ? `${(chars / 1000).toFixed(1)}k 字` : `${chars} 字`)
        : '仅选中'
    }
  } catch (error) {
    console.warn('[dsh] capture context failed', error)
  }
  return context
}

async function captureScreenshot() {
  const tab = await activeTab()
  if (!tab || !/^https?:/i.test(tab.url || '')) return null
  try {
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true })
    await sleep(80)
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 72 })
    return { data: dataUrl.split(',')[1], mimeType: 'image/jpeg' }
  } catch (error) {
    console.warn('[dsh] screenshot failed', error)
    toast('截图失败，本轮不带截图')
    return null
  }
}

async function send() {
  const input = $('#input')
  const text = input.value.trim()
  if (!text || state.busy) return
  if (!state.settings.token) { openSheet('sheetSettings'); toast('先连接本地 bridge'); return }

  state.busy = true
  stickToBottom = true
  const userMessage = { id: uid(), role: 'user', text, at: Date.now(), meta: {} }
  state.messages.push(userMessage)
  input.value = ''
  autoGrow()
  renderAll()

  // optimistic assistant placeholder
  state.liveAssistantId = null
  const placeholder = ensureAssistant()
  placeholder.thinking = true
  renderAll({ keepScroll: true })

  const context = await capturePageContext()
  if (context) {
    userMessage.meta.page = Boolean(context.pageText)
    userMessage.meta.chars = context.pageText.length
    userMessage.meta.selection = Boolean(context.selection)
  }
  let image = null
  if (state.settings.screenshot) {
    image = await captureScreenshot()
    userMessage.meta.shot = Boolean(image)
  }
  renderAll({ keepScroll: true })

  try {
    const response = await fetch(`${baseUrl()}/api/chat`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        clientId: state.clientId,
        sessionId: state.sessionId,
        text,
        context,
        image,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.ok) {
      state.busy = false
      const message = state.messages.find((entry) => entry.id === state.liveAssistantId)
      if (message) { message.thinking = false; message.error = body.error || `请求失败（${response.status}）` }
      if (response.status === 401) setConn('unpaired', 'Token 无效，请在设置里重新获取')
      renderAll({ keepScroll: true })
    }
  } catch (error) {
    state.busy = false
    const message = state.messages.find((entry) => entry.id === state.liveAssistantId)
    if (message) { message.thinking = false; message.error = `连不上 bridge：${error.message}` }
    setConn('retrying', `连不上 ${baseUrl()}，先运行 ./start`)
    renderAll({ keepScroll: true })
  }
  persistChat()
}

async function stopTurn() {
  try {
    await fetch(`${baseUrl()}/api/stop`, { method: 'POST', headers: headers(), body: '{}' })
    toast('已请求停止')
  } catch (error) {
    toast(`停止失败：${error.message}`)
  }
}

/* ------------------------------------------------------------------ *
 * browser tools (executed here, on behalf of the agent)
 * ------------------------------------------------------------------ */
async function getTab(tabId) {
  if (tabId != null) return await chrome.tabs.get(Number(tabId))
  const tab = await activeTab()
  if (!tab) throw new Error('没有活动标签页')
  return tab
}

function assertInjectable(tab) {
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error(`当前页面（${tab.url || '未知'}）不允许注入脚本。请先打开一个普通网页（chrome://、扩展页、PDF 阅读器不支持）。`)
  }
}

async function ensureInjected(tab) {
  assertInjectable(tab)
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { __dsh: true, op: 'ping' }, { frameId: 0 })
    if (pong?.ok) return
  } catch { /* inject below */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] })
    await sleep(60)
  } catch (error) {
    throw new Error(`无法在这个页面执行操作：${error.message}`)
  }
}

async function callContent(tab, message, timeoutMs = 10000) {
  const response = await Promise.race([
    chrome.tabs.sendMessage(tab.id, { __dsh: true, ...message }, { frameId: 0 }),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('页面没有响应（可能正在跳转或加载）')), timeoutMs)),
  ])
  if (!response) throw new Error('页面返回了空结果')
  if (response.ok === false) throw new Error(response.error || '页面操作失败')
  return response
}

async function waitForTabLoad(tabId, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab) return
    if (tab.status === 'complete' && Date.now() - started > 500) return
    await sleep(250)
  }
}

function normalizeUrl(raw) {
  let value = String(raw || '').trim()
  if (!value) throw new Error('url 为空')
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 http/https 链接')
  return url.href
}

async function toolStatus() {
  const tabs = await chrome.tabs.query({})
  const active = tabs.find((tab) => tab.active) || null
  const lines = []
  if (active) lines.push(`活动标签页：#${active.id} 「${active.title || ''}」 ${active.url || ''}`)
  lines.push('', `打开中的标签页（${tabs.length}）：`)
  for (const tab of tabs.slice(0, 40)) {
    lines.push(`${tab.id === active?.id ? '●' : '-'} #${tab.id} 「${(tab.title || '').slice(0, 80)}」 ${tab.url || ''}`)
  }
  return lines.join('\n')
}

async function toolRead(args = {}) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  const maxChars = Math.min(Math.max(Number(args.maxChars) || 14000, 1000), 60000)
  const result = await callContent(tab, { op: 'read', maxChars }, 12000)
  let out = `标题：${result.title}\nURL：${result.url}\n`
  if (result.selection) out += `\n用户当前选中：\n"""\n${result.selection}\n"""\n`
  if (result.outline) out += `\n页面结构：\n${result.outline}\n`
  out += `\n正文（${result.chars} 字符）：\n${result.text}`
  return out
}

async function toolSnapshot(args = {}) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  const result = await callContent(tab, {
    op: 'snapshot',
    maxElements: args.maxElements ?? 120,
    includeOutline: args.includeOutline !== false,
  }, 12000)
  const lines = [`标题：${result.title}`, `URL：${result.url}`]
  if (result.selection) lines.push(`选中：${result.selection.slice(0, 500)}`)
  if (result.outline) lines.push('', '页面结构：', result.outline)
  lines.push('', '可交互元素（ref 只在当前页面有效，跳转后需要重新 snapshot）：')
  for (const element of result.elements) {
    const bits = [`[${element.ref}]`, element.role]
    if (element.name) bits.push(`"${element.name}"`)
    if (element.type) bits.push(`type=${element.type}`)
    if (element.placeholder) bits.push(`placeholder="${element.placeholder}"`)
    if (element.value) bits.push(`value="${element.value}"`)
    if (element.href) bits.push(`→ ${element.href}`)
    if (element.disabled) bits.push('(disabled)')
    if (element.offscreen) bits.push('(不在视口)')
    lines.push(bits.join(' '))
  }
  return lines.join('\n')
}

async function toolOpen(args) {
  const url = normalizeUrl(args.url)
  let tab
  if (args.newTab) tab = await chrome.tabs.create({ url, active: true })
  else {
    const current = await getTab(args.tabId)
    tab = await chrome.tabs.update(current.id, { url, active: true })
  }
  await waitForTabLoad(tab.id, 18000)
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab)
  return `${fresh.title || '(无标题)'}\n${fresh.url}`
}

async function toolClick(args) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  let result
  try {
    result = await callContent(tab, { op: 'click', ref: args.ref, selector: args.selector, text: args.text }, 5000)
  } catch (error) {
    const message = String(error?.message ?? error)
    // Only a lost channel means a navigation may have destroyed the content script.
    if (!/没有响应|message channel|Could not establish|Receiving end does not exist|context invalidated/i.test(message)) throw error
    await sleep(500)
    const fresh = await chrome.tabs.get(tab.id).catch(() => tab)
    return `点击已触发；页面响应中断，可能正在跳转。\n当前：${fresh.title || ''}\n${fresh.url || ''}`
  }
  await sleep(450)
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab)
  const clicked = result.clicked || {}
  const target = clicked.name ? `「${clicked.name}」` : ''
  return `已点击 ${clicked.role || '元素'}${target}${result.href ? `（指向 ${result.href}）` : ''}${result.opensNewTab ? '，可能打开了新标签页' : ''}。\n当前页面：${fresh.title || ''}\n${fresh.url || ''}`
}

async function toolType(args) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  await callContent(tab, {
    op: 'type',
    ref: args.ref,
    selector: args.selector,
    text: String(args.text ?? ''),
    clear: args.clear !== false,
    submit: Boolean(args.submit),
  }, 5000)
  if (args.submit) await sleep(700)
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab)
  return `已输入 ${String(args.text ?? '').length} 个字符${args.submit ? '并提交' : ''}。\n当前页面：${fresh.title || ''}\n${fresh.url || ''}`
}

async function toolScroll(args) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  const result = await callContent(tab, { op: 'scroll', direction: args.direction, amount: args.amount, ref: args.ref }, 8000)
  return `滚动位置 ${result.scrollY}px${result.pageHeight ? ` / 页面高 ${result.pageHeight}px` : ''}${result.atBottom ? '（已到底部）' : ''}`
}

async function toolFind(args) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  const result = await callContent(tab, { op: 'find', query: args.query, max: args.max ?? 8 }, 10000)
  if (!result.matches.length) return `页面上没有找到「${args.query}」。`
  return result.matches.map((match, index) => `${index + 1}. ${match.ref ? `[${match.ref}] ` : ''}${match.snippet}${match.onScreen ? '（在视口内）' : ''}`).join('\n')
}

async function toolScreenshot(args = {}) {
  const tab = await getTab(args.tabId)
  assertInjectable(tab)
  if (!tab.active) await chrome.tabs.update(tab.id, { active: true })
  await sleep(120)
  if (args.fullPage) {
    try {
      const data = await captureFullPage(tab.id)
      return { image: { data, mimeType: 'image/jpeg' }, text: '已截取整页（长图）。' }
    } catch (error) {
      console.warn('[dsh] full page capture failed, falling back', error)
    }
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 })
  return { image: { data: dataUrl.split(',')[1], mimeType: 'image/jpeg' }, text: '已截取当前可见区域。' }
}

async function captureFullPage(tabId) {
  const target = { tabId: Number(tabId) }
  await chrome.debugger.attach(target, '1.3')
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable')
    const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics')
    const width = Math.min(Math.ceil(metrics.cssContentSize?.width ?? metrics.contentSize.width), 4000)
    const height = Math.min(Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height), 20000)
    const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 70,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })
    return shot.data
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
  }
}

async function toolHistory(args) {
  const tab = await getTab(args.tabId)
  if (args.action === 'back') await chrome.tabs.goBack(tab.id)
  else if (args.action === 'forward') await chrome.tabs.goForward(tab.id)
  else await chrome.tabs.reload(tab.id)
  await waitForTabLoad(tab.id, 14000)
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab)
  return `${fresh.title || ''}\n${fresh.url || ''}`
}

async function toolHighlight(args) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  const result = await callContent(tab, { op: 'highlight', refs: args.refs || [], text: args.text }, 8000)
  return `已高亮 ${result.highlighted} 处。`
}

async function toolWait(args) {
  const tab = await getTab(args.tabId)
  await ensureInjected(tab)
  const timeout = Math.min(Number(args.timeoutMs) || 8000, 15000)
  const result = await callContent(tab, { op: 'wait', selector: args.selector, text: args.text, ms: args.ms, timeoutMs: timeout }, timeout + 3000)
  return result.matched ? `已出现（匹配 ${result.matched}）。` : `已等待 ${result.waited ?? timeout}ms。`
}

async function executeTool(name, args) {
  switch (name) {
    case 'browser_status': return { ok: true, result: { text: await toolStatus() } }
    case 'browser_read': return { ok: true, result: { text: await toolRead(args) } }
    case 'browser_snapshot': return { ok: true, result: { text: await toolSnapshot(args) } }
    case 'browser_open': return { ok: true, result: { text: await toolOpen(args) } }
    case 'browser_click': return { ok: true, result: { text: await toolClick(args) } }
    case 'browser_type': return { ok: true, result: { text: await toolType(args) } }
    case 'browser_scroll': return { ok: true, result: { text: await toolScroll(args) } }
    case 'browser_find': return { ok: true, result: { text: await toolFind(args) } }
    case 'browser_screenshot': return { ok: true, result: await toolScreenshot(args) }
    case 'browser_history': return { ok: true, result: { text: await toolHistory(args) } }
    case 'browser_highlight': return { ok: true, result: { text: await toolHighlight(args) } }
    case 'browser_wait': return { ok: true, result: { text: await toolWait(args) } }
    default:
      return { ok: false, error: `未知浏览器工具 ${name}` }
  }
}

async function runBrowserTool(event) {
  const { callId, name, args } = event
  let message = state.messages.find((entry) => entry.id === state.liveAssistantId)
  if (!message) message = ensureAssistant()
  const part = findToolPart(message, callId, name)
  if (part) {
    part.busCallId = callId
    part.status = 'running'
  } else {
    message.parts.push({ kind: 'tool', busCallId: callId, name, args, status: 'running', detail: '' })
    message.thinking = false
    renderAll({ keepScroll: true })
  }
  let response
  try {
    response = await executeTool(name, args)
  } catch (error) {
    response = { ok: false, error: String(error?.message ?? error) }
  }
  try {
    await fetch(`${baseUrl()}/api/tool-result`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ callId, ...response }),
    })
  } catch (error) {
    console.warn('[dsh] tool-result post failed', error)
  }
}

/* ------------------------------------------------------------------ *
 * sessions sheet
 * ------------------------------------------------------------------ */
async function refreshSessions() {
  if (!state.settings.token) { renderSessionList(); return }
  try {
    const response = await fetch(`${baseUrl()}/api/sessions?token=${encodeURIComponent(state.settings.token)}`)
    if (!response.ok) return
    const data = await response.json()
    state.sessions = data.sessions || []
    renderSessionList()
  } catch { /* offline */ }
}

function sortedSessions() {
  return state.sessions.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.archived !== b.archived) return a.archived ? 1 : -1
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

async function updateSession(id, patch) {
  try {
    const response = await fetch(`${baseUrl()}/api/sessions/update`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ id, ...patch }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
    state.sessions = data.sessions || state.sessions
    renderSessionList()
    return true
  } catch (error) {
    toast(`会话更新失败：${error.message}`)
    renderSessionList()
    return false
  }
}

function renderSessionList() {
  const list = $('#sessionList')
  if (!list) return
  list.innerHTML = ''
  const sessions = sortedSessions()
  if (!sessions.length) {
    list.innerHTML = '<div class="session-empty">还没有历史对话。</div>'
    return
  }
  const active = sessions.filter((session) => !session.archived)
  const archived = sessions.filter((session) => session.archived)
  const activeGroup = document.createElement('div')
  activeGroup.className = 'session-group'
  if (!active.length) activeGroup.innerHTML = '<div class="session-empty">没有进行中的对话。</div>'
  for (const session of active) activeGroup.append(sessionRow(session, false))
  list.append(activeGroup)

  if (archived.length) {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'session-toggle'
    toggle.innerHTML = `<svg><use href="#i-archive"/></svg><span>${state.showArchived ? '隐藏' : '显示'}已归档（${archived.length}）</span>`
    toggle.addEventListener('click', () => { state.showArchived = !state.showArchived; renderSessionList() })
    list.append(toggle)
    if (state.showArchived) {
      const archivedGroup = document.createElement('div')
      archivedGroup.className = 'session-group archived'
      for (const session of archived) archivedGroup.append(sessionRow(session, true))
      list.append(archivedGroup)
    }
  }
}

function sessionRow(session, archived) {
  const row = document.createElement('div')
  row.className = `session-item${session.id === state.sessionId ? ' active' : ''}${session.pinned ? ' pinned' : ''}`
  row.dataset.session = session.id

  const main = document.createElement('button')
  main.type = 'button'
  main.className = 'session-main'
  main.innerHTML = `<span class="s-title">${escapeHtml(session.title || '新对话')}</span><span class="s-time">${session.pinned ? '置顶 · ' : ''}${formatTime(session.updatedAt)}</span>`
  main.addEventListener('click', () => void switchSession(session.id))
  row.append(main)

  const actions = document.createElement('div')
  actions.className = 'session-actions'
  const addAction = (icon, label, name, action, on = false) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `session-action${on ? ' on' : ''}`
    button.dataset.action = name
    button.title = label
    button.setAttribute('aria-label', label)
    button.innerHTML = `<svg><use href="#${icon}"/></svg>`
    button.addEventListener('click', (event) => { event.stopPropagation(); event.preventDefault(); void action() })
    actions.append(button)
    return button
  }

  addAction('i-pin', session.pinned ? '取消置顶' : '置顶', 'pin', async () => {
    await updateSession(session.id, { pinned: !session.pinned })
    toast(session.pinned ? '已取消置顶' : '已置顶')
  }, session.pinned)
  addAction('i-edit', '重命名', 'rename', () => startRename(row, session))
  addAction(archived ? 'i-inbox' : 'i-archive', archived ? '取消归档' : '归档', archived ? 'unarchive' : 'archive', async () => {
    await updateSession(session.id, { archived: !session.archived })
    toast(archived ? '已取消归档' : '已归档')
  })
  row.append(actions)

  if (archived) row.classList.add('archived')
  return row
}

function startRename(row, session) {
  const main = row.querySelector('.session-main')
  if (!main) return
  const input = document.createElement('input')
  input.className = 'session-rename'
  input.value = session.title || ''
  input.maxLength = 80
  main.replaceWith(input)
  input.focus()
  input.select()
  let done = false
  const finish = async (save) => {
    if (done) return
    done = true
    const value = input.value.trim()
    if (save && value && value !== session.title) await updateSession(session.id, { title: value })
    else renderSessionList()
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true) }
    else if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  })
  input.addEventListener('blur', () => { void finish(true) })
}

/* ------------------------------------------------------------------ *
 * sheets + events
 * ------------------------------------------------------------------ */
function openSheet(id) {
  $('#scrim').hidden = false
  $(`#${id}`).hidden = false
  if (id === 'sheetSettings') {
    $('#setBridge').value = state.settings.bridgeUrl
    $('#setToken').value = state.settings.token
    $('#setModel').textContent = state.settings.model
    $('#setSession').textContent = state.sessionId
  }
  if (id === 'sheetHistory') { void refreshSessions(); renderSessionList() }
}

function closeSheets() {
  $('#scrim').hidden = true
  $('#sheetSettings').hidden = true
  $('#sheetHistory').hidden = true
}

function bind() {
  $('#btnSend').addEventListener('click', () => void send())
  $('#btnStop').addEventListener('click', () => void stopTurn())
  $('#btnNew').addEventListener('click', () => void newSession())
  $('#btnNewFromHistory').addEventListener('click', () => void newSession())
  $('#btnHistory').addEventListener('click', () => openSheet('sheetHistory'))
  $('#btnSettings').addEventListener('click', () => openSheet('sheetSettings'))
  $('#connAction').addEventListener('click', () => openSheet('sheetSettings'))
  $('#scrim').addEventListener('click', closeSheets)
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closeSheets))

  const input = $('#input')
  input.addEventListener('input', () => {
    autoGrow()
    $('#btnSend').disabled = !input.value.trim() || state.busy
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void send()
    }
  })

  $('#togglePage').addEventListener('click', () => {
    state.settings.includePage = !state.settings.includePage
    $('#togglePage').classList.toggle('on', state.settings.includePage)
    void persistSettings()
    toast(state.settings.includePage ? '将附带页面正文' : '不附带页面正文')
  })
  $('#effort').addEventListener('change', async (event) => {
    const previous = state.settings.effort || 'auto'
    const next = event.target.value
    if (state.busy) { event.target.value = previous; toast('等这一轮结束再改思考强度'); return }
    try {
      const response = await fetch(`${baseUrl()}/api/settings`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ reasoningEffort: next }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`)
      state.settings.effort = body.reasoningEffort || next
      event.target.value = state.settings.effort
      const labels = { auto: '自动', off: '快速', low: '标准', high: '深入', max: '极限' }
      toast(`思考强度：${labels[state.settings.effort] || state.settings.effort}`)
    } catch (error) {
      event.target.value = previous
      toast(`设置失败：${error.message}`)
    }
  })

  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.__dshWidget !== true) return
    if (data.type === 'prompt' && typeof data.text === 'string') sendText(data.text.slice(0, 8000))
    if (data.type === 'open' && typeof data.url === 'string' && /^https:\/\//.test(data.url)) chrome.tabs.create({ url: data.url })
  })

  $('#toggleShot').addEventListener('click', () => {
    state.settings.screenshot = !state.settings.screenshot
    $('#toggleShot').classList.toggle('on', state.settings.screenshot)
    void persistSettings()
    toast(state.settings.screenshot ? '将附带当前页面截图' : '不附带截图')
  })

  $('#btnSaveSettings').addEventListener('click', async () => {
    state.settings.bridgeUrl = $('#setBridge').value.trim().replace(/\/+$/, '') || DEFAULTS.bridgeUrl
    state.settings.token = $('#setToken').value.trim()
    await persistSettings()
    connect()
    closeSheets()
    toast('设置已保存')
    void checkHealth()
  })

  $('#btnPair').addEventListener('click', () => void pairBridge())
  $('#btnOpenLanding').addEventListener('click', () => {
    const base = ($('#setBridge').value || state.settings.bridgeUrl || DEFAULTS.bridgeUrl).replace(/\/+$/, '')
    chrome.tabs.create({ url: base })
  })
  $('#btnReset').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null)
    const keys = Object.keys(all).filter((key) => key.startsWith('chat:'))
    await chrome.storage.local.remove(keys)
    state.messages = []
    await newSession()
    closeSheets()
    toast('本机会话记录已清空')
  })

  // Only a user scroll changes the auto-follow preference; programmatic
  // scrolls during rendering also fire `scroll` and would otherwise race.
  $('#chat').addEventListener('scroll', (event) => {
    if (event.isTrusted) stickToBottom = isNearBottom()
  }, { passive: true })
  $('#chat').addEventListener('wheel', () => { stickToBottom = isNearBottom() }, { passive: true })

  chrome.tabs.onActivated.addListener(() => { void refreshContext() })
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) void refreshContext()
  })
  chrome.windows.onFocusChanged.addListener(() => { void refreshContext() })

  document.addEventListener('paste', () => setTimeout(autoGrow, 0))
}

async function handlePendingAsk() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'dsh:pending-ask' }, (value) => resolve(value))
    })
    const pending = response?.pendingAsk
    if (!pending || Date.now() - pending.at > 120000) return
    await chrome.runtime.sendMessage({ type: 'dsh:clear-pending-ask' })
    if (pending.text) {
      $('#input').value = pending.text
      autoGrow()
      await sleep(120)
      await send()
    }
  } catch (error) {
    console.warn('[dsh] pending ask', error)
  }
}

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */
async function init() {
  await loadSettings()
  await loadSession()
  bind()
  renderAll()
  await refreshContext()
  if (state.settings.token) connect()
  else setConn('unpaired', '未连接本地 bridge')
  void checkHealth()
  void refreshSessions()
  setTimeout(() => void handlePendingAsk(), 300)
  setTimeout(() => $('#input').focus(), 100)
}

void init()
