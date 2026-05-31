const { app, ipcMain, BrowserWindow, dialog, shell, safeStorage, net } = require('electron')
const path = require('path')
const fs = require('fs')

const {
  DawnWindow, isNewTabUrl, isDawnUrl, isDocumentUrl, isSettingsUrl,
  normalizeUrl, getDevServerUrl, getNewTabUrl, getSettingsUrl,
  isDev, NEWTAB_URL, SETTINGS_URL, APP_ICON
} = require('./dawn-window.cjs')

const { dawnStore } = require('./dawn-store.cjs')
global.__dawnStore = dawnStore
const { registerMcpIpc } = require('./mcp-manager.cjs')
const { registerScriptRunnerIpc } = require('./script-runner.cjs')
const { registerAgentMemoryIpc, closeDb } = require('./agent-memory.cjs')
const { registerTaskSchedulerIpc } = require('./task-scheduler.cjs')
const { registerSkillIpc } = require('./skill-manager.cjs')
const { registerPluginIpc } = require('./plugin-manager.cjs')

/* ── Global download state (shared across all windows) ── */
global.__downloads = new Map()
global.__nextDownloadId = 1

/* ── Window registry ── */
const windows = new Map() // BrowserWindow.id → DawnWindow

function getDawnWindowByEvent(event) {
  for (const [, dw] of windows) {
    if (dw.ownsWebContents(event.sender)) return dw
  }
  return null
}

function createNewDawnWindow(url) {
  const dw = new DawnWindow({
    onNewWindow: createNewDawnWindow,
    onDownloadsBroadcast: (ch, data) => {
      // Broadcast download events to ALL windows
      for (const [, otherDw] of windows) {
        if (otherDw !== dw && otherDw.win && !otherDw.win.isDestroyed()) {
          try { otherDw.win.webContents.send(ch, data) } catch {}
        }
      }
    }
  })
  windows.set(dw.id, dw)
  dw.init(url).then(() => {
    dw.win.on('closed', () => { windows.delete(dw.id) })
  })
  return dw
}

/* ── IPC error wrapper ── */
function safeIpc(fn) {
  return async (event, ...args) => {
    try { return await fn(event, ...args) }
    catch (e) { console.error('[Dawn] IPC error:', e.message); return null }
  }
}

/* ────────────────────────────────────────────
   IPC Handlers — all route to correct DawnWindow
   ──────────────────────────────────────────── */

// ── Navigation ──

ipcMain.handle('navigate', safeIpc((event, url) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.navigate(url)
}))

ipcMain.handle('go-back', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.goBack()
}))

ipcMain.handle('go-forward', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.goForward()
}))

ipcMain.handle('reload', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.reload()
}))

// ── Tab management ──

ipcMain.handle('create-tab', safeIpc((event, url) => {
  const dw = getDawnWindowByEvent(event)
  if (!dw) return null
  return dw.addTab(url || NEWTAB_URL, true)
}))

ipcMain.handle('close-tab', safeIpc((event, tabId) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.removeTab(tabId)
}))

ipcMain.handle('switch-tab', safeIpc((event, tabId) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.switchTab(tabId)
}))

ipcMain.handle('get-tabs', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (!dw) return []
  const tabList = []
  dw.tabs.forEach((tab, id) => { tabList.push({ id, url: tab.url, title: tab.title }) })
  return tabList
}))

ipcMain.handle('get-active-tab', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.activeTabId : null
}))

// ── Window controls ──

ipcMain.handle('window-minimize', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.minimize()
}))

ipcMain.handle('window-maximize', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.maximize()
}))

ipcMain.handle('window-close', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.close()
}))

// ── AI Sidebar ──

ipcMain.handle('toggle-ai-float', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.toggleAiSidebar()
}))

ipcMain.handle('show-ai-float', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.showAiSidebar()
}))

ipcMain.handle('hide-ai-float', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.hideAiSidebar()
}))

ipcMain.handle('resize-ai-float', safeIpc((event, width) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.resizeAiSidebar(width)
}))

// ── Tab Sidebar ──

ipcMain.handle('toggle-tab-sidebar', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.toggleTabSidebar() : false
}))

