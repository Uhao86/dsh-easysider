/**
 * Renderer for DeepSeek Harness Intelligent UI component trees.
 *
 * The agent runs with `deepseek-harness-intelligent-ui` mounted, so it calls
 * ui_render / ui_compose / ui_patch. Those tools normally render in the DSH web
 * client; this file is the side panel's own native renderer for the same
 * declarative catalog. It supports the common components and degrades
 * gracefully for anything it does not know.
 */
(function () {
  'use strict'

  const { escapeHtml, inlineMarkdown, renderMarkdown } = window.DSHMarkdown
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const PALETTE = ['#4d6bfe', '#18b6a4', '#f59e0b', '#e85d75', '#8b5cf6', '#0ea5e9', '#84cc16', '#f97316']
  const TONES = new Set(['default', 'muted', 'info', 'success', 'warning', 'error'])

  const h = (tag, className, text) => {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text !== undefined) el.textContent = String(text)
    return el
  }
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value))
    return el
  }
  const prop = (node, key, fallback) => (node.props && node.props[key] !== undefined ? node.props[key] : fallback)
  const tone = (value) => (TONES.has(value) && value !== 'default' ? ` tone-${value}` : '')
  const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const scalar = (value) => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value))
  const safeUrl = (value) => {
    if (typeof value !== 'string') return null
    try {
      const url = new URL(value)
      return url.protocol === 'https:' ? url.href : null
    } catch { return null }
  }
  const compact = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return String(value)
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
    if (Number.isInteger(n)) return String(n)
    return n.toFixed(1)
  }

  function fallback(node, message) {
    const box = h('div', 'ui-unknown')
    box.append(h('div', 'ui-unknown-title', `暂不支持：${node?.type ?? '未知组件'}`))
    if (message) box.append(h('div', 'ui-unknown-note', message))
    const pre = h('pre', 'ui-code')
    pre.textContent = JSON.stringify(node?.props ?? {}, null, 2).slice(0, 2000)
    box.append(pre)
    return box
  }

  /* ------------------------------------------------------------------ *
   * primitives
   * ------------------------------------------------------------------ */
  function renderText(node) {
    const text = String(prop(node, 'text', ''))
    const variant = prop(node, 'variant', 'body')
    const box = h('div', `ui-text ui-text-${variant}${tone(prop(node, 'tone'))}`)
    if (variant === 'title' || variant === 'heading' || variant === 'caption') box.innerHTML = inlineMarkdown(text)
    else box.innerHTML = renderMarkdown(text)
    return box
  }

  function renderCode(node) {
    const wrap = h('div', 'ui-code-wrap')
    const pre = h('pre', 'ui-code')
    if (prop(node, 'language')) {
      const label = h('span', 'code-lang', String(prop(node, 'language')))
      pre.append(label)
    }
    const code = h('code', '', String(prop(node, 'code', '')))
    pre.append(code)
    const copy = h('button', 'copy-code', '复制')
    copy.dataset.copy = '1'
    pre.append(copy)
    wrap.append(pre)
    return wrap
  }

  function renderAlert(node) {
    const box = h('div', `ui-alert${tone(prop(node, 'tone'))}`)
    if (prop(node, 'title')) box.append(h('div', 'ui-alert-title', String(prop(node, 'title'))))
    const body = h('div', 'ui-alert-text')
    body.innerHTML = inlineMarkdown(String(prop(node, 'text', '')))
    box.append(body)
    return box
  }

  function renderBadge(node) {
    return h('span', `ui-badge${tone(prop(node, 'tone'))}`, String(prop(node, 'text', '')))
  }

  function renderStat(node) {
    const box = h('div', 'ui-stat')
    box.append(h('div', 'ui-stat-label', String(prop(node, 'label', ''))))
    box.append(h('div', 'ui-stat-value', scalar(prop(node, 'value', ''))))
    const delta = prop(node, 'delta')
    if (delta) {
      const trend = prop(node, 'trend', 'flat')
      const row = h('div', `ui-stat-delta trend-${trend}`)
      row.textContent = `${trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} ${delta}`
      box.append(row)
    }
    if (prop(node, 'hint')) box.append(h('div', 'ui-stat-hint', String(prop(node, 'hint'))))
    return box
  }

  function renderProgress(node) {
    const box = h('div', 'ui-progress')
    if (prop(node, 'label')) box.append(h('div', 'ui-progress-label', String(prop(node, 'label'))))
    const max = Math.max(1, num(prop(node, 'max', 100), 100))
    const value = clamp(num(prop(node, 'value', 0)), 0, max)
    const track = h('div', 'ui-progress-track')
    const fill = h('div', `ui-progress-fill${tone(prop(node, 'tone'))}`)
    fill.style.width = `${(value / max) * 100}%`
    track.append(fill)
    box.append(track)
    return box
  }

  function renderList(node) {
    const list = h(prop(node, 'ordered') ? 'ol' : 'ul', 'ui-list')
    for (const item of prop(node, 'items', []) || []) {
      const li = h('li')
      li.innerHTML = inlineMarkdown(String(item))
      list.append(li)
    }
    return list
  }

  function renderDivider() { return h('hr', 'ui-divider') }

  /* ------------------------------------------------------------------ *
   * table
   * ------------------------------------------------------------------ */
  function columnType(rows, index, declared) {
    if (declared) return declared === 'string' ? 'text' : declared
    let numbers = 0, dates = 0, booleans = 0, filled = 0
    for (const row of rows.slice(0, 50)) {
      const value = row[index]
      if (value === null || value === undefined || value === '') continue
      filled++
      const text = String(value)
      if (/^-?\d+(\.\d+)?$/.test(text)) numbers++
      else if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(text)) dates++
      else if (/^(true|false)$/i.test(text)) booleans++
    }
    if (!filled) return 'text'
    if (numbers === filled) return 'number'
    if (dates === filled) return 'date'
    if (booleans === filled) return 'boolean'
    return 'text'
  }

  function typedValue(value, type) {
    if (value === null || value === undefined || value === '') return null
    if (type === 'number') { const n = Number(value); return Number.isFinite(n) ? n : null }
    if (type === 'date') { const t = Date.parse(String(value)); return Number.isFinite(t) ? t : null }
    if (type === 'boolean') return /^(true|1|yes)$/i.test(String(value)) ? 1 : 0
    return String(value).toLowerCase()
  }

  function renderTable(node) {
    const box = h('div', 'ui-table-wrap')
    const declared = prop(node, 'columnTypes', null)
    const rows = Array.isArray(prop(node, 'rows', null)) ? prop(node, 'rows', []) : null
    const columns = prop(node, 'columns', null)
    if (!rows) {
      const note = h('div', 'ui-empty', '这个表格使用了宿主 dataRef；侧边栏没有共享数据，改为显示提示。')
      box.append(note)
      return box
    }
    const headers = Array.isArray(columns) && columns.length
      ? columns.map(String)
      : (rows[0] || []).map((_, index) => `列 ${index + 1}`)
    if (!rows.length) { box.append(h('div', 'ui-empty', '（空表格）')); return box }
    const types = headers.map((_, index) => columnType(rows, index, declared?.[index]))
    const sortable = prop(node, 'sortable') === true
    const searchable = prop(node, 'searchable') === true
    const pageSize = Math.min(num(prop(node, 'pageSize', 0), 0), 100)
    const view = { sortCol: -1, sortDir: 1, query: '', page: 0 }

    if (searchable) {
      const search = h('input', 'ui-table-search')
      search.placeholder = '搜索…'
      search.addEventListener('input', () => { view.query = search.value.toLowerCase(); view.page = 0; paint() })
      box.append(search)
    }
    const table = h('table', 'ui-table')
    const thead = h('thead')
    const headRow = h('tr')
    headers.forEach((label, index) => {
      const th = h('th', sortable ? 'sortable' : '', label)
      if (sortable) {
        th.addEventListener('click', () => {
          if (view.sortCol === index) view.sortDir *= -1
          else { view.sortCol = index; view.sortDir = 1 }
          paint()
        })
      }
      headRow.append(th)
    })
    thead.append(headRow)
    table.append(thead)
    const tbody = h('tbody')
    table.append(tbody)
    box.append(table)
    if (prop(node, 'caption')) box.append(h('div', 'ui-caption', String(prop(node, 'caption'))))

    let pager = null
    if (pageSize) {
      pager = h('div', 'ui-pager')
      const prev = h('button', 'ui-mini-btn', '上一页')
      const next = h('button', 'ui-mini-btn', '下一页')
      const info = h('span', 'ui-pager-info')
      prev.addEventListener('click', () => { view.page = Math.max(0, view.page - 1); paint() })
      next.addEventListener('click', () => { view.page += 1; paint() })
      pager.append(prev, info, next)
      box.append(pager)
    }
    if (prop(node, 'exportable')) {
      const exportBtn = h('button', 'ui-mini-btn', '导出 CSV')
      exportBtn.addEventListener('click', () => {
        const csv = [headers, ...visibleRows()].map((row) => row.map((cell) => `"${scalar(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
        const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
        const a = h('a')
        a.href = url
        a.download = 'table.csv'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      })
      box.append(exportBtn)
    }

    function visibleRows() {
      let data = rows.slice()
      if (view.query) data = data.filter((row) => row.some((cell) => scalar(cell).toLowerCase().includes(view.query)))
      if (view.sortCol >= 0) {
        const type = types[view.sortCol]
        data.sort((a, b) => {
          const av = typedValue(a[view.sortCol], type)
          const bv = typedValue(b[view.sortCol], type)
          if (av === null && bv === null) return 0
          if (av === null) return 1
          if (bv === null) return -1
          return (av < bv ? -1 : av > bv ? 1 : 0) * view.sortDir
        })
      }
      return data
    }

    function paint() {
      const data = visibleRows()
      const start = pageSize ? view.page * pageSize : 0
      const pageRows = pageSize ? data.slice(start, start + pageSize) : data
      tbody.textContent = ''
      for (const row of pageRows) {
        const tr = h('tr')
        headers.forEach((_, index) => tr.append(h('td', '', scalar(row[index]))))
        tbody.append(tr)
      }
      if (pager) {
        pager.querySelector('.ui-pager-info').textContent = `${data.length ? start + 1 : 0}–${Math.min(start + pageSize, data.length)} / ${data.length}`
        pager.querySelectorAll('button')[0].disabled = view.page === 0
        pager.querySelectorAll('button')[1].disabled = start + pageSize >= data.length
      }
      thead.querySelectorAll('th').forEach((th, index) => {
        th.classList.toggle('sorted', index === view.sortCol)
        th.dataset.dir = index === view.sortCol ? (view.sortDir > 0 ? 'asc' : 'desc') : ''
      })
    }
    paint()
    return box
  }

  /* ------------------------------------------------------------------ *
   * charts
   * ------------------------------------------------------------------ */
  function niceMax(max) {
    if (!Number.isFinite(max) || max <= 0) return 1
    const power = Math.pow(10, Math.floor(Math.log10(max)))
    const scaled = max / power
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
    return step * power
  }

  function chartFrame(node, draw) {
    const box = h('div', 'ui-chart')
    if (prop(node, 'title')) box.append(h('div', 'ui-chart-title', String(prop(node, 'title'))))
    const height = clamp(num(prop(node, 'height', 180), 180), 120, 380)
    const width = 340
    const canvas = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': String(prop(node, 'title', 'chart')) })
    canvas.classList.add('ui-chart-svg')
    draw(canvas, width, height)
    box.append(canvas)
    return box
  }

  function drawAxes(canvas, width, height, pad, max, min, labels) {
    const innerW = width - pad.l - pad.r
    const innerH = height - pad.t - pad.b
    for (let i = 0; i <= 4; i++) {
      const value = min + ((max - min) * i) / 4
      const y = pad.t + innerH * (1 - i / 4)
      const line = svg('line', { x1: pad.l, y1: y, x2: width - pad.r, y2: y, class: 'ui-grid-line' })
      canvas.append(line)
      const label = svg('text', { x: pad.l - 5, y: y + 3, 'text-anchor': 'end', class: 'ui-axis-label' })
      label.textContent = compact(value)
      canvas.append(label)
    }
    if (labels?.length) {
      const stride = Math.max(1, Math.ceil(labels.length / 6))
      labels.forEach((label, index) => {
        if (index % stride !== 0 && index !== labels.length - 1) return
        const x = pad.l + (labels.length === 1 ? innerW / 2 : (innerW * index) / (labels.length - 1))
        const text = svg('text', { x, y: height - pad.b + 14, 'text-anchor': 'middle', class: 'ui-axis-label' })
        text.textContent = scalar(label).slice(0, 10)
        canvas.append(text)
      })
    }
  }

  function renderChart(node) {
    const kind = prop(node, 'kind', 'bar')
    const labels = prop(node, 'labels', []) || []
    const series = (prop(node, 'series', []) || []).filter((entry) => entry && Array.isArray(entry.values))
    if (!series.length) return fallback(node, '没有 series 数据（dataRef 在侧边栏不可用）。')
    if (kind === 'pie') {
      return chartFrame(node, (canvas, width, height) => {
        const values = series[0].values.map((value) => Math.max(0, num(value)))
        const total = values.reduce((sum, value) => sum + value, 0) || 1
        const cx = width / 2, cy = height / 2 - 8, radius = Math.min(width, height) / 2 - 32
        let angle = -Math.PI / 2
        values.forEach((value, index) => {
          const next = angle + (value / total) * Math.PI * 2
          const large = next - angle > Math.PI ? 1 : 0
          const path = svg('path', {
            d: `M ${cx} ${cy} L ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} A ${radius} ${radius} 0 ${large} 1 ${cx + radius * Math.cos(next)} ${cy + radius * Math.sin(next)} Z`,
            fill: PALETTE[index % PALETTE.length],
            opacity: 0.9,
          })
          const sliceTitle = svg('title')
          sliceTitle.textContent = `${scalar(labels[index] ?? index)}: ${value}`
          path.append(sliceTitle)
          canvas.append(path)
          angle = next
        })
        canvas.append(svg('circle', { cx, cy, r: radius * 0.52, fill: 'var(--bg)' }))
        const legend = h('div', 'ui-legend')
        labels.forEach((label, index) => {
          const item = h('span', 'ui-legend-item')
          const dot = h('i', 'ui-legend-dot')
          dot.style.background = PALETTE[index % PALETTE.length]
          item.append(dot, h('span', '', scalar(label)))
          legend.append(item)
        })
        canvas.closest('.ui-chart')?.append(legend)
      })
    }

    return chartFrame(node, (canvas, width, height) => {
      const pad = { l: 34, r: 10, t: 14, b: 26 }
      const innerW = width - pad.l - pad.r
      const innerH = height - pad.t - pad.b
      const stacked = prop(node, 'stacked') === true && kind === 'bar'
      const all = series.flatMap((entry) => entry.values.map((value) => num(value)))
      const min = Math.min(0, ...all)
      const max = niceMax(Math.max(0, ...all, stacked ? Math.max(...labels.map((_, index) => series.reduce((sum, entry) => sum + Math.max(0, num(entry.values[index])), 0))) : 0))
      drawAxes(canvas, width, height, pad, max, min, labels)
      const x = (index) => pad.l + (labels.length <= 1 ? innerW / 2 : (innerW * index) / Math.max(1, labels.length - 1))
      const y = (value) => pad.t + innerH * (1 - (value - min) / (max - min || 1))
      const baseline = y(0)
      if (kind === 'bar') {
        const group = innerW / Math.max(1, labels.length)
        const barWidth = Math.max(2, (group * 0.68) / (stacked ? 1 : series.length))
        labels.forEach((_, index) => {
          let stack = 0
          series.forEach((entry, si) => {
            const value = num(entry.values[index])
            const heightValue = Math.abs(y(value) - y(stack))
            const rect = svg('rect', {
              x: pad.l + group * index + group * 0.16 + (stacked ? 0 : si * barWidth),
              y: y(value + stack) + (value < 0 ? heightValue : 0),
              width: barWidth,
              height: Math.max(1, heightValue),
              rx: 2,
              fill: PALETTE[si % PALETTE.length],
              opacity: 0.9,
            })
            const barTitle = svg('title')
            barTitle.textContent = `${entry.name} · ${scalar(labels[index])}: ${value}`
            rect.append(barTitle)
            canvas.append(rect)
            stack += value
          })
        })
      } else {
        series.forEach((entry, si) => {
          const color = PALETTE[si % PALETTE.length]
          const points = entry.values.map((value, index) => [x(index), y(num(value))])
          if (kind === 'area') {
            const area = svg('path', {
              d: `M ${points[0]?.[0] ?? pad.l} ${baseline} ${points.map(([px, py]) => `L ${px} ${py}`).join(' ')} L ${points.at(-1)?.[0] ?? width - pad.r} ${baseline} Z`,
              fill: color,
              opacity: 0.14,
            })
            canvas.append(area)
          }
          const path = svg('path', {
            d: points.map(([px, py], index) => `${index ? 'L' : 'M'} ${px} ${py}`).join(' '),
            'stroke-width': 2,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          })
          // Presentation attributes lose to the panel's `svg path { stroke:none }`
          // reset, so set the series color as an inline style.
          path.style.stroke = color
          path.style.fill = 'none'
          canvas.append(path)
          points.forEach(([px, py], index) => {
            const dot = svg('circle', { cx: px, cy: py, r: 2.6, fill: color })
            const dotTitle = svg('title')
            dotTitle.textContent = `${entry.name} · ${scalar(labels[index])}: ${entry.values[index]}`
            dot.append(dotTitle)
            canvas.append(dot)
          })
        })
      }
      const legend = h('div', 'ui-legend')
      series.forEach((entry, index) => {
        const item = h('span', 'ui-legend-item')
        const dot = h('i', 'ui-legend-dot')
        dot.style.background = PALETTE[index % PALETTE.length]
        item.append(dot, h('span', '', entry.name))
        legend.append(item)
      })
      if (prop(node, 'unit')) legend.append(h('span', 'ui-legend-unit', String(prop(node, 'unit'))))
      canvas.closest('.ui-chart')?.append(legend)
    })
  }

  function renderScatter(node) {
    const allSeries = (prop(node, 'series', []) || []).filter((entry) => entry && Array.isArray(entry.points))
    if (!allSeries.length) return fallback(node, '没有散点数据。')
    return chartFrame(node, (canvas, width, height) => {
      const pad = { l: 34, r: 10, t: 14, b: 26 }
      const innerW = width - pad.l - pad.r
      const innerH = height - pad.t - pad.b
      const points = allSeries.flatMap((entry) => entry.points).filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
      if (!points.length) return
      const xs = points.map((point) => Number(point.x))
      const ys = points.map((point) => Number(point.y))
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const sx = (value) => pad.l + ((value - minX) / (maxX - minX || 1)) * innerW
      const sy = (value) => pad.t + innerH * (1 - (value - minY) / (maxY - minY || 1))
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + innerH * (i / 4)
        canvas.append(svg('line', { x1: pad.l, y1: y, x2: width - pad.r, y2: y, class: 'ui-grid-line' }))
        const label = svg('text', { x: pad.l - 5, y: y + 3, 'text-anchor': 'end', class: 'ui-axis-label' })
        label.textContent = compact(minY + ((maxY - minY) * (4 - i)) / 4)
        canvas.append(label)
      }
      const legend = h('div', 'ui-legend')
      allSeries.forEach((entry, si) => {
        const color = PALETTE[si % PALETTE.length]
        entry.points.forEach((point) => {
          if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return
          const dot = svg('circle', { cx: sx(Number(point.x)), cy: sy(Number(point.y)), r: 3, fill: color, opacity: 0.85 })
          const pointTitle = svg('title')
          pointTitle.textContent = point.label ? `${entry.name} · ${point.label} (${point.x}, ${point.y})` : `${entry.name} (${point.x}, ${point.y})`
          dot.append(pointTitle)
          canvas.append(dot)
        })
        const item = h('span', 'ui-legend-item')
        const dot = h('i', 'ui-legend-dot')
        dot.style.background = color
        item.append(dot, h('span', '', entry.name))
        legend.append(item)
      })
      canvas.closest('.ui-chart')?.append(legend)
    })
  }

  function renderHeatmap(node) {
    const xLabels = prop(node, 'xLabels', []) || []
    const yLabels = prop(node, 'yLabels', []) || []
    const values = prop(node, 'values', []) || []
    if (!xLabels.length || !yLabels.length || !values.length) return fallback(node, '没有热力数据。')
    const flat = values.flat().filter((value) => value !== null && Number.isFinite(Number(value))).map(Number)
    const min = prop(node, 'min', Math.min(...flat))
    const max = prop(node, 'max', Math.max(...flat))
    const diverging = prop(node, 'scale') === 'diverging'
    const box = h('div', 'ui-heatmap')
    if (prop(node, 'title')) box.append(h('div', 'ui-chart-title', String(prop(node, 'title'))))
    const table = h('table', 'ui-heat-table')
    const head = h('tr')
    head.append(h('th', '', ''))
    for (const label of xLabels) head.append(h('th', '', scalar(label)))
    table.append(head)
    values.forEach((row, ri) => {
      const tr = h('tr')
      tr.append(h('th', '', scalar(yLabels[ri] ?? ri)))
      xLabels.forEach((_, ci) => {
        const value = row?.[ci]
        const cell = h('td')
        if (value === null || value === undefined) {
          cell.textContent = '—'
          cell.classList.add('missing')
        } else {
          const t = (Number(value) - min) / (max - min || 1)
          cell.style.background = diverging
            ? `color-mix(in srgb, ${Number(value) < 0 ? 'var(--red)' : 'var(--accent)'} ${Math.round(Math.abs(t - 0.5) * 180)}%, transparent)`
            : `color-mix(in srgb, var(--accent) ${Math.round(clamp(t, 0, 1) * 85)}%, transparent)`
          cell.textContent = prop(node, 'showValues') ? scalar(value) : ''
          cell.title = `${scalar(yLabels[ri] ?? ri)} × ${scalar(xLabels[ci] ?? ci)}: ${value}${prop(node, 'unit') ? ` ${prop(node, 'unit')}` : ''}`
        }
        tr.append(cell)
      })
      table.append(tr)
    })
    box.append(table)
    return box
  }

  /* ------------------------------------------------------------------ *
   * structures
   * ------------------------------------------------------------------ */
  function renderTimeline(node) {
    const box = h('div', 'ui-timeline')
    for (const item of prop(node, 'items', []) || []) {
      const row = h('div', `ui-timeline-item${tone(item.tone)}`)
      row.append(h('div', 'ui-timeline-dot'))
      const body = h('div', 'ui-timeline-body')
      const head = h('div', 'ui-timeline-head')
      head.append(h('span', 'ui-timeline-title', String(item.title ?? '')))
      if (item.time) head.append(h('span', 'ui-timeline-time', String(item.time)))
      body.append(head)
      if (item.text) {
        const text = h('div', 'ui-timeline-text')
        text.innerHTML = inlineMarkdown(String(item.text))
        body.append(text)
      }
      row.append(body)
      box.append(row)
    }
    return box
  }

  function renderJson(node) {
    const box = h('div', 'ui-json')
    if (prop(node, 'title')) box.append(h('div', 'ui-caption', String(prop(node, 'title'))))
    const pre = h('pre', 'ui-code')
    pre.textContent = JSON.stringify(prop(node, 'data', null), null, 2)
    const copy = h('button', 'copy-code', '复制')
    copy.dataset.copy = '1'
    pre.append(copy)
    box.append(pre)
    return box
  }

  function renderFileTree(node) {
    const box = h('div', 'ui-filetree')
    if (prop(node, 'title')) box.append(h('div', 'ui-caption', String(prop(node, 'title'))))
    const root = { dirs: new Map(), files: [] }
    for (const entry of prop(node, 'entries', []) || []) {
      const parts = String(entry.path ?? '').split('/').filter(Boolean)
      if (!parts.length) continue
      let cursor = root
      for (const part of parts.slice(0, -1)) {
        if (!cursor.dirs.has(part)) cursor.dirs.set(part, { dirs: new Map(), files: [] })
        cursor = cursor.dirs.get(part)
      }
      cursor.files.push({ name: parts.at(-1), status: entry.status, note: entry.note })
    }
    const list = h('ul', 'ui-tree')
    const paint = (dir, parent) => {
      for (const [name, child] of dir.dirs) {
        const li = h('li')
        const label = h('span', 'ui-tree-dir', `📁 ${name}`)
        li.append(label)
        const sub = h('ul', 'ui-tree')
        paint(child, sub)
        li.append(sub)
        parent.append(li)
      }
      for (const file of dir.files) {
        const li = h('li')
        const label = h('span', 'ui-tree-file', `📄 ${file.name}`)
        li.append(label)
        if (file.status) li.append(h('span', `ui-tree-status status-${file.status}`, file.status))
        if (file.note) li.append(h('span', 'ui-tree-note', file.note))
        parent.append(li)
      }
    }
    paint(root, list)
    box.append(list)
    return box
  }

  function lineDiff(before, after) {
    const a = String(before).split('\n')
    const b = String(after).split('\n')
    if (a.length * b.length > 160000) return null
    const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    const out = []
    let i = 0, j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++ }
      else { out.push({ type: 'add', text: b[j] }); j++ }
    }
    while (i < a.length) out.push({ type: 'del', text: a[i++] })
    while (j < b.length) out.push({ type: 'add', text: b[j++] })
    return out
  }

  function renderCodeDiff(node) {
    const box = h('div', 'ui-diff')
    if (prop(node, 'title')) box.append(h('div', 'ui-caption', String(prop(node, 'title'))))
    for (const file of prop(node, 'files', []) || []) {
      const section = h('div', 'ui-diff-file')
      section.append(h('div', 'ui-diff-path', String(file.path ?? '')))
      let lines = null
      if (typeof file.patch === 'string') {
        lines = file.patch.split('\n').map((text) => ({
          type: text.startsWith('+') && !text.startsWith('+++') ? 'add' : text.startsWith('-') && !text.startsWith('---') ? 'del' : 'same',
          text,
        }))
      } else if (typeof file.before === 'string' || typeof file.after === 'string') {
        lines = lineDiff(file.before ?? '', file.after ?? '')
      }
      if (!lines) {
        section.append(h('div', 'ui-empty', '文件太大，无法在侧边栏内计算 diff。'))
      } else {
        const pre = h('pre', 'ui-code ui-diff-code')
        for (const line of lines) {
          const row = h('div', `ui-diff-line ${line.type}`)
          row.textContent = `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '} ${line.text}`
          pre.append(row)
        }
        section.append(pre)
      }
      box.append(section)
    }
    return box
  }

  function renderImage(node) {
    const src = safeUrl(prop(node, 'src'))
    const figure = h('figure', 'ui-image')
    if (!src) {
      figure.append(h('div', 'ui-empty', '图片地址不是 https，未加载。'))
      return figure
    }
    const img = h('img')
    img.src = src
    img.alt = String(prop(node, 'alt', ''))
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    if (prop(node, 'height')) img.style.height = `${num(prop(node, 'height'), 200)}px`
    img.style.objectFit = prop(node, 'fit', 'cover')
    img.addEventListener('error', () => { img.replaceWith(h('div', 'ui-empty', '图片加载失败')) })
    figure.append(img)
    if (prop(node, 'caption')) figure.append(h('figcaption', '', String(prop(node, 'caption'))))
    if (prop(node, 'credit')) {
      const credit = h('figcaption', 'ui-credit')
      if (safeUrl(prop(node, 'creditUrl'))) {
        const link = h('a', '', String(prop(node, 'credit')))
        link.href = safeUrl(prop(node, 'creditUrl'))
        link.target = '_blank'
        link.rel = 'noreferrer'
        credit.append(link)
      } else credit.textContent = String(prop(node, 'credit'))
      figure.append(credit)
    }
    return figure
  }

  function renderGallery(node) {
    const box = h('div', 'ui-gallery')
    if (prop(node, 'title')) box.append(h('div', 'ui-caption', String(prop(node, 'title'))))
    const grid = h('div', 'ui-gallery-grid')
    grid.style.gridTemplateColumns = `repeat(${clamp(num(prop(node, 'columns', 2), 2), 1, 6)}, minmax(0,1fr))`
    for (const image of prop(node, 'images', []) || []) {
      const src = safeUrl(image.src)
      if (!src) continue
      const a = h('a', 'ui-gallery-item')
      a.href = src
      a.target = '_blank'
      a.rel = 'noreferrer'
      const img = h('img')
      img.src = src
      img.alt = String(image.alt ?? '')
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      a.append(img)
      if (image.caption) a.append(h('span', 'ui-gallery-caption', String(image.caption)))
      grid.append(a)
    }
    box.append(grid)
    return box
  }

  function videoEmbed(src) {
    try {
      const url = new URL(src)
      if (/youtube\.com$/.test(url.hostname) || /youtu\.be$/.test(url.hostname)) {
        const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v')
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : null
      }
      if (/bilibili\.com$/.test(url.hostname)) {
        const bv = url.pathname.match(/(BV[\w]+)/)?.[1]
        return bv ? `https://player.bilibili.com/player.html?bvid=${bv}&autoplay=0` : null
      }
      if (/vimeo\.com$/.test(url.hostname)) {
        const id = url.pathname.split('/').filter(Boolean)[0]
        return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : null
      }
    } catch { /* not a page URL */ }
    return null
  }

  function renderVideo(node) {
    const src = safeUrl(prop(node, 'src'))
    const box = h('div', 'ui-video')
    if (!src) { box.append(h('div', 'ui-empty', '视频地址不是 https，未加载。')); return box }
    const embed = videoEmbed(src)
    if (embed) {
      const frame = h('iframe', 'ui-video-frame')
      frame.src = embed
      frame.loading = 'lazy'
      frame.allow = 'accelerometer; encrypted-media; picture-in-picture'
      frame.referrerPolicy = 'no-referrer'
      box.append(frame)
    } else if (/\.(mp4|webm)(\?|$)/i.test(src)) {
      const video = h('video', 'ui-video-frame')
      video.src = src
      video.controls = true
      if (prop(node, 'poster')) video.poster = safeUrl(prop(node, 'poster')) ?? ''
      box.append(video)
    } else {
      const link = h('a', 'ui-link', String(prop(node, 'title', src)))
      link.href = src
      link.target = '_blank'
      link.rel = 'noreferrer'
      box.append(link)
    }
    if (prop(node, 'caption')) box.append(h('div', 'ui-caption', String(prop(node, 'caption'))))
    return box
  }

  /* ------------------------------------------------------------------ *
   * interaction components
   * ------------------------------------------------------------------ */
  function renderChoice(node, opts) {
    const box = h('div', 'ui-choice')
    box.append(h('div', 'ui-choice-question', String(prop(node, 'question', '选择一项'))))
    const options = (prop(node, 'options', []) || []).slice(0, 8)
    const recommended = prop(node, 'recommended')
    let selected = options.find((option) => option.id === recommended)?.id ?? options[0]?.id
    const list = h('div', 'ui-choice-options')
    options.forEach((option) => {
      const item = h('button', 'ui-choice-option')
      item.type = 'button'
      const dot = h('span', 'ui-choice-dot')
      const body = h('span', 'ui-choice-body')
      body.append(h('span', 'ui-choice-label', String(option.label ?? '')))
      if (option.description) body.append(h('span', 'ui-choice-desc', String(option.description)))
      item.append(dot, body)
      if (option.id === recommended) item.append(h('span', 'ui-choice-rec', '推荐'))
      item.addEventListener('click', () => {
        selected = option.id
        list.querySelectorAll('.ui-choice-option').forEach((el) => el.classList.toggle('selected', el === item))
      })
      item.classList.toggle('selected', option.id === selected)
      list.append(item)
    })
    box.append(list)
    const submit = h('button', 'ui-btn primary', String(prop(node, 'submitLabel', '继续')))
    submit.addEventListener('click', () => {
      const option = options.find((entry) => entry.id === selected)
      if (!option) return
      submit.disabled = true
      if (prop(node, 'sessionTarget') === 'new' && opts.sendNew) opts.sendNew(option.prompt)
      else opts.send(option.prompt)
    })
    box.append(submit)
    return box
  }

  function renderButton(node, opts) {
    const button = h('button', `ui-btn ${prop(node, 'variant', 'primary')}`, String(prop(node, 'label', '按钮')))
    button.type = 'button'
    button.addEventListener('click', () => {
      if (prop(node, 'prompt')) {
        button.disabled = true
        const text = String(prop(node, 'prompt'))
        if (prop(node, 'sessionTarget') === 'new' && opts.sendNew) opts.sendNew(text)
        else opts.send(text)
      } else {
        opts.toast?.('这个动作按钮在侧边栏里不可用')
      }
    })
    return button
  }

  function renderForm(node, opts) {
    const box = h('form', 'ui-form')
    box.addEventListener('submit', (event) => event.preventDefault())
    if (prop(node, 'title')) box.append(h('div', 'ui-caption', String(prop(node, 'title'))))
    const fields = (prop(node, 'fields', []) || []).slice(0, 40)
    const inputs = new Map()
    for (const field of fields) {
      const wrap = h('label', 'ui-field')
      wrap.append(h('span', 'ui-field-label', String(field.label ?? field.name ?? '')))
      let input
      const type = field.type || 'text'
      if (type === 'textarea') input = h('textarea', 'ui-input')
      else if (type === 'select') {
        input = h('select', 'ui-input')
        for (const option of field.options || []) {
          const opt = h('option', '', String(option))
          opt.value = String(option)
          input.append(opt)
        }
      } else if (type === 'checkbox') {
        input = h('input', 'ui-checkbox')
        input.type = 'checkbox'
      } else {
        input = h('input', 'ui-input')
        input.type = ['number', 'range', 'date'].includes(type) ? type : 'text'
        if (field.min !== undefined) input.min = field.min
        if (field.max !== undefined) input.max = field.max
        if (field.step !== undefined) input.step = field.step
      }
      if (field.placeholder) input.placeholder = field.placeholder
      if (field.required) input.required = true
      if (field.default !== undefined && type !== 'checkbox') input.value = field.default
      if (type === 'checkbox') input.checked = field.default === true
      inputs.set(field.name, { field, input, type })
      wrap.append(input)
      box.append(wrap)
    }
    const submit = h('button', 'ui-btn primary', String(prop(node, 'submitLabel', '提交')))
    submit.type = 'submit'
    submit.addEventListener('click', (event) => {
      event.preventDefault()
      const values = []
      for (const [name, { field, input, type }] of inputs) {
        let value
        if (type === 'checkbox') value = input.checked
        else value = input.value
        if (field.required && (value === '' || value === false)) { input.focus(); opts.toast?.('请填写必填项'); return }
        values.push(`${field.label ?? name}：${scalar(value)}`)
      }
      submit.disabled = true
      const text = [prop(node, 'prompt', ''), ...values].filter(Boolean).join('\n')
      if (prop(node, 'sessionTarget') === 'new' && opts.sendNew) opts.sendNew(text)
      else opts.send(text)
    })
    box.append(submit)
    return box
  }

  /* ------------------------------------------------------------------ *
   * catalog tree
   * ------------------------------------------------------------------ */
  function renderCatalog(tree, opts = {}) {
    const host = h('div', 'ui-catalog')
    if (!tree || typeof tree !== 'object' || !Array.isArray(tree.components) || typeof tree.root !== 'string') {
      host.append(h('div', 'ui-empty', 'UI 数据不完整，无法渲染。'))
      return host
    }
    const nodes = new Map()
    for (const node of tree.components) {
      if (node && typeof node.id === 'string' && !nodes.has(node.id)) nodes.set(node.id, node)
    }
    if (!nodes.has(tree.root)) {
      host.append(h('div', 'ui-empty', `找不到根组件 ${tree.root}。`))
      return host
    }

    const renderNode = (id, stack) => {
      const node = nodes.get(id)
      if (!node) return null
      if (stack.has(id)) return h('div', 'ui-empty', '组件循环引用')
      if (stack.size > 40) return h('div', 'ui-empty', '组件层级过深')
      const nextStack = new Set(stack).add(id)
      const kids = () => (node.children || []).map((childId) => renderNode(childId, nextStack)).filter(Boolean)

      switch (node.type) {
        case 'Card': {
          const card = h('section', 'ui-card')
          if (prop(node, 'title') || prop(node, 'subtitle')) {
            const header = h('div', 'ui-card-head')
            if (prop(node, 'title')) header.append(h('div', 'ui-card-title', String(prop(node, 'title'))))
            if (prop(node, 'subtitle')) header.append(h('div', 'ui-card-subtitle', String(prop(node, 'subtitle'))))
            card.append(header)
          }
          const body = h('div', 'ui-card-body')
          for (const child of kids()) body.append(child)
          card.append(body)
          if (prop(node, 'footer')) card.append(h('div', 'ui-card-footer', String(prop(node, 'footer'))))
          return card
        }
        case 'Stack': {
          const stack = h('div', `ui-stack${prop(node, 'direction') === 'horizontal' ? ' horizontal' : ''}`)
          stack.style.gap = `${clamp(num(prop(node, 'gap', 8), 8), 0, 64)}px`
          if (prop(node, 'wrap')) stack.style.flexWrap = 'wrap'
          stack.style.alignItems = prop(node, 'align', 'stretch')
          for (const child of kids()) stack.append(child)
          return stack
        }
        case 'Grid': {
          const grid = h('div', 'ui-grid')
          grid.style.gridTemplateColumns = `repeat(${clamp(num(prop(node, 'columns', 2), 2), 1, 6)}, minmax(0, 1fr))`
          for (const child of kids()) grid.append(child)
          return grid
        }
        case 'Tabs': {
          const tabs = h('div', 'ui-tabs')
          const labels = prop(node, 'labels', []) || []
          const panels = kids()
          const bar = h('div', 'ui-tabbar')
          const panelWrap = h('div', 'ui-tabpanels')
          const activate = (index) => {
            bar.querySelectorAll('.ui-tab').forEach((el, i) => el.classList.toggle('active', i === index))
            panelWrap.querySelectorAll('.ui-tabpanel').forEach((el, i) => { el.hidden = i !== index })
          }
          panels.forEach((panel, index) => {
            const button = h('button', 'ui-tab', String(labels[index] ?? `标签 ${index + 1}`))
            button.type = 'button'
            button.addEventListener('click', () => activate(index))
            bar.append(button)
            const wrap = h('div', 'ui-tabpanel')
            wrap.append(panel)
            wrap.hidden = index !== 0
            panelWrap.append(wrap)
          })
          tabs.append(bar, panelWrap)
          return tabs
        }
        case 'Text': return renderText(node)
        case 'Code': return renderCode(node)
        case 'Alert': return renderAlert(node)
        case 'Badge': return renderBadge(node)
        case 'Divider': return renderDivider()
        case 'Stat': return renderStat(node)
        case 'Progress': return renderProgress(node)
        case 'List': return renderList(node)
        case 'Table': return renderTable(node)
        case 'Chart': return renderChart(node)
        case 'Scatter': return renderScatter(node)
        case 'Heatmap': return renderHeatmap(node)
        case 'Timeline': return renderTimeline(node)
        case 'JsonView': return renderJson(node)
        case 'FileTree': return renderFileTree(node)
        case 'CodeDiff': return renderCodeDiff(node)
        case 'Image': return renderImage(node)
        case 'Gallery': return renderGallery(node)
        case 'Video': return renderVideo(node)
        case 'Choice': return renderChoice(node, opts)
        case 'Button': return renderButton(node, opts)
        case 'Form': return renderForm(node, opts)
        case 'Math': {
          const box = h('div', 'ui-math')
          box.append(h('div', 'ui-math-note', '公式（侧边栏暂未内置 KaTeX）'))
          box.append(h('pre', 'ui-code', String(prop(node, 'tex', ''))))
          return box
        }
        case 'Mermaid': {
          const box = h('div', 'ui-mermaid')
          box.append(h('div', 'ui-caption', 'Mermaid 图（侧边栏暂未渲染，保留源码）'))
          const pre = h('pre', 'ui-code')
          pre.textContent = String(prop(node, 'code', ''))
          box.append(pre)
          return box
        }
        case 'Map': {
          const box = h('div', 'ui-map')
          box.append(h('div', 'ui-caption', '地点（地图底图暂未内置）'))
          for (const marker of prop(node, 'markers', []) || []) {
            const row = h('div', 'ui-map-row')
            row.append(h('span', 'ui-map-name', String(marker.label ?? marker.id ?? '')))
            row.append(h('span', 'ui-map-coord', `${num(marker.lat).toFixed(3)}, ${num(marker.lon).toFixed(3)}`))
            if (marker.note) row.append(h('span', 'ui-map-note', String(marker.note)))
            box.append(row)
          }
          return box
        }
        case 'Plot': {
          const box = h('div', 'ui-plot')
          box.append(h('div', 'ui-caption', '函数图（侧边栏暂未内置 Plot 渲染）'))
          for (const fn of prop(node, 'functions', []) || []) box.append(h('pre', 'ui-code', String(fn.expr ?? '')))
          return box
        }
        default:
          return fallback(node)
      }
    }

    const rootNode = nodes.get(tree.root)
    if (tree.title && rootNode?.type !== 'Card') host.append(h('div', 'ui-block-title', String(tree.title)))
    const root = renderNode(tree.root, new Set())
    if (root) host.append(root)
    return host
  }

  function renderCompose(blocks, opts = {}) {
    const frag = document.createDocumentFragment()
    for (const block of blocks || []) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'markdown') {
        const text = h('div', 'part-text')
        text.innerHTML = renderMarkdown(String(block.text ?? ''))
        frag.append(text)
      } else if (block.type === 'catalog') {
        const section = h('section', 'ui-compose-block')
        if (block.title) section.append(h('div', 'ui-block-title', String(block.title)))
        section.append(renderCatalog({ root: block.root, components: block.components, title: null }, opts))
        frag.append(section)
      } else if (block.type === 'widget') {
        const section = h('section', 'ui-compose-block')
        if (block.title) section.append(h('div', 'ui-block-title', String(block.title)))
        section.append(renderWidget(block, opts))
        frag.append(section)
      }
    }
    return frag
  }

  /* ------------------------------------------------------------------ *
   * sandboxed widget (best effort under the extension CSP)
   * ------------------------------------------------------------------ */
  function themeTokens() {
    const style = getComputedStyle(document.documentElement)
    const token = (name) => style.getPropertyValue(name).trim()
    return {
      '--ui-bg': token('--bg'), '--ui-surface': token('--bg-soft'), '--ui-text': token('--text'),
      '--ui-muted': token('--muted'), '--ui-border': token('--border'), '--ui-accent': token('--accent'),
      '--ui-accent-text': token('--accent-ink'), '--ui-success': token('--green'), '--ui-warning': token('--amber'),
      '--ui-error': token('--red'), '--ui-radius': '12px',
      '--ui-font': '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif',
      '--ui-mono': 'ui-monospace,Menlo,monospace',
    }
  }

  function renderWidget(args, opts = {}) {
    const box = h('div', 'ui-widget')
    if (args.title) box.append(h('div', 'ui-block-title', String(args.title)))
    const height = clamp(num(args.initialHeight, 340), 140, 600)
    const frame = h('iframe', 'ui-widget-frame')
    frame.style.height = `${height}px`
    frame.setAttribute('sandbox', 'allow-scripts allow-popups')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    const tokens = Object.entries(themeTokens()).map(([key, value]) => `${key}:${value}`).join(';')
    const code = String(args.jsFunctions ?? '') + '\n' + (Array.isArray(args.jsExpressions) ? args.jsExpressions.join('\n') : '')
    const safeCode = code.replace(/<\/script/gi, '<\\/script')
    const css = String(args.css ?? '')
    const html = String(args.html ?? '')
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh; img-src https: data:; font-src https: data:; connect-src https://esm.sh https://cdn.jsdelivr.net https://unpkg.com;">
<meta name="color-scheme" content="light dark">
<style>
:root{${tokens}}
*{box-sizing:border-box}html,body{margin:0;padding:10px;background:var(--ui-bg);color:var(--ui-text);font:13px/1.55 var(--ui-font)}
.ui-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ui-card{border:1px solid var(--ui-border);border-radius:var(--ui-radius);padding:10px;background:var(--ui-surface)}
.ui-muted{color:var(--ui-muted)}.ui-stage{height:360px}
${css}
</style></head><body>
${html}
<script>
(function(){
  var state = {};
  var theme = { scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
  function token(name){ return getComputedStyle(document.documentElement).getPropertyValue('--ui-' + name).trim() }
  window.UI = {
    state: state,
    setState: function(patch){ Object.assign(state, patch || {}) },
    color: function(name){ return token(name || 'accent') || '#4d6bfe' },
    css: function(name){ return token(name) },
    get scheme(){ return theme.scheme },
    onTheme: function(cb){ try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ theme.scheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; cb && cb() }) } catch(e){} },
    get reducedMotion(){ return matchMedia('(prefers-reduced-motion: reduce)').matches },
    canvas: function(target, draw){ var el = typeof target === 'string' ? document.querySelector(target) : target; if(!el) return { redraw: function(){} }; var ctx = el.getContext('2d'); function redraw(){ var r = el.getBoundingClientRect(); var d = window.devicePixelRatio || 1; el.width = Math.max(1, Math.round(r.width * d)); el.height = Math.max(1, Math.round(r.height * d)); ctx.setTransform(d,0,0,d,0,0); draw(ctx, r.width, r.height) } redraw(); addEventListener('resize', redraw); return { redraw: redraw } },
    three: function(){ return Promise.reject(new Error('three 未内置到此侧边栏')) }
  };
  window.Bridge = {
    sendPrompt: function(message){ var text = message && message.text ? String(message.text) : ''; if(!text) return Promise.resolve(); parent.postMessage({ __dshWidget: true, type: 'prompt', text: text }, '*'); return Promise.resolve() },
    openLink: function(message){ var url = message && message.url ? String(message.url) : ''; if(/^https:/.test(url)) parent.postMessage({ __dshWidget: true, type: 'open', url: url }, '*') }
  };
})();
try { ${safeCode}
} catch (error) { console.error(error); var box = document.createElement('pre'); box.style.cssText = 'color:#e85d75;white-space:pre-wrap;font-size:11px'; box.textContent = 'Widget error: ' + (error && error.message ? error.message : error); document.body.appendChild(box) }
</script></body></html>`
    box.append(frame)
    return box
  }

  window.DSHUI = { renderCatalog, renderCompose, renderWidget }
})()
