import { ref } from 'vue'
import { saveBookmarkToDB, loadBookmarksFromDB } from './useMemory'
import { storeApi } from './useStore'

const bookmarks = ref([])
let _loaded = false
let _storeSynced = false

function _initStoreSync() {
  if (_storeSynced) return
  _storeSynced = true
  storeApi.onStoreChange('bookmarks', (value) => {
    if (Array.isArray(value)) bookmarks.value = value
  })
}

async function _syncToStore() {
  await storeApi.set('bookmarks', bookmarks.value)
}

async function loadBookmarks() {
  if (_loaded) return
  _loaded = true
  _initStoreSync()
  // Prefer store data (cross-window), fall back to IndexedDB
  const stored = await storeApi.get('bookmarks')
  if (Array.isArray(stored) && stored.length > 0) {
    bookmarks.value = stored
  } else {
    try { bookmarks.value = await loadBookmarksFromDB() } catch { bookmarks.value = [] }
    if (bookmarks.value.length > 0) _syncToStore()
  }
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
  _syncToStore()
  return bm
}

async function removeBookmark(id) {
  bookmarks.value = bookmarks.value.filter(b => b.id !== id)
  _syncToStore()
}

function isBookmarked(url) {
  return bookmarks.value.some(b => b.url === url)
}

async function editBookmark(id, updates) {
  const bm = bookmarks.value.find(b => b.id === id)
  if (bm) { Object.assign(bm, updates); _syncToStore() }
}

// ── Folders ──
function createFolder(name, parentId = 'root') {
  const folder = {
    id: 'folder_' + Date.now().toString(36),
    title: name.trim() || 'New Folder',
    url: '',
    type: 'folder',
    filePath: '',
    parentId,
    createdAt: Date.now()
  }
  bookmarks.value.unshift(folder)
  try { saveBookmarkToDB(folder) } catch {}
  _syncToStore()
  return folder
}

function getFolders(parentId = 'root') {
  return bookmarks.value.filter(b => b.type === 'folder' && (b.parentId || 'root') === parentId)
}

function getBookmarksByFolder(parentId = 'root') {
  return bookmarks.value.filter(b => b.type !== 'folder' && (b.parentId || 'root') === parentId)
}

function deleteFolder(id) {
  // Remove folder and all children recursively
  const idsToRemove = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const bm of bookmarks.value) {
      if (idsToRemove.has(bm.parentId || 'root') && !idsToRemove.has(bm.id)) {
        idsToRemove.add(bm.id)
        changed = true
      }
    }
  }
  bookmarks.value = bookmarks.value.filter(b => !idsToRemove.has(b.id))
  _syncToStore()
}

function moveBookmark(id, newParentId) {
  const bm = bookmarks.value.find(b => b.id === id)
  if (bm) { bm.parentId = newParentId; _syncToStore() }
}

// ── Import/Export ──
function exportBookmarksHTML() {
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>']

  function exportFolder(parentId, indent) {
    const pad = '  '.repeat(indent)
    out.push(pad + '<DL><p>')
    const folders = bookmarks.value.filter(b => b.type === 'folder' && (b.parentId || 'root') === parentId)
    const items = bookmarks.value.filter(b => b.type !== 'folder' && (b.parentId || 'root') === parentId)
    for (const folder of folders) {
      out.push(pad + '<DT><H3>' + (folder.title || 'Folder') + '</H3>')
      exportFolder(folder.id, indent + 1)
    }
    for (const bm of items) {
      if (bm.url) {
        out.push(pad + '<DT><A HREF="' + bm.url + '" ADD_DATE="' + Math.floor((bm.createdAt || 0)/1000) + '">' + (bm.title || bm.url) + '</A>')
      }
    }
    out.push(pad + '</DL><p>')
  }

  exportFolder('root', 1)
  return out.join('\n')
}


function importBookmarksHTML(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const links = doc.querySelectorAll('a[href]')
  let count = 0
  for (const a of links) {
    const url = a.getAttribute('href')
    const title = a.textContent?.trim() || url
    if (url && url.startsWith('http')) {
      addBookmark({ title, url })
      count++
    }
  }
  return count
}

export function useBookmarks() {
  loadBookmarks()
  return {
    bookmarks, addBookmark, removeBookmark, isBookmarked,
    editBookmark, createFolder, getFolders, getBookmarksByFolder,
    deleteFolder, moveBookmark,
    exportBookmarksHTML, importBookmarksHTML,
    loadBookmarks
  }
}
