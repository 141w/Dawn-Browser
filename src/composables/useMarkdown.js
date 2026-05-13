export function renderMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  html = html
    .replace(/^###### (.+)$/gm, '<h6 class="mk-h6">$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5 class="mk-h5">$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4 class="mk-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="mk-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="mk-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="mk-h1">$1</h1>')

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const langLabel = lang ? `<span class="mk-code-lang">${lang}</span>` : ''
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<div class="mk-code-block">${langLabel}<pre><code>${escapedCode}</code></pre><button class="mk-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent)">Copy</button></div>`
  })

  html = html.replace(/`([^`]+)`/g, '<code class="mk-inline-code">$1</code>')

  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')

  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

  html = html.replace(/(?<![\\])`{3}([\s\S]*?)`{3}/g, (match, code) => {
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<div class="mk-code-block"><pre><code>${escapedCode}</code></pre><button class="mk-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent)">Copy</button></div>`
  })

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="mk-img" loading="lazy" />')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="mk-link">$1</a>')

  html = html.replace(/^---$/gm, '<hr class="mk-hr" />')

  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter(c => c.trim()).map(c => c.trim())
    if (cells.every(c => /^[-:]+$/.test(c))) return ''
    const tag = match.includes('\n') ? 'td' : 'th'
    return `<tr>${cells.map(c => `<${tag} class="mk-table-cell">${c}</${tag}>`).join('')}</tr>`
  })

  html = html.replace(/^(> .+)$/gm, '<blockquote class="mk-blockquote"><p>$1</p></blockquote>')

  html = html
    .replace(/^\- (.+)$/gm, '<li class="mk-li">$1</li>')
    .replace(/^\* (.+)$/gm, '<li class="mk-li">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="mk-li-ol">$2</li>')

  html = html.replace(/((?:<li class="mk-li">.*<\/li>\n?)+)/g, '<ul class="mk-ul">$1</ul>')
  html = html.replace(/((?:<li class="mk-li-ol">.*<\/li>\n?)+)/g, '<ol class="mk-ol">$1</ol>')

  html = html.replace(/<br>\n?<h([1-6])/g, '<h$1')
  html = html.replace(/<br>\n?<ul/g, '<ul')
  html = html.replace(/<br>\n?<ol/g, '<ol')
  html = html.replace(/<br>\n?<hr/g, '<hr')
  html = html.replace(/<br>\n?<blockquote/g, '<blockquote')
  html = html.replace(/<br>\n?<div class="mk-code-block"/g, '<div class="mk-code-block"')

  html = html.replace(/\n/g, '<br>')

  return html
}
