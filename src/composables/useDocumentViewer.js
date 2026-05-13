import { ref, shallowRef } from 'vue'

// Dynamically loaded — not static imports so one bad package can't crash the whole app
let _mammoth = null
let _XLSX = null
let _pdfjsWorkerUrl = null

async function getMammoth() {
  if (!_mammoth) _mammoth = await import('mammoth')
  return _mammoth
}
async function getXLSX() {
  if (!_XLSX) _XLSX = await import('xlsx')
  return _XLSX
}
async function getPdfjsWorkerUrl() {
  if (_pdfjsWorkerUrl !== null) return _pdfjsWorkerUrl
  try {
    const mod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    _pdfjsWorkerUrl = mod.default || ''
  } catch {
    _pdfjsWorkerUrl = ''
  }
  // Fallback: use unpkg CDN for the worker
  if (!_pdfjsWorkerUrl) {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      _pdfjsWorkerUrl = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.379'}/build/pdf.worker.min.mjs`
    } catch {
      _pdfjsWorkerUrl = 'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs'
    }
  }
  return _pdfjsWorkerUrl
}

/* ── State ── */
const docContent = ref('')
const docPages = ref([])
const docError = ref(null)
const docMeta = ref(null)
const isLoading = ref(false)

/* ── Helpers ── */
function base64ToUint8(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64ToArrayBuffer(base64) {
  return base64ToUint8(base64).buffer
}

/* ── DOCX ── */
async function parseDocx(data) {
  const mammoth = await getMammoth()
  const buf = base64ToArrayBuffer(data)
  const result = await mammoth.convertToHtml({ arrayBuffer: buf })
  const metaResult = await mammoth.extractRawText({ arrayBuffer: buf })
  const preview = metaResult.value.slice(0, 200)
  docMeta.value = { type: 'docx', preview, pages: 1 }
  docContent.value = result.value
  docPages.value = []
  return result.value
}

/* ── XLSX ── */
async function parseXlsx(data) {
  const XLSX = await getXLSX()
  const buf = base64ToArrayBuffer(data)
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetNames = wb.SheetNames

  let html = ''
  for (const name of sheetNames) {
    const ws = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (rows.length === 0) continue

    html += `<div class="dv-sheet-name">${escapeHtml(name)}</div>`
    html += '<div class="dv-table-wrap"><table class="dv-table"><tbody>'

    for (let r = 0; r < Math.min(rows.length, 500); r++) {
      html += '<tr>'
      for (let c = 0; c < Math.min(rows[r].length, 50); c++) {
        const cell = rows[r][c]
        const val = cell != null ? String(cell) : ''
        html += r === 0
          ? `<th>${escapeHtml(val)}</th>`
          : `<td>${escapeHtml(val)}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table></div>'
  }

  docMeta.value = { type: 'xlsx', preview: `Sheets: ${sheetNames.join(', ')}`, pages: sheetNames.length }
  docContent.value = html
  docPages.value = []
  return html
}

/* ── PDF ── */
async function parsePdf(data) {
  const pdfjsLib = await import('pdfjs-dist')
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = await getPdfjsWorkerUrl()
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''
  }

  const buf = base64ToUint8(data)
  const loadingTask = pdfjsLib.getDocument({ data: buf })
  const pdf = await loadingTask.promise

  docMeta.value = { type: 'pdf', preview: `Pages: ${pdf.numPages}`, pages: pdf.numPages }

  const pages = []
  for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    pages.push(canvas.toDataURL('image/png'))
  }
  docPages.value = pages
  docContent.value = ''
  return pages
}

/* ── PPTX (basic text extraction from ZIP XML) ── */
async function parsePptx(data) {
  const buf = base64ToUint8(data)
  // PPTX is a ZIP file — extract slide text from XML
  let html = ''
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)

    // Find slide files and sort them
    const slideFiles = Object.keys(zip.files)
      .filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0')
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0')
        return na - nb
      })

    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('text')
      const titleMatch = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g)
      const texts = titleMatch
        ? titleMatch.map(t => t.replace(/<[^>]*>/g, '')).filter(t => t.trim())
        : []
      if (texts.length > 0) {
        html += `<div class="dv-slide"><div class="dv-slide-num">Slide ${i + 1}</div>`
        for (const t of texts.slice(0, 30)) {
          html += `<p class="dv-slide-text">${escapeHtml(t)}</p>`
        }
        html += '</div>'
      }
    }
  } catch (e) {
    html = '<p class="dv-error">Unable to parse PPTX. The file may be corrupted or in an unsupported format.</p>'
    console.error('[DocViewer] PPTX parse error:', e)
  }

  docMeta.value = { type: 'pptx', preview: '', pages: 1 }
  docContent.value = html || '<p class="dv-empty">No text content found in this presentation.</p>'
  docPages.value = []
  return docContent.value
}

/* ── CSV ── */
function parseCsv(data) {
  const text = new TextDecoder().decode(base64ToUint8(data))
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) {
    docContent.value = '<p class="dv-empty">Empty CSV file.</p>'
    return docContent.value
  }

  let html = '<div class="dv-table-wrap"><table class="dv-table"><tbody>'
  for (let r = 0; r < Math.min(lines.length, 1000); r++) {
    const cells = lines[r].split(',')
    html += '<tr>'
    for (const cell of cells) {
      html += r === 0
        ? `<th>${escapeHtml(cell.trim())}</th>`
        : `<td>${escapeHtml(cell.trim())}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table></div>'

  docMeta.value = { type: 'csv', preview: `Rows: ${lines.length}`, pages: 1 }
  docContent.value = html
  docPages.value = []
  return html
}

/* ── TXT / Code ── */
function parseText(data) {
  const text = new TextDecoder().decode(base64ToUint8(data))
  const escaped = escapeHtml(text)
  docMeta.value = { type: 'text', preview: text.slice(0, 200), pages: 1 }
  docContent.value = `<pre class="dv-text">${escaped}</pre>`
  docPages.value = []
  return docContent.value
}

/* ── Utils ── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ── Main parser ── */
async function parseDocument(data, ext) {
  isLoading.value = true
  docError.value = null
  docContent.value = ''
  docPages.value = []
  docMeta.value = null

  try {
    const extL = ext.toLowerCase()
    switch (extL) {
      case 'docx':
      case 'doc':
        await parseDocx(data)
        break
      case 'xlsx':
      case 'xls':
        await parseXlsx(data)
        break
      case 'csv':
        parseCsv(data)
        break
      case 'pdf':
        await parsePdf(data)
        break
      case 'pptx':
      case 'ppt':
        await parsePptx(data)
        break
      case 'txt':
      case 'md':
      case 'html':
      case 'xml':
      case 'json':
      case 'js':
      case 'ts':
      case 'py':
      case 'css':
        parseText(data)
        break
      default:
        docError.value = `Unsupported file format: .${extL}`
        break
    }
  } catch (e) {
    console.error('[DocViewer] Parse error:', e)
    docError.value = e.message || 'Failed to parse document'
  } finally {
    isLoading.value = false
  }
}

export function useDocumentViewer() {
  return {
    docContent,
    docPages,
    docError,
    docMeta,
    isLoading,
    parseDocument,
    escapeHtml
  }
}
