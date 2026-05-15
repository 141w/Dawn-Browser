import { ref } from 'vue'
import { saveBookmarkToDB, loadBookmarksFromDB } from './useMemory'

const bookmarks = ref([])
const folders = ref([])
let _loaded = false

async function loadBookmarks() {
  if (_loaded) return
  _loaded = true
  try { bookmarks.value = await loadBookmarksFromDB() } catch { bookmarks.value = [] }
}

async function addBookmark(item) {
  const bm = {
    id: 'bm_' + Date.now().toString(36),
    title: (item.title || '').slice(0, 200),
    url: item.url || '',
    type: item.type || 'web',
    filePath: item.filePath || '',
    parentId: item.parentId || 'root',
    createdAt: Date.now()
  }
  if (bookmarks.value.some(b => b.url === bm.url)) return null
  bookmarks.value.unshift(bm)
  try { await saveBookmarkToDB(bm) } catch {}
  return bm
}

async function removeBookmark(id) {
  bookmarks.value = bookmarks.value.filter(b => b.id !== id)
}

function isBookmarked(url) {
  return bookmarks.value.some(b => b.url === url)
}

async function editBookmark(id, updates) {
  const bm = bookmarks.value.find(b => b.id === id)
  if (bm) Object.assign(bm, updates)
}

// ── Folders ──
function getBookmarksByFolder(parentId = 'root') {
  return bookmarks.value.filter(b => (b.parentId || 'root') === parentId)
}

// ── Import/Export ──
function exportBookmarksHTML() {
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>']
  for (const bm of bookmarks.value) {
    lines.push(`<DT><A HREF="${bm.url}" ADD_DATE="${Math.floor(bm.createdAt/1000)}">${bm.title || bm.url}</A>`)
  }
  lines.push('</DL><p>')
  return lines.join('\n')
}

async function importBookmarksHTML() {
  if (!window.electronAPI?.openFileDialog) return 0
  const file = await window.electronAPI.openFileDialog([{ name: 'Bookmarks', extensions: ['html', 'htm'] }])
  if (!file || !file.data) return 0
  try {
    const html = atob(file.data)
    const linkRegex = /<A\s+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi
    let match, count = 0
    while ((match = linkRegex.exec(html)) !== null) {
      await addBookmark({ title: match[2].trim(), url: match[1], type: 'web' })
      count++
    }
    return count
  } catch { return 0 }
}

export function useBookmarks() {
  loadBookmarks()
  return {
    bookmarks, folders, addBookmark, removeBookmark, isBookmarked,
    editBookmark, getBookmarksByFolder,
    exportBookmarksHTML, importBookmarksHTML,
    loadBookmarks
  }
}
