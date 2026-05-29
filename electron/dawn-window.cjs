const { BrowserWindow, WebContentsView, Menu, net } = require('electron')
const path = require('path')
const AgentSandbox = require('./agent-sandbox.cjs')

const APP_ICON = path.join(__dirname, '../public/icon.png')
const NEWTAB_URL = 'dawn://newtab'
const SETTINGS_URL = 'dawn://settings'
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

function getDevServerUrl() { return 'http://localhost:1420' }

function isNewTabUrl(url) {
  return url === NEWTAB_URL || (url && url.startsWith('dawn://doc/'))
}

function isDawnUrl(url) {
  return url && (url === NEWTAB_URL || url === SETTINGS_URL || url.startsWith('dawn://doc/'))
}

function isDocumentUrl(url) {
  if (!url) return false
  try {
    const pathname = url.split('?')[0].split('#')[0]
    const ext = pathname.split('.').pop()?.toLowerCase()
    const docExts = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'txt', 'md']
    return ext ? docExts.includes(ext) : false
  } catch { return false }
}

function isSettingsUrl(url) { return url === SETTINGS_URL }

function getNewTabUrl() {
  return isDev ? getDevServerUrl() + '/newtab.html' : 'file://' + path.join(__dirname, '../dist/newtab.html')
}

function getSettingsUrl() {
  return isDev ? getDevServerUrl() + '/settings.html' : 'file://' + path.join(__dirname, '../dist/settings.html')
}

function normalizeUrl(url) {
  if (!url) return url
  if (url === getDevServerUrl() + '/newtab.html' || url.endsWith('/newtab.html')) return NEWTAB_URL
  if (url === getDevServerUrl() + '/settings.html' || url.endsWith('/settings.html')) return SETTINGS_URL
  return url
}

