const { BrowserWindow, BrowserView, Menu, net } = require('electron')
const path = require('path')

const APP_ICON = path.join(__dirname, '../public/icon.png')
const NEWTAB_URL = 'dawn://newtab'
const SETTINGS_URL = 'dawn://settings'
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

function getDevServerUrl() { return 'http://localhost:1420' }
function isNewTabUrl(url) { return url === NEWTAB_URL || (url && url.startsWith('dawn://doc/')) }
function isDawnUrl(url) { return url && (url === NEWTAB_URL || url === SETTINGS_URL || url.startsWith('dawn://doc/')) }
function isSettingsUrl(url) { return url === SETTINGS_URL }

function normalizeUrl(url) {
  if (!url) return url
  if (url === getDevServerUrl() + '/newtab.html' || url.endsWith('/newtab.html')) return NEWTAB_URL
  if (url === getDevServerUrl() + '/settings.html' || url.endsWith('/settings.html')) return SETTINGS_URL
  return url
}

async function waitForViteServer() {
  const url = getDevServerUrl()
  for (let i = 0; i < 60; i++) {
    try { const r = await net.fetch(url); if (r.status === 200 || r.status === 304) return true } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

class DawnWindow {
  constructor() {
    this.tabs = new Map()
    this.activeTabId = null
    this.nextTabId = 1
    this.closedTabs = []
    this.aiSidebarOpen = false
    this.aiSidebarWidth = 420
    this.tabSidebarOpen = false
    this.tabSidebarWidth = 240

    this.win = new BrowserWindow({
      width: 1200, height: 800, minWidth: 800, minHeight: 600,
      frame: false, show: false, title: 'Dawn', icon: APP_ICON,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
    })

    this._setupEvents()
    this._setupIPC()
  }

  _setupEvents() {
    this.win.once('ready-to-show', () => this.win.show())
    this.win.on('resize', () => this._resizeActiveView())
    this.win.on('closed', () => {
      for (const [id, tab] of this.tabs) { try { tab.view.webContents.destroy() } catch {} }
      this.tabs.clear()
      this.activeTabId = null
    })
  }

  _setupIPC() {
    // Keyboard shortcuts
    this.win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const ctrl = input.control || input.meta
      const shift = input.shift
      if (ctrl && input.key === 't') { event.preventDefault(); this.addTab(NEWTAB_URL, true); return }
      if (ctrl && input.key === 'w') { event.preventDefault(); if (this.activeTabId) this.removeTab(this.activeTabId); return }
      if (ctrl && input.key === 'Tab') {
        event.preventDefault()
        const ids = Array.from(this.tabs.keys())
        if (ids.length > 1) {
          const idx = ids.indexOf(this.activeTabId)
          this.switchTab(ids[shift ? (idx - 1 + ids.length) % ids.length : (idx + 1) % ids.length])
        }
        return
      }
      if (ctrl && input.key === 'l') { event.preventDefault(); this.win.webContents.send('focus-address-bar'); return }
      if (input.key === 'F5' || (ctrl && input.key === 'r')) { event.preventDefault(); this._reload(); return }
      if (ctrl && shift && (input.key === 'a' || input.key === 'A')) {
        event.preventDefault(); this.toggleAiSidebar(); this.win.webContents.send('toggle-ai-sidebar'); return
      }
      if (ctrl && shift && input.key === 't') {
        event.preventDefault(); if (this.closedTabs.length > 0) this.addTab(this.closedTabs.pop().url, true); return
      }
      if (ctrl && input.key === 'f') { event.preventDefault(); this.win.webContents.send('focus-find-bar'); return }
      if (ctrl && input.key === 'h') { event.preventDefault(); this.win.webContents.send('toggle-history'); return }
      if (ctrl && (input.key === '=' || input.key === '+')) { event.preventDefault(); this._adjustZoom(0.5); return }
      if (ctrl && input.key === '-') { event.preventDefault(); this._adjustZoom(-0.5); return }
      if (ctrl && input.key === '0') { event.preventDefault(); this._zoomReset(); return }
    })
  }

  async init() {
    if (isDev) {
      const ready = await waitForViteServer()
      if (!ready) { this.win.loadURL('data:text/html,Dev server not available'); this.win.show(); return }
      await this.win.loadURL(getDevServerUrl())
    } else {
      await this.win.loadFile(path.join(__dirname, '../dist/index.html'))
    }
    const tabId = this.addTab(NEWTAB_URL, true)
    if (tabId) this.win.webContents.send('tabs-initialized', [{ id: tabId, url: NEWTAB_URL, title: 'New Tab' }], tabId)
  }

  // ── Tab management ──

  addTab(url = NEWTAB_URL, activate = true) {
    const view = this._createBrowserView(url)
    const tabId = this.nextTabId++
    this.tabs.set(tabId, { view, url, title: isNewTabUrl(url) ? 'New Tab' : url, zoomLevel: 0 })
    if (activate) this.switchTab(tabId)
    this.win.webContents.send('tab-created', tabId, url, isNewTabUrl(url) ? 'New Tab' : url)
    return tabId
  }

  removeTab(tabId) {
    if (!this.tabs.has(tabId)) return
    const { view, url, title } = this.tabs.get(tabId)
    this.closedTabs.push({ url, title })
    if (this.closedTabs.length > 32) this.closedTabs.shift()
    try { this.win.removeBrowserView(view) } catch {}
    try { if (!view.webContents.isDestroyed()) view.webContents.destroy() } catch {}
    this.tabs.delete(tabId)
    this.win.webContents.send('tab-removed', tabId)
    if (tabId === this.activeTabId) {
      this.activeTabId = null
      const ids = Array.from(this.tabs.keys())
      if (ids.length > 0) this.switchTab(ids[ids.length - 1])
    }
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) return
    const oldId = this.activeTabId
    this.activeTabId = tabId
    const { view, url, title } = this.tabs.get(tabId)
    if (oldId !== null && oldId !== tabId && this.tabs.has(oldId)) {
      try { this.win.removeBrowserView(this.tabs.get(oldId).view) } catch {}
    }
    const isHome = isNewTabUrl(url)
    if (!isHome) { this.win.addBrowserView(view); this._resizeView(view) }
    else { try { this.win.removeBrowserView(view) } catch {} }
    view.webContents.setZoomLevel(this.tabs.get(tabId).zoomLevel || 0)
    this.win.webContents.send('tab-switched', tabId, url, title)
    this._updateNavState()
  }

  // ── Internal ──

  _createBrowserView(url) {
    const view = new BrowserView({
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
    })
    const loadUrl = isNewTabUrl(url) ? this._getNewTabUrl() : isSettingsUrl(url) ? this._getSettingsUrl() : url
    view.webContents.loadURL(loadUrl).catch(e => console.error('[DW] loadURL failed:', e.message))
    view.setAutoResize({ width: true, height: true, horizontal: false, vertical: false })

    // Context menu
    const pageMenu = Menu.buildFromTemplate([
      { label: '后退', click: () => { if (view.webContents.canGoBack()) view.webContents.goBack() }, enabled: false },
      { label: '前进', click: () => { if (view.webContents.canGoForward()) view.webContents.goForward() } },
      { label: '刷新', click: () => view.webContents.reload() },
      { type: 'separator' },
      { label: '在新窗口打开', click: () => { global.__openInNewWindow && global.__openInNewWindow(view.webContents.getURL()) } },
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '全选', role: 'selectAll' }
    ])
    view.webContents.on('context-menu', () => {
      pageMenu.items[0].enabled = view.webContents.canGoBack()
      pageMenu.items[1].enabled = view.webContents.canGoForward()
      pageMenu.popup({ window: this.win })
    })

    view.webContents.on('did-navigate', (event, navUrl) => {
      const normalized = normalizeUrl(navUrl)
      const tabId = this._getTabIdByView(view)
      const tab = this.tabs.get(tabId)
      const wasDoc = tab && tab.url && tab.url.startsWith('dawn://doc/')
      const isDawn = isDawnUrl(normalized) || wasDoc
      if (tab && !wasDoc) { tab.url = normalized; tab.title = isNewTabUrl(normalized) ? 'New Tab' : view.webContents.getTitle() }
      const hideBV = isDawn && normalized !== SETTINGS_URL
      if (tabId === this.activeTabId) {
        if (!hideBV) { this.win.addBrowserView(view); this._resizeView(view) }
        else { try { this.win.removeBrowserView(view) } catch {} }
        // Record history
        if (!isDawn && normalized && !normalized.startsWith('file://') && !normalized.startsWith('dawn://')) {
          this.win.webContents.send('history-entry', { url: normalized, title: tab ? tab.title : '', visitTime: Date.now() })
        }
        this.win.webContents.send('did-navigate', wasDoc ? (tab ? tab.url : normalized) : normalized,
          wasDoc ? (tab ? tab.title : 'Document') : (tab ? tab.title : 'New Tab'))
        this._updateNavState()
      }
    })

    view.webContents.on('did-navigate-in-page', (event, navUrl) => {
      const normalized = normalizeUrl(navUrl)
      const tabId = this._getTabIdByView(view)
      const tab = this.tabs.get(tabId)
      if (tab) tab.url = normalized
      if (tabId === this.activeTabId) {
        this.win.webContents.send('did-navigate-in-page', normalized, tab ? tab.title : '')
        this._updateNavState()
      }
    })

    view.webContents.setWindowOpenHandler(({ url: openUrl }) => { this.addTab(openUrl, true); return { action: 'deny' } })
    view.webContents.on('did-start-loading', () => { if (this._getTabIdByView(view) === this.activeTabId) this.win.webContents.send('page-loading', true) })
    view.webContents.on('did-stop-loading', () => { if (this._getTabIdByView(view) === this.activeTabId) this.win.webContents.send('page-loading', false) })
    view.webContents.on('page-title-updated', (e, title) => {
      const tabId = this._getTabIdByView(view); const tab = this.tabs.get(tabId)
      if (tab) tab.title = title
      if (tabId === this.activeTabId) this.win.webContents.send('title-updated', title)
    })
    view.webContents.on('page-favicon-updated', (e, favicons) => {
      if (favicons.length > 0 && this._getTabIdByView(view) === this.activeTabId) this.win.webContents.send('favicon-updated', favicons[0])
    })
    view.webContents.on('zoom-changed', () => {
      const newZoom = view.webContents.getZoomLevel()
      const tabId = this._getTabIdByView(view)
      if (tabId && this.tabs.has(tabId)) { this.tabs.get(tabId).zoomLevel = newZoom; this.win.webContents.send('zoom-changed', newZoom) }
    })
    view.webContents.on('render-process-gone', (e, details) => {
      const tabId = this._getTabIdByView(view); if (tabId) this.removeTab(tabId)
    })

    return view
  }

  _getActiveView() {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return null
    const { view } = this.tabs.get(this.activeTabId)
    return view.webContents.isDestroyed() ? null : view
  }

  _getTabIdByView(view) {
    for (const [id, tab] of this.tabs) { if (tab.view === view) return id }
    return null
  }

  _getTabIdBySender(sender) {
    for (const [id, tab] of this.tabs) { if (tab.view.webContents === sender) return id }
    return null
  }

  _resizeView(view) {
    if (!view || this.win.isDestroyed()) return
    const contentSize = this.win.getContentSize()
    const leftW = this.tabSidebarOpen ? this.tabSidebarWidth : 0
    const rightW = this.aiSidebarOpen ? this.aiSidebarWidth : 0
    const bounds = { x: leftW, y: 130, width: Math.max(100, contentSize[0] - leftW - rightW), height: Math.max(100, contentSize[1] - 130) }
    view.setBounds(bounds)
    setImmediate(() => { try { view.setBounds(bounds) } catch {} })
  }

  _resizeActiveView() { const view = this._getActiveView(); if (view) this._resizeView(view) }

  _updateNavState() {
    const view = this._getActiveView()
    if (!view || view.webContents.isDestroyed()) return
    this.win.webContents.send('nav-state-changed', view.webContents.canGoBack(), view.webContents.canGoForward())
  }

  _reload() { const view = this._getActiveView(); if (view) view.webContents.reload() }

  _getNewTabUrl() {
    return isDev ? getDevServerUrl() + '/newtab.html' : 'file://' + path.join(__dirname, '../dist/newtab.html')
  }

  _getSettingsUrl() {
    return isDev ? getDevServerUrl() + '/settings.html' : 'file://' + path.join(__dirname, '../dist/settings.html')
  }

  // ── AI Sidebar ──

  toggleAiSidebar() { this.aiSidebarOpen ? this.hideAiSidebar() : this.showAiSidebar() }
  showAiSidebar() { if (this.aiSidebarOpen) return; this.aiSidebarOpen = true; this._resizeActiveView(); this.win.webContents.send('ai-sidebar-shown') }
  hideAiSidebar() { if (!this.aiSidebarOpen) return; this.aiSidebarOpen = false; this.win.webContents.send('ai-sidebar-hidden'); setImmediate(() => this._resizeActiveView()) }

  // ── Zoom ──

  _adjustZoom(delta) {
    const tab = this.tabs.get(this.activeTabId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.zoomLevel = Math.max(-5, Math.min(5, (tab.zoomLevel || 0) + delta))
    tab.view.webContents.setZoomLevel(tab.zoomLevel)
    this.win.webContents.send('zoom-changed', tab.zoomLevel)
  }

  _zoomReset() {
    const tab = this.tabs.get(this.activeTabId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.zoomLevel = 0; tab.view.webContents.setZoomLevel(0)
    this.win.webContents.send('zoom-changed', 0)
  }

  // ── Page content ──

  getPageContent() { return this._executeOnActive(`(function(){...})()`) } // stub — see main.cjs for full impl

  async _executeOnActive(script) {
    const view = this._getActiveView(); if (!view) return null
    return view.webContents.executeJavaScript(script)
  }
}

module.exports = { DawnWindow, isNewTabUrl, isDawnUrl, isSettingsUrl, normalizeUrl, getDevServerUrl, isDev, NEWTAB_URL, SETTINGS_URL, APP_ICON }
