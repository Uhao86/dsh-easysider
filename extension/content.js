/**
 * DSH Sidebar content script.
 *
 * Injected on demand by the side panel (chrome.scripting.executeScript). One
 * long-lived listener per frame; element refs stay stable for the lifetime of
 * the page so the model can refer to "e12" across several tool calls.
 */
(() => {
  if (window.__DSH_SIDEBAR_CONTENT__) return
  window.__DSH_SIDEBAR_CONTENT__ = true

  const INTERACTIVE = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
    '[role="switch"]', '[role="menuitem"]', '[role="combobox"]', '[contenteditable="true"]',
    '[onclick]',
  ].join(',')

  const refs = new Map()
  const byElement = new WeakMap()
  let refCounter = 0

  /* ---------------------------------------------------------------- */
  function isVisible(el) {
    if (!(el instanceof Element)) return false
    if (el.closest('[aria-hidden="true"]')) return false
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    if (Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }

  function inViewport(el) {
    const rect = el.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
  }

  function clean(text, max = 80) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim()
    return value.length > max ? value.slice(0, max) + '…' : value
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (['submit', 'button', 'reset'].includes(type)) return 'button'
      return 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'element'
  }

  function nameOf(el) {
    const aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      if (label.trim()) return clean(label)
    }
    const text = el.innerText || el.textContent
    if (text && text.trim()) return clean(text)
    const placeholder = el.getAttribute('placeholder')
    if (placeholder) return clean(placeholder)
    const alt = el.querySelector('img[alt]')?.getAttribute('alt')
    if (alt) return clean(alt)
    const title = el.getAttribute('title')
    if (title) return clean(title)
    if (el.tagName.toLowerCase() === 'input') return clean(el.getAttribute('name') || el.getAttribute('type') || 'input')
    return ''
  }

  function valueOf(el) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'password') return el.value ? '••••••' : ''
      if (type === 'checkbox' || type === 'radio') return el.checked ? 'checked' : 'unchecked'
      return clean(el.value, 60)
    }
    if (tag === 'textarea' || el.isContentEditable) return clean(el.value ?? el.innerText, 60)
    if (tag === 'select') return clean(el.selectedOptions?.[0]?.textContent ?? el.value, 60)
    return ''
  }

  function refFor(el) {
    let ref = byElement.get(el)
    if (!ref) {
      ref = `e${++refCounter}`
      byElement.set(el, ref)
      refs.set(ref, new WeakRef(el))
      el.setAttribute('data-dsh-ref', ref)
    }
    return ref
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase()
    const info = { ref: refFor(el), tag, role: roleOf(el), name: nameOf(el) }
    const type = el.getAttribute('type')
    if (type) info.type = type
    if (tag === 'a') {
      const href = el.getAttribute('href')
      if (href) info.href = clean(el.href, 140)
    }
    const value = valueOf(el)
    if (value) info.value = value
    const placeholder = el.getAttribute('placeholder')
    if (placeholder) info.placeholder = clean(placeholder, 60)
    const nameAttr = el.getAttribute('name')
    if (nameAttr && tag === 'input') info.field = clean(nameAttr, 40)
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') info.disabled = true
    if (!inViewport(el)) info.offscreen = true
    return info
  }

  function resolveTarget({ ref, selector, text } = {}) {
    if (ref) {
      const weak = refs.get(String(ref))
      const el = weak?.deref?.() ?? null
      if (!el || !el.isConnected) throw new Error(`引用 ${ref} 已失效（页面可能已跳转或刷新），请重新调用 browser_snapshot`)
      return el
    }
    if (selector) {
      const el = document.querySelector(selector)
      if (!el) throw new Error(`找不到选择器 ${selector}`)
      return el
    }
    if (text) {
      const needle = String(text).toLowerCase()
      const candidates = [...document.querySelectorAll(INTERACTIVE)].filter(isVisible)
      const exact = candidates.find((el) => nameOf(el).toLowerCase() === needle)
      if (exact) return exact
      const partial = candidates.find((el) => nameOf(el).toLowerCase().includes(needle))
      if (partial) return partial
      throw new Error(`找不到包含文字「${text}」的可点击元素`)
    }
    throw new Error('需要 ref、selector 或 text 之一')
  }

  /* ---------------------------------------------------------------- */
  function overlayHost() {
    let host = document.getElementById('__dsh_overlay_host__')
    if (!host) {
      host = document.createElement('div')
      host.id = '__dsh_overlay_host__'
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden'
      ;(document.documentElement || document.body).appendChild(host)
    }
    return host
  }

  function drawBox(el, label, ttl = 1600) {
    if (!el || !el.isConnected) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    const host = overlayHost()
    const box = document.createElement('div')
    box.style.cssText = [
      'position:fixed',
      `left:${Math.max(0, rect.left - 3)}px`,
      `top:${Math.max(0, rect.top - 3)}px`,
      `width:${Math.min(window.innerWidth, rect.width + 6)}px`,
      `height:${Math.min(window.innerHeight, rect.height + 6)}px`,
      'border:2px solid #4d6bfe',
      'border-radius:6px',
      'background:rgba(77,107,254,0.12)',
      'box-shadow:0 0 0 4px rgba(77,107,254,0.12)',
      'transition:opacity .25s ease',
    ].join(';')
    if (label) {
      const tag = document.createElement('div')
      tag.textContent = label
      tag.style.cssText = [
        'position:absolute',
        'top:-22px',
        'left:-2px',
        'background:#4d6bfe',
        'color:#fff',
        'font:600 11px/1.6 -apple-system,BlinkMacSystemFont,sans-serif',
        'padding:0 6px',
        'border-radius:4px',
        'white-space:nowrap',
      ].join(';')
      box.appendChild(tag)
    }
    host.appendChild(box)
    setTimeout(() => { box.style.opacity = '0' }, ttl)
    setTimeout(() => box.remove(), ttl + 300)
  }

  /* ---------------------------------------------------------------- */
  function outline() {
    const headings = [...document.querySelectorAll('h1,h2,h3')]
      .filter(isVisible)
      .slice(0, 40)
      .map((h) => `${'  '.repeat(Number(h.tagName[1]) - 1)}- ${clean(h.innerText, 90)}`)
    return headings.join('\n')
  }

  function pageText() {
    const main = document.querySelector('main, [role="main"], article')
    const root = main && (main.innerText || '').length > 400 ? main : document.body
    const text = (root.innerText || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text
  }

  function snapshotElements(maxElements) {
    const elements = [...document.querySelectorAll(INTERACTIVE)].filter(isVisible).slice(0, maxElements * 3)
    const described = elements.map((el, index) => ({ el, index, info: describe(el) }))
    described.sort((a, b) => {
      const av = a.info.offscreen ? 1 : 0
      const bv = b.info.offscreen ? 1 : 0
      if (av !== bv) return av - bv
      return a.index - b.index
    })
    return described.slice(0, maxElements).map((entry) => entry.info)
  }

  /* ---------------------------------------------------------------- */
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

  async function waitFor({ selector, text, ms, timeoutMs }, fallbackTimeout) {
    if (ms) { await sleep(Math.min(Number(ms), 10000)); return { ok: true, waited: Math.min(Number(ms), 10000) } }
    const deadline = Date.now() + Math.min(Number(timeoutMs ?? fallbackTimeout ?? 8000), 15000)
    return new Promise((resolve, reject) => {
      const check = () => {
        if (selector && document.querySelector(selector)) return done('selector')
        if (text) {
          const needle = String(text).toLowerCase()
          const hit = [...document.querySelectorAll(INTERACTIVE)].some((el) => isVisible(el) && nameOf(el).toLowerCase().includes(needle))
          if (hit) return done('text')
        }
        if (Date.now() > deadline) {
          observer.disconnect()
          reject(new Error(`等待超时：${selector ? `选择器 ${selector}` : `文字「${text}」`} 未出现`))
        }
      }
      let settled = false
      const done = (what) => {
        if (settled) return
        settled = true
        observer.disconnect()
        clearInterval(timer)
        resolve({ ok: true, matched: what })
      }
      const observer = new MutationObserver(check)
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
      const timer = setInterval(check, 250)
      check()
    })
  }

  function selection() {
    try { return window.getSelection()?.toString() ?? '' } catch { return '' }
  }

  /* ---------------------------------------------------------------- */
  const handlers = {
    async ping() {
      return { ok: true, ready: true, url: location.href, title: document.title }
    },

    async read({ maxChars = 16000 } = {}) {
      const text = pageText()
      const cap = Math.min(Math.max(Number(maxChars) || 16000, 1000), 60000)
      return {
        ok: true,
        url: location.href,
        title: document.title,
        selection: selection().slice(0, 4000),
        outline: outline(),
        text: text.length > cap ? text.slice(0, cap) + `\n…（已截断，全文 ${text.length} 字符）` : text,
        chars: text.length,
      }
    },

    async snapshot({ maxElements = 120, includeOutline = true } = {}) {
      const cap = Math.min(Math.max(Number(maxElements) || 120, 10), 300)
      const elements = snapshotElements(cap)
      return {
        ok: true,
        url: location.href,
        title: document.title,
        outline: includeOutline ? outline() : '',
        elements,
        selection: selection().slice(0, 2000),
      }
    },

    async click({ ref, selector, text } = {}) {
      const el = resolveTarget({ ref, selector, text })
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      drawBox(el, ref || '点击', 1400)
      const info = describe(el)
      const opensNewTab = el.tagName === 'A' && el.target && el.target !== '_self'
      const href = el.tagName === 'A' ? el.href : null
      await sleep(40)
      setTimeout(() => { try { el.click() } catch (error) { console.warn('[dsh] click failed', error) } }, 60)
      return { ok: true, clicked: info, href, opensNewTab, note: '点击已触发；如果页面跳转，请重新检查 URL/标题' }
    },

    async type({ ref, selector, text = '', clear = true, submit = false } = {}) {
      const el = resolveTarget({ ref, selector })
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      drawBox(el, ref || '输入', 1400)
      el.focus({ preventScroll: true })
      const tag = el.tagName.toLowerCase()
      if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') {
        if (clear) {
          el.textContent = ''
        }
        el.textContent += text
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
      } else {
        const prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        if (clear) {
          setter?.call(el, '')
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        setter?.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (submit) {
        setTimeout(() => {
          const form = el.form || el.closest('form')
          const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
          el.dispatchEvent(enter)
          const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
          el.dispatchEvent(enterUp)
          if (form && !form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))) return
          if (form) { try { form.requestSubmit ? form.requestSubmit() : form.submit() } catch {} }
        }, 80)
      }
      return { ok: true, typed: text.length, submitted: Boolean(submit) }
    },

    async scroll({ direction, amount, ref } = {}) {
      if (ref) {
        const weak = refs.get(String(ref))
        const el = weak?.deref?.()
        if (!el || !el.isConnected) throw new Error(`引用 ${ref} 已失效，请重新 snapshot`)
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        await sleep(350)
        drawBox(el, ref, 1200)
        return { ok: true, scrollY: Math.round(window.scrollY) }
      }
      const step = Number(amount) || Math.round(window.innerHeight * 0.85)
      if (direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' })
      else if (direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
      else window.scrollBy({ top: direction === 'up' ? -step : step, behavior: 'smooth' })
      await sleep(350)
      return {
        ok: true,
        scrollY: Math.round(window.scrollY),
        pageHeight: Math.round(document.documentElement.scrollHeight),
        atBottom: Math.round(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 4,
      }
    },

    async find({ query, max = 8 } = {}) {
      const needle = String(query ?? '').toLowerCase().trim()
      if (!needle) throw new Error('query 不能为空')
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement
          if (!parent || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
          if (parent.closest('script,style,noscript,svg')) return NodeFilter.FILTER_REJECT
          if (!isVisible(parent)) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      const matches = []
      const seen = new Set()
      let node
      while ((node = walker.nextNode()) && matches.length < Math.min(Number(max) || 8, 20)) {
        const value = node.nodeValue
        const index = value.toLowerCase().indexOf(needle)
        if (index < 0) continue
        const el = node.parentElement
        const block = el.closest('p,li,td,article,section,div,span,a,button') || el
        const key = block
        if (seen.has(key)) continue
        seen.add(key)
        const snippet = clean(value.slice(Math.max(0, index - 60), index + needle.length + 60), 180)
        const interactive = el.closest(INTERACTIVE)
        const info = interactive ? describe(interactive) : { ref: null, element: block.tagName.toLowerCase() }
        matches.push({
          ref: info.ref,
          snippet,
          tag: info.tag ?? info.element ?? null,
          onScreen: inViewport(interactive || block),
        })
        if (interactive) drawBox(interactive, info.ref, 1200)
      }
      return { ok: true, matches }
    },

    async highlight({ refs: list = [], text } = {}) {
      let count = 0
      for (const ref of list) {
        const weak = refs.get(String(ref))
        const el = weak?.deref?.()
        if (el?.isConnected) { drawBox(el, ref, 4000); count++ }
      }
      if (text) {
        const needle = String(text).toLowerCase()
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          if (!node.nodeValue?.toLowerCase().includes(needle)) continue
          const el = node.parentElement
          if (el && isVisible(el)) { drawBox(el, '匹配', 4000); count++; break }
        }
      }
      return { ok: true, highlighted: count }
    },

    async wait(options = {}) {
      return waitFor(options)
    },
  }

  async function run(message) {
    const handler = handlers[message.op]
    if (!handler) return { ok: false, error: `未知操作 ${message.op}` }
    return handler(message)
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.__dsh !== true) return undefined
    run(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
    )
    return true
  })
})()
