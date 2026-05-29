// Simple built-in XSS sanitizer - strips event handlers and script tags
function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*\S+/gi, '')
    .replace(/javascript:/gi, '')
}

export function renderMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Remove code blocks first to protect them from other replacements
  const codeBlocks = []
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length
    const langLabel = lang ? `<span class="mk-code-lang">${lang}</span>` : ''
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    codeBlocks.push(`<div class="mk-code-block">${langLabel}<pre><code>${escapedCode}</code></pre><button class="mk-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent)">Copy</button></div>`)
    return `%%CODEBLOCK_${idx}%%`
  })

  // Remove inline code
  const inlineCodes = []
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const idx = inlineCodes.length
    inlineCodes.push(`<code class="mk-inline-code">${code}</code>`)
    return `%%INLINECODE_${idx}%%`
  })

  // Headings
  html = html
    .replace(/^###### (.+)$/gm, '<h6 class="mk-h6">$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5 class="mk-h5">$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4 class="mk-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="mk-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="mk-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="mk-h1">$1</h1>')

  // Bold/italic/strikethrough
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')

  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // Images and links
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="mk-img" loading="lazy" />')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="mk-link">$1</a>')

  html = html.replace(/^---$/gm, '<hr class="mk-hr" />')

  // Tables - match consecutive |...| lines as a block
  html = html.replace(/(?:^\|.+\|[ \t]*\n?)+/gm, (tableBlock) => {
    const lines = tableBlock.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) return tableBlock // Not a real table

    // Parse each row
    const rows = lines.map(line => {
      const cells = line.split('|').filter((c, i, arr) => i > 0 && i < arr.length - 1 || (i === 0 && c.trim()) || (i === arr.length - 1 && c.trim())).map(c => c.trim())
      // Handle edge: split on | gives empty first/last
      const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      return raw.split('|').map(c => c.trim())
    })

    // Find separator row (all cells are --- or :---: etc)
    let sepIdx = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].every(c => /^:?-+:?$/.test(c))) {
        sepIdx = i
        break
      }
    }

    // If no separator found, treat first row as header
    const headerIdx = sepIdx > 0 ? 0 : (sepIdx === 0 ? -1 : 0)
    const dataStart = sepIdx >= 0 ? sepIdx + 1 : 1

    let result = '<table class="mk-table">'
    if (headerIdx >= 0 && rows[headerIdx]) {
      result += '<thead><tr>'
      for (const cell of rows[headerIdx]) {
        result += `<th class="mk-table-cell">${cell}</th>`
      }
      result += '</tr></thead>'
    }
    if (dataStart < rows.length) {
      result += '<tbody>'
      for (let i = dataStart; i < rows.length; i++) {
        result += '<tr>'
        for (const cell of rows[i]) {
          result += `<td class="mk-table-cell">${cell}</td>`
        }
        result += '</tr>'
      }
      result += '</tbody>'
    }
    result += '</table>'
    return result
  })

  // Blockquotes
  html = html.replace(/^(> .+)$/gm, '<blockquote class="mk-blockquote"><p>$1</p></blockquote>')

  // Lists
  html = html
    .replace(/^\- (.+)$/gm, '<li class="mk-li">$1</li>')
    .replace(/^\* (.+)$/gm, '<li class="mk-li">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="mk-li-ol">$2</li>')

  html = html.replace(/((?:<li class="mk-li">.*<\/li>\n?)+)/g, '<ul class="mk-ul">$1</ul>')
  html = html.replace(/((?:<li class="mk-li-ol">.*<\/li>\n?)+)/g, '<ol class="mk-ol">$1</ol>')

  // Clean up <br> before block elements
  html = html.replace(/<br>\n?<h([1-6])/g, '<h$1')
  html = html.replace(/<br>\n?<ul/g, '<ul')
  html = html.replace(/<br>\n?<ol/g, '<ol')
  html = html.replace(/<br>\n?<hr/g, '<hr')
  html = html.replace(/<br>\n?<blockquote/g, '<blockquote')
  html = html.replace(/<br>\n?<div class="mk-code-block"/g, '<div class="mk-code-block"')
  html = html.replace(/<br>\n?<table/g, '<table')

  html = html.replace(/\n/g, '<br>')

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`%%CODEBLOCK_${i}%%`, codeBlocks[i])
  }
  for (let i = 0; i < inlineCodes.length; i++) {
    html = html.replace(`%%INLINECODE_${i}%%`, inlineCodes[i])
  }

  // Sanitize output to prevent XSS
  return sanitizeHtml(html)
}