// ── BrowserView show/hide ──

ipcMain.handle('show-browser-view', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.showBrowserView()
}))

ipcMain.handle('hide-browser-view', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.hideBrowserView()
}))

// ── Page content ──

ipcMain.handle('get-page-content', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.getPageContent() : null
}))

ipcMain.handle('get-page-html', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.getPageHtml() : ''
}))

ipcMain.handle('get-page-selection', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.getPageSelection() : ''
}))

ipcMain.handle('capture-page', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.capturePage() : null
}))

ipcMain.handle('execute-on-page', safeIpc(async (event, script) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.executeOnPage(script) : { error: 'No window' }
}))

ipcMain.handle('execute-script-sandbox', safeIpc(async (event, script) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.executeScriptSandbox(script) : { ok: false, error: 'No window' }
}))

ipcMain.handle('get-page-metadata', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.getPageMetadata() : null
}))

ipcMain.handle('navigate-to', safeIpc(async (event, url) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.navigateTo(url) : { ok: false, error: 'No window' }
}))

ipcMain.handle('web-search', safeIpc((event, query) => {
  const dw = getDawnWindowByEvent(event)
  if (!dw) return { status: 'error' }
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(query)
  dw.addTab(url, true)
  return { status: 'opened', url }
}))

ipcMain.handle('get-page-dom-snapshot', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.getPageDomSnapshot() : null
}))

ipcMain.handle('inject-content-script', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.injectContentScript() : false
}))

// ── Find-in-page ──

ipcMain.handle('find-in-page', safeIpc(async (event, text) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.findInPage(text) : { matches: 0 }
}))

ipcMain.handle('stop-find-in-page', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.stopFindInPage()
}))

// ── Downloads (global) ──

ipcMain.handle('get-downloads', safeIpc(() => {
  return Array.from(global.__downloads.values())
}))

ipcMain.handle('cancel-download', safeIpc((event, dlId) => {
  const dl = global.__downloads.get(dlId)
  if (dl) { dl.state = 'cancelled'; global.__downloads.delete(dlId) }
}))

ipcMain.handle('open-download-file', safeIpc(async (event, filePath) => {
  if (filePath) await shell.openPath(filePath)
}))

ipcMain.handle('clear-downloads', safeIpc(() => {
  global.__downloads.clear()
}))

// ── Panel overlay ──

ipcMain.handle('show-panel', safeIpc((event, mode) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.showPanel(mode)
}))

ipcMain.handle('hide-panel', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw._closePanel()
}))

ipcMain.handle('panel-action', safeIpc(async (event, action) => {
  const dw = getDawnWindowByEvent(event)
  if (dw && dw.win && !dw.win.isDestroyed()) {
    dw.win.webContents.send('panel-action', action)
  }
}))

ipcMain.handle('panel-get-data', safeIpc(async (event, mode) => {
  // Find the DawnWindow that owns this panel
  const dw = getDawnWindowByEvent(event)
  if (!dw) return null
  if (mode === 'downloads') return Array.from(global.__downloads.values())
  return dw.getPanelData(mode)
}))

// ── Zoom ──

ipcMain.handle('zoom-in', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.adjustZoom(0.5)
}))

ipcMain.handle('zoom-out', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.adjustZoom(-0.5)
}))

ipcMain.handle('zoom-reset', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.resetZoom()
}))

ipcMain.handle('get-zoom', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.getZoom() : 0
}))

// ── Restore closed tab ──

ipcMain.handle('restore-closed-tab', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  return dw ? dw.restoreClosedTab() : null
}))

// ── Platform ──

ipcMain.handle('get-platform', safeIpc(() => process.platform))

// ── New window (full Dawn window) ──

ipcMain.handle('new-window', safeIpc((event) => {
  const dw = getDawnWindowByEvent(event)
  if (!dw) return { ok: false, error: 'No active window' }
  const view = dw._getActiveView()
  if (!view || view.webContents.isDestroyed()) return { ok: false, error: 'No active page' }
  const currentUrl = view.webContents.getURL()
  if (!currentUrl || currentUrl.startsWith('dawn://') || currentUrl.startsWith('file://')) {
    return { ok: false, error: 'Cannot open this page in a new window' }
  }
  createNewDawnWindow(currentUrl)
  return { ok: true }
}))

