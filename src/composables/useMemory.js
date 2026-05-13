const DB_NAME = 'dawn-ai-memory'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
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
        db.close()
        resolve(result)
      }
      tx.onerror = () => {
        db.close()
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
    // Clear and put in separate transactions to avoid partial-failure issues
    await storeOp('conversations', 'readwrite')((store) => {
      store.clear()
    })
    if (conversations.length > 0) {
      await storeOp('conversations', 'readwrite')((store) => {
        for (const conv of conversations) {
          try { store.put(conv) } catch {}
        }
      })
    }
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
    db.close()
    stats.totalSize = JSON.stringify(stats).length
    return stats
  } catch {
    return { conversations: 0, configs: 0, bookmarks: 0, totalSize: 0 }
  }
}
