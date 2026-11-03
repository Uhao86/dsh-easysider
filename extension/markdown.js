/**
 * Shared markdown renderer for the side panel and the intelligent-UI
 * component renderer. Escapes first, so page/model text can never inject
 * markup; only the small supported subset is transformed.
 */
(function () {
  'use strict'

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  }

  function inlineMarkdown(source) {
    let out = escapeHtml(source)
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    return out
  }

  function renderMarkdown(source) {
    const blocks = []
    let text = String(source ?? '').replace(/\r\n?/g, '\n')
    text = text.replace(/```([\w+#-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
      const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''
      blocks.push(`<pre>${label}<code>${escapeHtml(code.replace(/\n$/, ''))}</code><button class="copy-code" data-copy>复制</button></pre>`)
      return `\u0000${blocks.length - 1}\u0000`
    })

    const lines = text.split('\n')
    const out = []
    let paragraph = []
    let list = null
    let quote = []

    const flushParagraph = () => {
      if (paragraph.length) { out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`); paragraph = [] }
    }
    const flushList = () => {
      if (list) {
        out.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`)
        list = null
      }
    }
    const flushQuote = () => {
      if (quote.length) { out.push(`<blockquote>${quote.map(inlineMarkdown).join('<br>')}</blockquote>`); quote = [] }
    }
    const flushAll = () => { flushParagraph(); flushList(); flushQuote() }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const line = raw.trimEnd()

      if (/^\u0000\d+\u0000$/.test(line.trim())) { flushAll(); out.push(blocks[Number(line.trim().replace(/\u0000/g, ''))]); continue }
      if (!line.trim()) { flushAll(); continue }

      // GFM-ish table: header row + separator row.
      if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '') && (lines[i + 1] || '').includes('-')) {
        flushAll()
        const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
        const head = cells(line)
        const rows = []
        i += 2
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++ }
        i--
        out.push(`<table><thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
        continue
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        flushAll()
        const level = Math.min(heading[1].length + 1, 4)
        out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
        continue
      }

      if (/^>\s?/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^>\s?/, '')); continue }
      if (/^[-*+]\s+/.test(line)) {
        flushParagraph(); flushQuote()
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] } }
        list.items.push(line.replace(/^[-*+]\s+/, '')); continue
      }
      if (/^\d+[.)]\s+/.test(line)) {
        flushParagraph(); flushQuote()
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] } }
        list.items.push(line.replace(/^\d+[.)]\s+/, '')); continue
      }
      if (/^(---+|\*\*\*+)$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue }

      flushList(); flushQuote()
      paragraph.push(line)
    }
    flushAll()
    return out.join('')
  }

  window.DSHMarkdown = { escapeHtml, inlineMarkdown, renderMarkdown }
})()
