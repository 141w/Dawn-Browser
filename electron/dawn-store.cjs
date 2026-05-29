const { BrowserWindow } = require('electron')

class DawnStore {
  constructor() {
    this._data = new Map()
  }

  get(key) {
    return this._data.get(key) ?? null
  }

  set(key, value) {
    this._data.set(key, value)
    this._broadcast(key, value)
  }

  delete(key) {
    this._data.delete(key)
    this._broadcast(key, null)
  }

  keys() {
    return Array.from(this._data.keys())
  }

  _broadcast(key, value) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('store:changed', { key, value }) } catch {}
      }
    }
  }
}

const dawnStore = new DawnStore()

module.exports = { dawnStore }
