export interface MarkdownOptions {
  /** [[slug]] wikilink 的显示标题映射（Wiki 用）；不传则不渲染 wikilink */
  linkTitles?: Record<string, string>
  /** 把 [1] 渲染为引用上标锚点（聊天引用溯源用） */
  citeRefs?: boolean
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderInline(s: string, opts: MarkdownOptions = {}): string {
  let out = s
  if (opts.linkTitles) {
    const titles = opts.linkTitles
    out = out.replace(
      /\[\[([^\]]+)\]\]/g,
      (_m, slug: string) => `<a class="wikilink" data-slug="${slug}">${escapeHtml(titles[slug] ?? slug)}</a>`,
    )
  }
  out = out
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, text: string, url: string) =>
        `<a class="extlink" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
  if (opts.citeRefs) {
    out = out.replace(/\[(\d{1,2})\]/g, '<sup class="cite-ref" data-cite="$1">$1</sup>')
  }
  return out
}

function splitTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
}

export function renderMarkdown(md: string, opts: MarkdownOptions = {}): string {
  const out: string[] = []
  let inCode = false
  let listOpen = false
  let quoteOpen = false
  let tableRows: string[][] = []

  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>')
      listOpen = false
    }
  }
  const closeQuote = (): void => {
    if (quoteOpen) {
      out.push('</blockquote>')
      quoteOpen = false
    }
  }
  const flushTable = (): void => {
    if (tableRows.length === 0) return
    const [head, ...rest] = tableRows
    out.push(`<table><thead><tr>${head.map((c) => `<th>${renderInline(c, opts)}</th>`).join('')}</tr></thead>`)
    out.push(`<tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    tableRows = []
  }
  const closeBlocks = (): void => {
    closeList()
    closeQuote()
    flushTable()
  }

  for (const raw of md.split('\n')) {
    if (raw.startsWith('```')) {
      closeBlocks()
      out.push(inCode ? '</code></pre>' : '<pre><code>')
      inCode = !inCode
      continue
    }
    if (inCode) {
      out.push(escapeHtml(raw))
      continue
    }
    const line = raw.trim()
    if (!line) {
      closeBlocks()
      continue
    }
    if (line.startsWith('|') && line.endsWith('|') && line.length > 2) {
      closeList()
      closeQuote()
      const cells = splitTableRow(line)
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue
      tableRows.push(cells)
      continue
    }
    flushTable()
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      closeQuote()
      const level = heading[1].length + 1
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]), opts)}</h${level}>`)
      continue
    }
    if (line.startsWith('>')) {
      closeList()
      if (!quoteOpen) {
        out.push('<blockquote>')
        quoteOpen = true
      }
      out.push(`<p>${renderInline(escapeHtml(line.replace(/^>\s?/, '')), opts)}</p>`)
      continue
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      closeQuote()
      if (!listOpen) {
        out.push('<ul>')
        listOpen = true
      }
      const item = line.replace(/^([-*]|\d+\.)\s+/, '')
      out.push(`<li>${renderInline(escapeHtml(item), opts)}</li>`)
      continue
    }
    closeList()
    closeQuote()
    out.push(`<p>${renderInline(escapeHtml(line), opts)}</p>`)
  }
  closeBlocks()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}
