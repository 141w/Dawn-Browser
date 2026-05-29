const _listeners = new Map()
let _ipcRegistered = false

function _registerIpc() {
  if (_ipcRegistered || typeof window === 'undefined' || !window.electronAPI?.on) return
  _ipcRegistered = true
  window.electronAPI.on('store:changed', (data) => {
    const cbs = _listeners.get(data.key)
    if (cbs) {
      for (const cb of cbs) {
        try { cb(data.value) } catch (e) { console.error('[Store] listener error:', e) }
      }
    }
  })
}

export const storeApi = {
  async get(key) {
    if (typeof window === 'undefined' || !window.electronAPI?.storeGet) return null
    try { return await window.electronAPI.storeGet(key) } catch { return null }
  },

  async set(key, value) {
    if (typeof window === 'undefined' || !window.electronAPI?.storeSet) return
    try { await window.electronAPI.storeSet(key, value) } catch {}
  },

  async del(key) {
    if (typeof window === 'undefined' || !window.electronAPI?.storeDelete) return
    try { await window.electronAPI.storeDelete(key) } catch {}
  },

  onStoreChange(key, callback) {
    _registerIpc()
    if (!_listeners.has(key)) _listeners.set(key, new Set())
    _listeners.get(key).add(callback)
  },

  offStoreChange(key, callback) {
    const cbs = _listeners.get(key)
    if (cbs) cbs.delete(callback)
  },
}