async function waitForViteServer(maxRetries = 60) {
  const url = getDevServerUrl()
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await net.fetch(url)
      if (response.status === 200 || response.status === 304) {
        try {
          const testResp = await net.fetch(url + '/src/main.js')
          const text = await testResp.text()
          if (text.includes('from "/node_modules/.vite/')) {
            console.log(`[Dawn] Vite dev server ready after ${i + 1}s`)
            return true
          }
        } catch {}
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  console.error('[Dawn] Vite dev server not ready after 60s')
  return false
}

class DawnWindow {
  constructor(options = {}) {
    this._onNewWindow = options.onNewWindow || null
    this._onDownloadsBroadcast = options.onDownloadsBroadcast || null

    this.win = null
    this.tabs = new Map()
    this.activeTabId = null
    this.nextTabId = 1
    this.closedTabs = []
    this.aiSidebarOpen = false
    this.aiSidebarWidth = 420
    this.tabSidebarOpen = false
    this.tabSidebarWidth = 240
    this.panelWindow = null
    this.panelMode = ''
    this.findText = ''
    this.destroyed = false
    this.agentSandbox = new AgentSandbox()

    this._createWindow()
  }

  get id() { return this.win ? this.win.id : -1 }

  ownsWebContents(wc) {
    if (this.win && !this.win.isDestroyed() && this.win.webContents === wc) return true
    if (this.panelWindow && !this.panelWindow.isDestroyed() && this.panelWindow.webContents === wc) return true
    for (const [, tab] of this.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents === wc) return true
    }
    return false
  }

  _createWindow() {
    this.win = new BrowserWindow({
      width: 1200, height: 800, minWidth: 800, minHeight: 600,
      frame: false, show: false, title: 'Dawn', icon: APP_ICON,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

        // Forward renderer console messages to main process
    this.win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const levels = ['verbose','info','warning','error']
      console.log('[Renderer ' + levels[level] + '] ' + message + ' (' + sourceId + ':' + line + ')')
    })

    const mainMenu = Menu.buildFromTemplate([
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { type: 'separator' },
      { label: '全选', role: 'selectAll' }
    ])
    this.win.webContents.on('context-menu', () => {
      mainMenu.popup({ window: this.win })
    })

    this.win.once('ready-to-show', () => this.win.show())

    this.win.on('resize', () => {
      if (this.activeTabId && this.tabs.has(this.activeTabId)) {
        this._resizeView(this.tabs.get(this.activeTabId).view)
      }
    })

    this.win.on('closed', () => {
      this.destroyed = true
      for (const [, tab] of this.tabs) {
        try { tab.view.webContents.destroy() } catch {}
      }
      this.tabs.clear()
      this.activeTabId = null
      this.aiSidebarOpen = false
      this.win = null
    })

    this._setupKeyboardShortcuts()
  }

  async init(initialUrl) {
    if (!this.win || this.win.isDestroyed()) return

    if (isDev) {
      const ready = await waitForViteServer()
      if (!ready) {
        this.win.loadURL('data:text/html,<h3 style="font-family:sans-serif;padding:40px">Dawn: Dev server not available</h3>')
        this.win.show()
        return
      }
      try {
        await this.win.webContents.session.clearCache()
        await this.win.loadURL(getDevServerUrl())
      } catch (e) {
        console.error('[Dawn] Failed to load main window:', e.message)
        this.win.loadURL('data:text/html,<h3 style="font-family:sans-serif;padding:40px">Dawn: Failed to load UI</h3>')
        this.win.show()
        return
      }
    } else {
      try {
        await this.win.loadFile(path.join(__dirname, '../dist/index.html'))
      } catch (e) {
        console.error('[Dawn] Failed to load main window:', e.message)
      }
    }

    const url = initialUrl || NEWTAB_URL
    const tabId = this.addTab(url, true)
    if (tabId) {
      this.win.webContents.send('tabs-initialized',
        [{ id: tabId, url, title: isNewTabUrl(url) ? 'New Tab' : url }],
        tabId)
    }
  }

  _setupKeyboardShortcuts() {
    if (!this.win || this.win.isDestroyed()) return

    this.win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const ctrl = input.control || input.meta
      const shift = input.shift

      if (ctrl && input.key === 't') { event.preventDefault(); this.addTab(NEWTAB_URL, true); return }
      if (ctrl && input.key === 'w') { event.preventDefault(); if (this.activeTabId && this.tabs.has(this.activeTabId)) this.removeTab(this.activeTabId); return }
      if (ctrl && input.key === 'Tab') {
        event.preventDefault()
        const tabIds = Array.from(this.tabs.keys())
        if (tabIds.length <= 1) return
        const index = tabIds.indexOf(this.activeTabId)
        const nextIndex = shift ? (index - 1 + tabIds.length) % tabIds.length : (index + 1) % tabIds.length
        this.switchTab(tabIds[nextIndex])
        return
      }
      if (ctrl && input.key === 'l') { event.preventDefault(); try { this.win.webContents.send('focus-address-bar') } catch {}; return }
      if (input.key === 'F5' || (ctrl && input.key === 'r')) {
        event.preventDefault()
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
          const { view } = this.tabs.get(this.activeTabId)
          if (!view.webContents.isDestroyed()) view.webContents.reload()
        }
        return
      }
      if (ctrl && shift && (input.key === 'a' || input.key === 'A')) {
        event.preventDefault(); this.toggleAiSidebar(); try { this.win.webContents.send('toggle-ai-sidebar') } catch {}; return
      }
      if (ctrl && input.key === 'f') { event.preventDefault(); try { this.win.webContents.send('focus-find-bar') } catch {}; return }
      if (ctrl && shift && input.key === 't') {
        event.preventDefault()
        if (this.closedTabs.length > 0) { const entry = this.closedTabs.pop(); this.addTab(entry.url, true) }
        return
      }
      if (ctrl && input.key === 'h') { event.preventDefault(); try { this.win.webContents.send('toggle-history') } catch {}; return }
      if (ctrl && (input.key === '=' || input.key === '+')) { event.preventDefault(); this.adjustZoom(0.5); return }
      if (ctrl && input.key === '-') { event.preventDefault(); this.adjustZoom(-0.5); return }
      if (ctrl && input.key === '0') { event.preventDefault(); this.resetZoom(); return }
    })
  }

  // ── Tab management ──

  addTab(url = NEWTAB_URL, activate = true) {
    if (!this.win || this.win.isDestroyed()) return null

    const tabId = this.nextTabId++
    const view = this._createWebContentsView(url)

    this.tabs.set(tabId, {
      view, url,
      title: isNewTabUrl(url) ? 'New Tab' : url,
      zoomLevel: 0
    })

    if (activate) this.switchTab(tabId)

    try { this.win.webContents.send('tab-created', tabId, url, isNewTabUrl(url) ? 'New Tab' : url) } catch {}
    return tabId
  }

  removeTab(tabId) {
    if (!this.tabs.has(tabId)) return
    if (!this.win || this.win.isDestroyed()) return

    const { view, url, title } = this.tabs.get(tabId)
    const wasActive = tabId === this.activeTabId

    this.closedTabs.push({ url, title })
    if (this.closedTabs.length > 32) this.closedTabs.shift()

    try { this.win.contentView.removeChildView(view) } catch {}
    try { if (!view.webContents.isDestroyed()) view.webContents.destroy() } catch {}

    this.tabs.delete(tabId)
    try { this.win.webContents.send('tab-removed', tabId) } catch {}

    if (wasActive) {
      this.activeTabId = null
      const tabIds = Array.from(this.tabs.keys())
      if (tabIds.length > 0) this.switchTab(tabIds[tabIds.length - 1])
    }
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId) || !this.win || this.win.isDestroyed()) return

    const oldActiveId = this.activeTabId
    this.activeTabId = tabId
    const { view, url, title } = this.tabs.get(tabId)

    if (oldActiveId !== null && oldActiveId !== tabId && this.tabs.has(oldActiveId)) {
      try { this.win.contentView.removeChildView(this.tabs.get(oldActiveId).view) } catch {}
    }

    try {
      const isHome = isNewTabUrl(url)
      if (oldActiveId !== tabId) {
        if (!isHome) { this.win.contentView.addChildView(view); this._resizeView(view) }
        else { try { this.win.contentView.removeChildView(view) } catch {} }
      } else if (!isHome) {
        this._resizeView(view)
      }
      view.webContents.setZoomLevel(this.tabs.get(tabId).zoomLevel || 0)
    } catch (e) {
      console.error('[Dawn] Failed to set WebContentsView:', e.message)
    }

    try { this.win.webContents.send('tab-switched', tabId, url, title) } catch {}
    this._updateNavState()
  }

  // ── WebContentsView ──

  _createWebContentsView(url) {
    const self = this

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const pageMenu = Menu.buildFromTemplate([
      { label: '后退', click: () => { if (view.webContents.canGoBack()) view.webContents.goBack() }, enabled: false },
      { label: '前进', click: () => { if (view.webContents.canGoForward()) view.webContents.goForward() } },
      { label: '刷新', click: () => view.webContents.reload() },
      { type: 'separator' },
      { label: '在新窗口打开', click: () => {
        const currentUrl = view.webContents.getURL()
        if (!currentUrl || currentUrl.startsWith('dawn://') || currentUrl.startsWith('file://')) return
        if (self._onNewWindow) self._onNewWindow(currentUrl)
      }},
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '全选', role: 'selectAll' }
    ])
    view.webContents.on('context-menu', () => {
      pageMenu.items[0].enabled = view.webContents.canGoBack()
      pageMenu.items[1].enabled = view.webContents.canGoForward()
      pageMenu.popup({ window: self.win })
    })

    const loadUrl = isNewTabUrl(url) ? getNewTabUrl() : isSettingsUrl(url) ? getSettingsUrl() : url
    view.webContents.loadURL(loadUrl).catch(e => {
      console.error('[Dawn] WebContentsView failed to load:', loadUrl, e.message)
    })

    view.webContents.on('will-navigate', (event, navUrl) => {
      const normalized = normalizeUrl(navUrl)
      if (isDocumentUrl(normalized)) {
        event.preventDefault()
        if (self.win && !self.win.isDestroyed()) self.win.webContents.send('open-document-url', normalized)
        return
      }
      const tabId = self._getTabIdByView(view)
      const tab = self.tabs.get(tabId)
      if (tab) tab.url = normalized
      if (tabId === self.activeTabId && self.win && !self.win.isDestroyed()) {
        self.win.webContents.send('will-navigate', normalized)
      }
    })

    view.webContents.on('did-navigate', (event, navUrl) => {
      const normalized = normalizeUrl(navUrl)
      const tabId = self._getTabIdByView(view)
      const tab = self.tabs.get(tabId)
      const wasDoc = tab && tab.url && tab.url.startsWith('dawn://doc/')
      const isHome = isNewTabUrl(normalized)
      const isDawn = isDawnUrl(normalized) || wasDoc

      if (tab && !wasDoc) {
        tab.url = normalized
        tab.title = isHome ? 'New Tab' : view.webContents.getTitle()
      }

      const hideBV = isDawn && normalized !== SETTINGS_URL
      if (tabId === self.activeTabId && self.win && !self.win.isDestroyed()) {
        if (!hideBV) { self._resizeView(view); try { self.win.contentView.addChildView(view) } catch {} }
        else { try { self.win.contentView.removeChildView(view) } catch {} }

        if (!isDawn && normalized && !normalized.startsWith('file://') && !normalized.startsWith('dawn://')) {
          try { self.win.webContents.send('history-entry', { url: normalized, title: tab ? tab.title : '', visitTime: Date.now() }) } catch {}
        }

        const sendUrl = wasDoc ? (tab ? tab.url : normalized) : normalized
        const sendTitle = wasDoc ? (tab ? tab.title || 'Document' : 'Document') : (tab ? tab.title : 'New Tab')
        self.win.webContents.send('did-navigate', sendUrl, sendTitle)
        self._updateNavState()
      }
    })

    view.webContents.on('did-navigate-in-page', (event, navUrl) => {
      const normalized = normalizeUrl(navUrl)
      const tabId = self._getTabIdByView(view)
      const tab = self.tabs.get(tabId)
      if (tab) tab.url = normalized
      if (tabId === self.activeTabId && self.win && !self.win.isDestroyed()) {
        self.win.webContents.send('did-navigate-in-page', normalized, tab ? tab.title : 'New Tab')
        self._updateNavState()
      }
    })

    view.webContents.setWindowOpenHandler(({ url: openUrl }) => { self.addTab(openUrl, true); return { action: 'deny' } })

    view.webContents.on('did-start-loading', () => {
      const tabId = self._getTabIdByView(view)
      if (tabId === self.activeTabId && self.win && !self.win.isDestroyed()) self.win.webContents.send('page-loading', true)
    })

    view.webContents.on('did-stop-loading', () => {
      const tabId = self._getTabIdByView(view)
      if (tabId === self.activeTabId && self.win && !self.win.isDestroyed()) self.win.webContents.send('page-loading', false)
    })

    view.webContents.on('page-title-updated', (event, title) => {
      const tabId = self._getTabIdByView(view)
      const tab = self.tabs.get(tabId)
      if (tab) tab.title = title
      if (tabId === self.activeTabId && self.win && !self.win.isDestroyed()) self.win.webContents.send('title-updated', title)
    })

    view.webContents.on('page-favicon-updated', (event, favicons) => {
      const tabId = self._getTabIdByView(view)
      if (favicons.length > 0 && tabId === self.activeTabId && self.win && !self.win.isDestroyed()) {
        self.win.webContents.send('favicon-updated', favicons[0])
      }
    })

    view.webContents.on('zoom-changed', () => {
      const newZoom = view.webContents.getZoomLevel()
      const tabId = self._getTabIdByView(view)
      if (tabId && self.tabs.has(tabId)) {
        self.tabs.get(tabId).zoomLevel = newZoom
        if (self.win && !self.win.isDestroyed()) self.win.webContents.send('zoom-changed', newZoom)
      }
    })

    view.webContents.on('render-process-gone', (event, details) => {
      console.error('[Dawn] Render process gone:', details.reason)
      const tabId = self._getTabIdByView(view)
      if (tabId) self.removeTab(tabId)
    })

    // Download handler for this view's session
    view.webContents.session.on('will-download', (event, item) => {
      const fileName = item.getFilename() || 'download'
      item.setSaveDialogOptions({ defaultPath: fileName, filters: [{ name: 'All Files', extensions: ['*'] }] })
      const dlId = 'dl_' + (global.__nextDownloadId || 1)
      global.__nextDownloadId = (global.__nextDownloadId || 1) + 1
      const entry = {
        id: dlId, url: item.getURL(), fileName, receivedBytes: 0,
        totalBytes: item.getTotalBytes(), state: 'progressing', startTime: Date.now()
      }
      if (global.__downloads) global.__downloads.set(dlId, entry)
      const broadcast = (ch, data) => {
        if (self.win && !self.win.isDestroyed()) self.win.webContents.send(ch, data)
        if (self.panelWindow && !self.panelWindow.isDestroyed()) self.panelWindow.webContents.send(ch, data)
        if (self._onDownloadsBroadcast) self._onDownloadsBroadcast(ch, data)
      }
      broadcast('download-started', entry)
      item.on('updated', () => {
        entry.receivedBytes = item.getReceivedBytes()
        entry.totalBytes = item.getTotalBytes()
        entry.state = 'progressing'
        broadcast('download-progress', entry)
      })
      item.on('done', (e, state) => {
        entry.state = state
        entry.filePath = item.getSavePath()
        broadcast('download-completed', entry)
      })
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

  _getTabIdByWebContents(sender) {
    for (const [id, tab] of this.tabs) { if (tab.view.webContents === sender) return id }
    return null
  }

  _resizeView(view) {
    if (!view || !this.win || this.win.isDestroyed()) return
    try {
      const contentSize = this.win.getContentSize()
      const headerHeight = 130
      const leftW = this.tabSidebarOpen ? this.tabSidebarWidth : 0
      const rightW = this.aiSidebarOpen ? this.aiSidebarWidth : 0
      const bounds = {
        x: leftW, y: headerHeight,
        width: Math.max(100, contentSize[0] - leftW - rightW),
        height: Math.max(100, contentSize[1] - headerHeight)
      }
      view.setBounds(bounds)
      setImmediate(() => { try { view.setBounds(bounds) } catch {} })
    } catch (e) {
      console.error('[Dawn] Failed to resize WebContentsView:', e.message)
    }
  }

  _updateNavState() {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId) || !this.win || this.win.isDestroyed()) return
    try {
      const { view } = this.tabs.get(this.activeTabId)
      if (view.webContents.isDestroyed()) return
      this.win.webContents.send('nav-state-changed', view.webContents.canGoBack(), view.webContents.canGoForward())
    } catch (e) {
      console.error('[Dawn] Failed to update nav state:', e.message)
    }
  }

  // ── AI Sidebar ──

  showAiSidebar() {
    if (this.aiSidebarOpen) return
    this.aiSidebarOpen = true
    if (this.activeTabId && this.tabs.has(this.activeTabId)) this._resizeView(this.tabs.get(this.activeTabId).view)
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ai-sidebar-shown')
  }

  hideAiSidebar() {
    if (!this.aiSidebarOpen) return
    this.aiSidebarOpen = false
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ai-sidebar-hidden')
    setImmediate(() => {
      if (this.activeTabId && this.tabs.has(this.activeTabId) && !this.aiSidebarOpen) {
        this._resizeView(this.tabs.get(this.activeTabId).view)
      }
    })
  }

  toggleAiSidebar() { this.aiSidebarOpen ? this.hideAiSidebar() : this.showAiSidebar() }

  resizeAiSidebar(width) {
    const w = Math.max(320, Math.min(600, Math.round(Number(width) || 420)))
    if (w !== this.aiSidebarWidth) {
      this.aiSidebarWidth = w
      if (this.aiSidebarOpen && this.activeTabId && this.tabs.has(this.activeTabId)) {
        this._resizeView(this.tabs.get(this.activeTabId).view)
      }
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ai-sidebar-width-changed', w)
    }
  }

  // ── Tab Sidebar ──

  toggleTabSidebar() {
    this.tabSidebarOpen = !this.tabSidebarOpen
    if (this.activeTabId && this.tabs.has(this.activeTabId)) this._resizeView(this.tabs.get(this.activeTabId).view)
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('tab-sidebar-toggled', this.tabSidebarOpen)
    return this.tabSidebarOpen
  }

  // ── WebContentsView show/hide ──

  showBrowserView() {
    if (this.activeTabId && this.tabs.has(this.activeTabId)) {
      const { view } = this.tabs.get(this.activeTabId)
      try { this.win.contentView.addChildView(view) } catch {}
      this._resizeView(view)
    }
  }

  hideBrowserView() {
    if (this.activeTabId && this.tabs.has(this.activeTabId)) {
      const { view } = this.tabs.get(this.activeTabId)
      try { this.win.contentView.removeChildView(view) } catch {}
    }
  }

  // ── Panel overlay ──

  showPanel(mode) {
    if (this.panelWindow && !this.panelWindow.isDestroyed() && this.panelMode === mode) { this._closePanel(); return }
    this._closePanel()
    this.panelMode = mode
    this.panelWindow = new BrowserWindow({
      parent: this.win, frame: false, transparent: false, resizable: false,
      skipTaskbar: true, show: false, backgroundColor: '#f7f4ed',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
    })
    const panelUrl = isDev ? getDevServerUrl() + '/panel-overlay.html' : 'file://' + path.join(__dirname, '../dist/panel-overlay.html')
    this.panelWindow.loadURL(panelUrl)
    this.panelWindow.once('ready-to-show', () => {
      this._updatePanelPosition()
      this.panelWindow.show()
      this.panelWindow.webContents.send('panel-mode', mode)
    })
    this.panelWindow.on('blur', () => { this._closePanel() })
    this.panelWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this._closePanel()
    })
    const followMain = () => { if (this.panelWindow && !this.panelWindow.isDestroyed()) this._updatePanelPosition() }
    if (this.win) { this.win.on('move', followMain); this.win.on('resize', followMain) }
    this.panelWindow.on('closed', () => {
      if (this.win && !this.win.isDestroyed()) { this.win.removeListener('move', followMain); this.win.removeListener('resize', followMain) }
      this.panelWindow = null; this.panelMode = ''
    })
  }

  _closePanel() {
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      try { this.panelWindow.removeAllListeners('blur'); this.panelWindow.close() } catch {}
    }
    this.panelWindow = null; this.panelMode = ''
  }

  _updatePanelPosition() {
    if (!this.panelWindow || this.panelWindow.isDestroyed() || !this.win) return
    const mwBounds = this.win.getBounds()
    const contentSize = this.win.getContentSize()
    const chromeH = mwBounds.height - contentSize[1]
    const toolbarBottom = chromeH + 74
    const maxHeight = contentSize[1] - 74
    const panelW = 400; const panelH = Math.min(480, maxHeight)
    this.panelWindow.setBounds({
      x: mwBounds.x + mwBounds.width - panelW - 8,
      y: mwBounds.y + toolbarBottom + 4,
      width: panelW, height: panelH
    })
  }

  // ── Zoom ──

  adjustZoom(delta) {
    const tab = this._getActiveTab()
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.zoomLevel = Math.max(-5, Math.min(5, (tab.zoomLevel || 0) + delta))
    tab.view.webContents.setZoomLevel(tab.zoomLevel)
    if (this.win) this.win.webContents.send('zoom-changed', tab.zoomLevel)
  }

  resetZoom() {
    const tab = this._getActiveTab()
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.zoomLevel = 0; tab.view.webContents.setZoomLevel(0)
    if (this.win) this.win.webContents.send('zoom-changed', 0)
  }

  getZoom() {
    const tab = this._getActiveTab()
    return tab ? (tab.zoomLevel || 0) : 0
  }

  _getActiveTab() {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return null
    return this.tabs.get(this.activeTabId)
  }

  // ── Find-in-page ──

  async findInPage(text) {
    const view = this._getActiveView()
    if (!view || view.webContents.isDestroyed()) return { matches: 0 }
    this.findText = text
    if (text) { view.webContents.findInPage(text, { forward: true, findNext: false }) }
    else { view.webContents.stopFindInPage('clearSelection'); return { matches: 0 } }
    return new Promise((resolve) => {
      const handler = (e, result) => {
        view.webContents.removeListener('found-in-page', handler)
        if (this.win && !this.win.isDestroyed()) this.win.webContents.send('found-in-page', result)
        resolve(result)
      }
      view.webContents.on('found-in-page', handler)
    })
  }

  stopFindInPage() {
    const view = this._getActiveView()
    if (view && !view.webContents.isDestroyed()) view.webContents.stopFindInPage('clearSelection')
    this.findText = ''
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('find-in-page-closed')
  }

  // ── Navigation ──

  navigate(url) {
    const tabId = this._getTabIdByWebContents(null) || this.activeTabId
    if (!tabId || !this.tabs.has(tabId)) return
    const tab = this.tabs.get(tabId)
    if (tab.view.webContents.isDestroyed()) return
    const loadUrl = isNewTabUrl(url) ? getNewTabUrl() : isSettingsUrl(url) ? getSettingsUrl() : url
    tab.url = url
    if (url.startsWith('dawn://doc/')) return
    tab.view.webContents.loadURL(loadUrl).catch(e => console.error('[Dawn] Navigate failed:', e.message))
    // Show BrowserView when navigating away from internal pages
    if (!isNewTabUrl(url) && !isSettingsUrl(url)) {
      this.showBrowserView()
    }
  }

  async navigateTo(url) {
    const view = this._getActiveView()
    if (!view) return { ok: false, error: 'No active browser tab' }
    if (!/^https?:\/\//i.test(url) && !url.startsWith('file://') && !url.startsWith('dawn://')) url = 'https://' + url
    try { await view.webContents.loadURL(url) }
    catch (e) { console.error('[Dawn] navigate-to loadURL failed:', e.message); return { ok: false, error: e.message } }
    if (this.win && !this.win.isDestroyed() && !isNewTabUrl(url) && !isSettingsUrl(url)) {
      this._resizeView(view); try { this.win.contentView.addChildView(view) } catch {}
    }
    return { ok: true, url }
  }

  goBack() {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return
    const { view } = this.tabs.get(this.activeTabId)
    if (!view.webContents.isDestroyed() && view.webContents.canGoBack()) view.webContents.goBack()
  }

  goForward() {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return
    const { view } = this.tabs.get(this.activeTabId)
    if (!view.webContents.isDestroyed() && view.webContents.canGoForward()) view.webContents.goForward()
  }

  reload() {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return
    const { view } = this.tabs.get(this.activeTabId)
    if (!view.webContents.isDestroyed()) view.webContents.reload()
  }

  // ── Content extraction ──

  async getPageContent() {
    const view = this._getActiveView(); if (!view) return null
    return view.webContents.executeJavaScript(`
      (function(){try{var t=document.title||'',u=window.location.href||'',d='',m=document.querySelector('meta[name="description"]');if(m)d=m.content||'';if(!d){var o=document.querySelector('meta[property="og:description"]');if(o)d=o.content||''}var b='';if(document.body){var c=document.body.cloneNode(true);c.querySelectorAll('script,style,nav,footer,header,.sidebar,.ad,.advertisement,[role="navigation"],noscript,iframe,svg').forEach(function(e){e.remove()});b=(c.innerText||c.textContent||'').replace(/\\n{3,}/g,'\\n\\n').trim().substring(0,8000)}var h=[];document.querySelectorAll('h1,h2,h3').forEach(function(e){h.push(e.tagName+': '+(e.textContent||'').trim().substring(0,100))});var l=[];document.querySelectorAll('a[href]').forEach(function(a){var f=a.getAttribute('href'),s=(a.textContent||'').trim().substring(0,60);if(f&&!f.startsWith('#')&&!f.startsWith('javascript:'))l.push(s+' -> '+f)});return{title:t,url:u,description:d,bodyText:b,headings:h.slice(0,30),links:l.slice(0,50)}}catch(e){return{title:document.title||'',url:window.location.href||'',description:'',bodyText:document.body&&document.body.innerText?document.body.innerText.substring(0,8000):'',headings:[],links:[]}}})()
    `)
  }

  async getPageHtml() {
    const view = this._getActiveView(); if (!view) return ''
    return view.webContents.executeJavaScript('document.documentElement.outerHTML')
  }

  async getPageSelection() {
    const view = this._getActiveView(); if (!view) return ''
    return view.webContents.executeJavaScript('window.getSelection().toString()')
  }

  async capturePage() {
    const view = this._getActiveView(); if (!view) return null
    const image = await view.webContents.capturePage()
    return image.toDataURL()
  }

  async executeOnPage(script) {
    const view = this._getActiveView(); if (!view) return { error: 'No active page' }
    // Always inject __dawnAPI atomically before executing
    await this.injectContentScript()
    try { return { result: await view.webContents.executeJavaScript(script) } }
    catch (e) { return { error: e.message } }
  }

  async executeScriptSandbox(script) {
    const view = this._getActiveView()
    if (!view) return { ok: false, error: 'No active page' }

    // Extract page data safely (controlled extraction, not user script)
    let pageData = {}
    try {
      pageData = await view.webContents.executeJavaScript(`
        (function() {
          try {
            return {
              url: window.location.href || '',
              title: document.title || '',
              selection: window.getSelection ? window.getSelection().toString() : '',
              bodyText: document.body ? document.body.innerText.substring(0, 20000) : '',
              bodyHtml: document.body ? document.body.innerHTML.substring(0, 50000) : ''
            };
          } catch(e) { return { url: '', error: e.message }; }
        })()
      `)
    } catch (e) {
      pageData = { url: '', error: 'Could not extract page data: ' + e.message }
    }

    // Execute in sandbox
    return this.agentSandbox.execute(script, pageData)
  }

  async getPageMetadata() {
    const view = this._getActiveView(); if (!view) return null
    return view.webContents.executeJavaScript(`(function(){var t=document.title||'',u=window.location.href||'',d=document.querySelector('meta[name="description"]')?document.querySelector('meta[name="description"]').content:'',f=document.querySelector('link[rel*="icon"]')?document.querySelector('link[rel*="icon"]').href:'';return{title:t,url:u,description:d,favicon:f}})()`)
  }

  async getPageDomSnapshot() {
    const view = this._getActiveView(); if (!view) return null
    return view.webContents.executeJavaScript(`(function(){try{var f=[];document.querySelectorAll('form').forEach(function(fm,fi){var fd=[];fm.querySelectorAll('input,select,textarea').forEach(function(el){var lb='';var le=el.closest('label')||document.querySelector('label[for="'+(el.id||'')+'"]');if(le)lb=(le.textContent||'').trim().substring(0,50);fd.push({tag:el.tagName.toLowerCase(),type:el.type||'',name:el.name||'',id:el.id||'',placeholder:el.placeholder||'',label:lb,selector:el.id?'#'+el.id:el.name?el.tagName.toLowerCase()+'[name="'+el.name+'"]':el.tagName.toLowerCase()+':nth-of-type('+(Array.from(el.parentElement.children).indexOf(el)+1)+')'})});f.push({index:fi,fields:fd.slice(0,20),action:fm.action||'',method:fm.method||'get'})});var b=[];document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]').forEach(function(el){var t=(el.textContent||el.value||'').trim().substring(0,40);var s=el.id?'#'+el.id:el.className?el.tagName.toLowerCase()+'.'+el.className.split(' ')[0]:el.tagName.toLowerCase();if(t)b.push({text:t,selector:s})});return{forms:f.slice(0,3),buttons:b.slice(0,20)}}catch(e){return{forms:[],buttons:[]}}})()`)
  }

  async injectContentScript() {
    const view = this._getActiveView(); if (!view) return false
    // Always re-inject to prevent page tampering with __dawnAPI
    await view.webContents.executeJavaScript(`
      window.__dawnInjected=true;window.__dawnAPI={click:function(s){var e=document.querySelector(s);if(!e)return{error:'Element not found: '+s};e.click();return{ok:true,tag:e.tagName.toLowerCase()}},fill:function(s,v){var e=document.querySelector(s);if(!e)return{error:'Element not found: '+s};var st=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;st.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true,value:v}},select:function(s,v){var e=document.querySelector(s);if(!e)return{error:'Element not found: '+s};e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true}},scroll:function(d,a){var amt=a||300;window.scrollBy({top:d==='down'?amt:-amt,behavior:'smooth'});return{ok:true}},hover:function(s){var e=document.querySelector(s);if(!e)return{error:'Element not found: '+s};e.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return{ok:true}},wait:function(s,t){return new Promise(function(r){var e=document.querySelector(s);if(e){r({ok:true,immediate:true});return}var st=Date.now(),mx=t||5000;var o=new MutationObserver(function(){var e=document.querySelector(s);if(e){o.disconnect();r({ok:true,waited:Date.now()-st})}});o.observe(document.body,{childList:true,subtree:true});setTimeout(function(){o.disconnect();r({timeout:true,waited:mx})},mx)})}}
    `)
    return true
  }

  // ── Restore closed tab ──

  restoreClosedTab() {
    if (this.closedTabs.length === 0) return null
    const entry = this.closedTabs.pop()
    return this.addTab(entry.url, true)
  }

  // ── Panel data ──

  async getPanelData(mode) {
    if (mode === 'history') {
      try { return await this.win.webContents.executeJavaScript('window.__panelHistoryData') } catch { return null }
    }
    return null
  }

  // ── Window controls ──

  minimize() { if (this.win && !this.win.isDestroyed()) this.win.minimize() }
  maximize() { if (this.win && !this.win.isDestroyed()) { this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize() } }
  close() { if (this.win && !this.win.isDestroyed()) this.win.close() }

  // ── Clear on exit ──

  clearOnExit() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.session.clearStorageData()
      this.win.webContents.executeJavaScript('localStorage.clear();indexedDB.deleteDatabase("dawn-ai-memory")')
    }
    for (const [, tab] of this.tabs) { try { tab.view.webContents.session.clearStorageData() } catch {} }
    this.agentSandbox.destroy()
  }
}

module.exports = {
  DawnWindow, isNewTabUrl, isDawnUrl, isDocumentUrl, isSettingsUrl,
  normalizeUrl, getDevServerUrl, getNewTabUrl, getSettingsUrl,
  isDev, NEWTAB_URL, SETTINGS_URL, APP_ICON
}
