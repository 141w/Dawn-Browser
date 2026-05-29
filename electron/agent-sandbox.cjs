const { BrowserWindow } = require('electron')
const path = require('path')

class AgentSandbox {
  constructor() {
    this.win = null
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return
    this.win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.win.loadFile(path.join(__dirname, '../public/agent-sandbox.html'))
  }

  async execute(script, pageData) {
    this._ensure()
    try {
      const wrapped = `
        (function() {
          var __pageData = ${JSON.stringify(pageData || {})};
          try {
            var __result = (function() { ${script} })();
            return { ok: true, result: __result };
          } catch(e) {
            return { ok: false, error: e.message };
          }
        })()
      `
      const raw = await this.win.webContents.executeJavaScript(wrapped)
      return this._sanitize(raw)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  _sanitize(raw) {
    if (!raw) return { ok: true, result: null }
    if (raw.error) return { ok: false, error: raw.error }
    const sanitized = this._deepSanitize(raw.result)
    const serialized = JSON.stringify(sanitized)
    if (serialized && serialized.length > 10240) {
      return { ok: true, result: serialized.substring(0, 10240) + '...[truncated at 10KB]' }
    }
    return { ok: true, result: sanitized }
  }

  _deepSanitize(obj, depth) {
    if (depth === undefined) depth = 0
    if (depth > 10) return '[max depth reached]'
    if (obj === null || obj === undefined) return obj
    if (typeof obj === 'string') return obj.length > 10000 ? obj.substring(0, 10000) + '...' : obj
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj
    if (typeof obj === 'function' || typeof obj === 'symbol' || typeof obj === 'bigint') return '[' + typeof obj + ']'
    if (Array.isArray(obj)) {
      return obj.slice(0, 100).map(function(item) { return this._deepSanitize(item, depth + 1) }.bind(this))
    }
    if (typeof obj === 'object') {
      var result = {}
      var keys = Object.keys(obj)
      if (keys.length > 50) return '[object with ' + keys.length + ' keys]'
      for (var i = 0; i < Math.min(keys.length, 50); i++) {
        result[keys[i]] = this._deepSanitize(obj[keys[i]], depth + 1)
      }
      return result
    }
    return String(obj)
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
  }
}

module.exports = AgentSandbox
