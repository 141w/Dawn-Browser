const DB_NAME = 'dawn-ai-memory'
const DB_VERSION = 3

let _dbPromise = null

function openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => { _dbPromise = null; reject(request.error) }
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      const oldVer = event.oldVersion || 0

      if (oldVer < 1) {
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains('bookmarks')) {
          const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true })
          bookmarkStore.createIndex('url', 'url', { unique: false })
          bookmarkStore.createIndex('time', 'time', { unique: false })
        }
      }

      if (oldVer < 2) {
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true })
          historyStore.createIndex('url', 'url', { unique: false })
          historyStore.createIndex('visitTime', 'visitTime', { unique: false })
        }
      }

      if (oldVer < 3) {
        // Ensure bookmarks have parentId support
        // IndexedDB upgrades can't modify existing indexes without delete+recreate,
        // but we can check existing data via cursor later. For now, ensure the store exists.
      }
    }
  })
}

function storeOp(storeName, mode) {
  return async (callback) => {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const store = tx.objectStore(storeName)
      const result = callback(store)
      tx.oncomplete = () => {
        resolve(result)
      }
      tx.onerror = () => {
        reject(tx.error)
      }
    })
  }
}

export async function loadConversationsFromDB() {
  try {
    return await storeOp('conversations', 'readonly')((store) => {
      return new Promise((resolve) => {
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => resolve([])
      })
    })
  } catch {
    return []
  }
}

export async function saveConversationsToDB(conversations) {
  try {
    await storeOp('conversations', 'readwrite')((store) => {
      store.clear()
      for (const conv of conversations) {
        try { store.put(conv) } catch {}
      }
    })
  } catch (e) {
    console.error('[Memory] Failed to save conversations:', e)
  }
}

export async function saveConfigToDB(key, value) {
  try {
    await storeOp('config', 'readwrite')((store) => {
      store.put({ key, value, updatedAt: Date.now() })
    })
  } catch (e) {
    console.error('[Memory] Failed to save config:', e)
  }
}

export async function loadConfigFromDB(key) {
  try {
    return await storeOp('config', 'readonly')((store) => {
      return new Promise((resolve) => {
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result?.value ?? null)
        request.onerror = () => resolve(null)
      })
    })
  } catch {
    return null
  }
}

export async function saveBookmarkToDB(bookmark) {
  try {
    await storeOp('bookmarks', 'readwrite')((store) => {
      store.add({ ...bookmark, time: Date.now() })
    })
  } catch (e) {
    console.error('[Memory] Failed to save bookmark:', e)
  }
}

export async function loadBookmarksFromDB() {
  try {
    return await storeOp('bookmarks', 'readonly')((store) => {
      return new Promise((resolve) => {
        const index = store.index('time')
        const request = index.getAll()
        request.onsuccess = () => resolve((request.result || []).reverse())
        request.onerror = () => resolve([])
      })
    })
  } catch {
    return []
  }
}

export async function saveHistoryEntry(entry) {
  try {
    await storeOp('history', 'readwrite')((store) => {
      // Check if URL already exists in recent 1 hour to avoid duplicates
      const index = store.index('url')
      const range = IDBKeyRange.only(entry.url)
      const req = index.openCursor(range, 'prev')
      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor && cursor.value.visitTime > Date.now() - 3600000) {
          // Update existing entry's visit time
          cursor.value.visitTime = entry.visitTime
          cursor.value.title = entry.title || cursor.value.title
          cursor.update(cursor.value)
        } else {
          const { id, ...clean } = entry
          store.put(clean)
        }
      }
    })
  } catch {}
}

export async function loadHistoryFromDB(limit = 200) {
  try {
    return await storeOp('history', 'readonly')((store) => {
      return new Promise((resolve) => {
        const index = store.index('visitTime')
        const request = index.openCursor(null, 'prev')
        const results = []
        request.onsuccess = (e) => {
          const cursor = e.target.result
          if (cursor && results.length < limit) {
            results.push(cursor.value)
            cursor.continue()
          } else {
            resolve(results)
          }
        }
        request.onerror = () => resolve([])
      })
    })
  } catch { return [] }
}

export async function searchHistoryFromDB(query, limit = 100) {
  try {
    const q = query.toLowerCase()
    return await storeOp('history', 'readonly')((store) => {
      return new Promise((resolve) => {
        const index = store.index('visitTime')
        const request = index.openCursor(null, 'prev')
        const results = []
        request.onsuccess = (e) => {
          const cursor = e.target.result
          if (cursor && results.length < limit) {
            const v = cursor.value
            if ((v.title || '').toLowerCase().includes(q) || (v.url || '').toLowerCase().includes(q)) {
              results.push(v)
            }
            cursor.continue()
          } else {
            resolve(results)
          }
        }
        request.onerror = () => resolve([])
      })
    })
  } catch { return [] }
}

export async function clearHistoryFromDB() {
  try {
    await storeOp('history', 'readwrite')((store) => store.clear())
  } catch {}
}

export async function removeHistoryEntry(id) {
  try {
    await storeOp('history', 'readwrite')((store) => store.delete(id))
  } catch {}
}

export async function getStorageStats() {
  try {
    const db = await openDB()
    const stats = { conversations: 0, configs: 0, bookmarks: 0, totalSize: 0 }
    if (db.objectStoreNames.contains('conversations')) {
      stats.conversations = await new Promise((resolve) => {
        const tx = db.transaction('conversations', 'readonly')
        const req = tx.objectStore('conversations').count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(0)
      })
    }
    if (db.objectStoreNames.contains('bookmarks')) {
      stats.bookmarks = await new Promise((resolve) => {
        const tx = db.transaction('bookmarks', 'readonly')
        const req = tx.objectStore('bookmarks').count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(0)
      })
    }
    if (db.objectStoreNames.contains('config')) {
      stats.configs = await new Promise((resolve) => {
        const tx = db.transaction('config', 'readonly')
        const req = tx.objectStore('config').count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(0)
      })
    }
    // db connection is cached, don't close
    stats.totalSize = JSON.stringify(stats).length
    return stats
  } catch {
    return { conversations: 0, configs: 0, bookmarks: 0, totalSize: 0 }
  }
}