// ── Encryption ──

ipcMain.handle('encrypt-secret', safeIpc((event, plaintext) => {
  if (!plaintext) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plaintext).toString('base64')
    }
  } catch (e) {
    console.error('[Dawn] Encryption failed:', e.message)
  }
  return plaintext
}))

ipcMain.handle('decrypt-secret', safeIpc((event, ciphertext) => {
  if (!ciphertext) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
    }
  } catch (e) {
    console.error('[Dawn] Decryption failed:', e.message)
  }
  return ciphertext
}))

// ── External ──

ipcMain.handle('open-external', safeIpc(async (event, url) => {
  try { await shell.openExternal(url); return true } catch { return false }
}))

// ── Data export/import ──

ipcMain.handle('export-data', safeIpc(async () => {
  const exportData = { conversations: [], config: {}, bookmarks: [], version: '1.0', exportedAt: new Date().toISOString() }
  return JSON.stringify(exportData)
}))

ipcMain.handle('import-data', safeIpc(async (event, jsonStr) => {
  try { JSON.parse(jsonStr); return { success: true, count: 0 } }
  catch (e) { return { success: false, error: e.message } }
}))

// ── File dialogs ──

ipcMain.handle('open-file-dialog', safeIpc(async (event, filters) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: filters || [
      { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'txt', 'md', 'html'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const buf = fs.readFileSync(filePath)
  const ext = filePath.split('.').pop().toLowerCase()
  return { filePath, fileName: filePath.split(/[/\\]/).pop(), ext, data: buf.toString('base64'), size: buf.length }
}))

ipcMain.handle('read-file-base64', safeIpc(async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null
  const buf = fs.readFileSync(filePath)
  const ext = filePath.split('.').pop().toLowerCase()
  return { filePath, fileName: filePath.split(/[/\\]/).pop(), ext, data: buf.toString('base64'), size: buf.length }
}))

ipcMain.handle('download-url', safeIpc(async (event, url) => {
  if (!url) return null
  const isLocalFile = /^file:\/\/\//i.test(url)
  if (isLocalFile) {
    const filePath = decodeURIComponent(url.replace(/^file:\/\/\//i, ''))
    if (!fs.existsSync(filePath)) return null
    const buf = fs.readFileSync(filePath)
    const ext = filePath.split('.').pop().toLowerCase()
    return { filePath, fileName: filePath.split(/[/\\]/).pop(), ext, data: buf.toString('base64'), size: buf.length }
  }
  try {
    const response = await net.fetch(url)
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const buf = Buffer.from(await response.arrayBuffer())
    const urlPath = new URL(url).pathname
    const fileName = urlPath.split('/').pop() || 'download'
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    return { filePath: url, fileName, ext, data: buf.toString('base64'), size: buf.length }
  } catch (e) {
    return { error: e.message }
  }
}))

// ── State bus ──

ipcMain.handle('store:get', safeIpc((event, key) => {
  return dawnStore.get(key)
}))

ipcMain.handle('store:set', safeIpc((event, key, value) => {
  dawnStore.set(key, value)
  return true
}))

ipcMain.handle('store:delete', safeIpc((event, key) => {
  dawnStore.delete(key)
  return true
}))

// ── Clear on exit ──

ipcMain.handle('clear-on-exit', safeIpc(async (event) => {
  const dw = getDawnWindowByEvent(event)
  if (dw) dw.clearOnExit()
}))

/* ────────────────────────────────────────────
   App lifecycle
   ──────────────────────────────────────────── */

// Fix GPU process crash on some Windows systems
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  registerMcpIpc()
  registerScriptRunnerIpc()
  registerAgentMemoryIpc()
  registerPluginIpc()
  registerTaskSchedulerIpc()
  registerSkillIpc()
  const dw = createNewDawnWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createNewDawnWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  const { mcpManager } = require('./mcp-manager.cjs')
  mcpManager.stopAll().catch(() => {})
  closeDb()
})
