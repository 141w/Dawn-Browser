const { app, BrowserWindow, ipcMain, BrowserView, net, nativeImage, safeStorage, globalShortcut, Menu, dialog, shell } = require('electron');
const path = require('path');

const APP_ICON = path.join(__dirname, '../public/icon.png');

/* ── Download manager ── */
const downloads = new Map()
let nextDownloadId = 1

const NEWTAB_URL = 'dawn://newtab';
const SETTINGS_URL = 'dawn://settings';
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

function getDevServerUrl() {
  return 'http://localhost:1420';
}

function isNewTabUrl(url) {
  return url === NEWTAB_URL || (url && url.startsWith('dawn://doc/'));
}

function isDawnUrl(url) {
  return url && (url === NEWTAB_URL || url === SETTINGS_URL || url.startsWith('dawn://doc/'));
}

function isDocumentUrl(url) {
  if (!url) return false;
  try {
    const pathname = url.split('?')[0].split('#')[0];
    const ext = pathname.split('.').pop()?.toLowerCase();
    const docExts = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'txt', 'md'];
    return ext ? docExts.includes(ext) : false;
  } catch { return false; }
}

function isSettingsUrl(url) {
  return url === SETTINGS_URL;
}

function getNewTabUrl() {
  if (isDev) {
    return getDevServerUrl() + '/newtab.html';
  }
  return 'file://' + path.join(__dirname, '../dist/newtab.html');
}

function getSettingsUrl() {
  if (isDev) {
    return getDevServerUrl() + '/settings.html';
  }
  return 'file://' + path.join(__dirname, '../dist/settings.html');
}

function normalizeUrl(url) {
  if (!url) return url;
  if (url === getDevServerUrl() + '/newtab.html' || url.endsWith('/newtab.html')) {
    return NEWTAB_URL;
  }
  if (url === getDevServerUrl() + '/settings.html' || url.endsWith('/settings.html')) {
    return SETTINGS_URL;
  }
  return url;
}

async function waitForViteServer(maxRetries = 60) {
  const url = getDevServerUrl();
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await net.fetch(url);
      if (response.status === 200 || response.status === 304) {
        console.log(`[Dawn] Vite dev server ready after ${i + 1}s`);
        return true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error('[Dawn] Vite dev server not ready after 60s');
  return false;
}

let mainWindow;
let aiSidebarOpen = false;
let aiSidebarWidth = 420;
let tabSidebarOpen = false;
let tabSidebarWidth = 240;
let tabs = new Map();
let activeTabId = null;
let nextTabId = 1;
let closedTabs = [];

function findTabIdByWebContents(sender) {
  for (const [id, tab] of tabs) {
    if (tab.view.webContents === sender) return id;
  }
  return null;
}

function getTabIdByView(view) {
  for (const [id, tab] of tabs) {
    if (tab.view === view) return id;
  }
  return null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,
    title: 'Dawn',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  /* ── Right-click context menu ── */
  const mainMenu = Menu.buildFromTemplate([
    { label: '剪切', role: 'cut' },
    { label: '复制', role: 'copy' },
    { label: '粘贴', role: 'paste' },
    { type: 'separator' },
    { label: '全选', role: 'selectAll' }
  ])
  mainWindow.webContents.on('context-menu', () => {
    mainMenu.popup({ window: mainWindow })
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', () => {
    if (activeTabId && tabs.has(activeTabId)) {
      resizeBrowserView(tabs.get(activeTabId).view);
    }
  });

  mainWindow.on('closed', () => {
    for (const [id, tab] of tabs) {
      try { tab.view.webContents.destroy(); } catch {}
    }
    tabs.clear();
    activeTabId = null;
    aiSidebarOpen = false;
    mainWindow = null;
  });
}

async function loadMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (isDev) {
    const ready = await waitForViteServer();
    if (!ready) {
      mainWindow.loadURL('data:text/html,<h3 style="font-family:sans-serif;padding:40px">Dawn: Dev server not available</h3>');
      mainWindow.show();
      return;
    }
    try {
      await mainWindow.loadURL(getDevServerUrl());
    } catch (e) {
      console.error('[Dawn] Failed to load main window:', e.message);
      mainWindow.loadURL('data:text/html,<h3 style="font-family:sans-serif;padding:40px">Dawn: Failed to load UI</h3>');
      mainWindow.show();
    }
  } else {
    try {
      await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    } catch (e) {
      console.error('[Dawn] Failed to load main window:', e.message);
    }
  }
}

function createBrowserView(url) {
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Right-click menu for BrowserView web pages
  const pageMenu = Menu.buildFromTemplate([
    { label: '后退', click: () => { if (view.webContents.canGoBack()) view.webContents.goBack() }, enabled: false },
    { label: '前进', click: () => { if (view.webContents.canGoForward()) view.webContents.goForward() } },
    { label: '刷新', click: () => view.webContents.reload() },
    { type: 'separator' },
    { label: '在新窗口打开', click: () => {
      const currentUrl = view.webContents.getURL()
      if (!currentUrl || currentUrl.startsWith('dawn://') || currentUrl.startsWith('file://')) return
      const newWin = new BrowserWindow({
        width: 1200, height: 800, icon: APP_ICON, title: 'Dawn',
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      })
      newWin.loadURL(currentUrl)
      newWin.once('ready-to-show', () => newWin.show())
    }},
    { type: 'separator' },
    { label: '复制', role: 'copy' },
    { label: '全选', role: 'selectAll' }
  ])
  view.webContents.on('context-menu', (_, params) => {
    pageMenu.items[0].enabled = view.webContents.canGoBack()
    pageMenu.items[1].enabled = view.webContents.canGoForward()
    pageMenu.popup({ window: mainWindow })
  })

  const loadUrl = isNewTabUrl(url) ? getNewTabUrl() : isSettingsUrl(url) ? getSettingsUrl() : url;

  view.webContents.loadURL(loadUrl).catch(e => {
    console.error('[Dawn] BrowserView failed to load:', loadUrl, e.message);
  });

  // Keep x/y fixed, width/height auto-adjust with window
  view.setAutoResize({ width: true, height: true, horizontal: false, vertical: false });

  view.webContents.on('will-navigate', (event, navUrl) => {
    const normalized = normalizeUrl(navUrl);
    // Intercept document URLs → open in viewer instead of BrowserView
    if (isDocumentUrl(normalized)) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-document-url', normalized);
      }
      return;
    }
    const tabId = getTabIdByView(view);
    const tab = tabs.get(tabId);
    if (tab) tab.url = normalized;
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('will-navigate', normalized);
    }
  });

  view.webContents.on('did-navigate', (event, navUrl) => {
    const normalized = normalizeUrl(navUrl);
    const tabId = getTabIdByView(view);
    const tab = tabs.get(tabId);
    // Preserve original URL for dawn://doc/ tabs (BrowserView loads newtab.html, which normalizes to dawn://newtab)
    const wasDoc = tab && tab.url && tab.url.startsWith('dawn://doc/');
    const isHome = isNewTabUrl(normalized);
    const isDawn = isDawnUrl(normalized) || wasDoc; // doc tabs are always "dawn" pages

    if (tab) {
      if (!wasDoc) {
        tab.url = normalized;
        tab.title = isHome ? 'New Tab' : view.webContents.getTitle();
      }
      // For doc tabs: keep original URL and title set by renderer
    }
    // Show/hide BrowserView: hide for newtab/doc pages, KEEP for settings
    const hideBrowserView = isDawn && normalized !== SETTINGS_URL
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      if (!hideBrowserView) {
        resizeBrowserView(view);
        try { mainWindow.addBrowserView(view); } catch {}
      } else {
        try { mainWindow.removeBrowserView(view); } catch {}
      }
      // Record history for real web URLs
      if (!isDawn && normalized && !normalized.startsWith('file://') && !normalized.startsWith('dawn://')) {
        try { mainWindow.webContents.send('history-entry', { url: normalized, title: tab ? tab.title : '', visitTime: Date.now() }) } catch {}
      }

      const sendUrl = wasDoc ? (tab ? tab.url : normalized) : normalized;
      const sendTitle = wasDoc ? (tab ? tab.title || 'Document' : 'Document') : (tab ? tab.title : 'New Tab');
      mainWindow.webContents.send('did-navigate', sendUrl, sendTitle);
      updateNavState();
    }
  });

  view.webContents.on('did-navigate-in-page', (event, navUrl) => {
    const normalized = normalizeUrl(navUrl);
    const tabId = getTabIdByView(view);
    const tab = tabs.get(tabId);
    if (tab) tab.url = normalized;
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('did-navigate-in-page', normalized, tab ? tab.title : 'New Tab');
      updateNavState();
    }
  });

  view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    addTab(openUrl, true);
    return { action: 'deny' };
  });

  view.webContents.on('did-start-loading', () => {
    const tabId = getTabIdByView(view);
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('page-loading', true);
    }
  });

  view.webContents.on('did-stop-loading', () => {
    const tabId = getTabIdByView(view);
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('page-loading', false);
    }
  });

  view.webContents.on('page-title-updated', (event, title) => {
    const tabId = getTabIdByView(view);
    const tab = tabs.get(tabId);
    if (tab) tab.title = title;
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('title-updated', title);
    }
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    const tabId = getTabIdByView(view);
    if (favicons.length > 0 && tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('favicon-updated', favicons[0]);
    }
  });

  view.webContents.on('zoom-changed', (event, zoomDirection) => {
    const newZoom = view.webContents.getZoomLevel()
    const tabId = getTabIdByView(view)
    if (tabId && tabs.has(tabId)) {
      tabs.get(tabId).zoomLevel = newZoom
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('zoom-changed', newZoom)
      }
    }
  })

  view.webContents.on('render-process-gone', (event, details) => {
    console.error('[Dawn] Render process gone:', details.reason);
    const tabId = getTabIdByView(view);
    if (tabId) removeTab(tabId);
  });

  // Download handler for this BrowserView
  view.webContents.session.on('will-download', (event, item) => {
    const fileName = item.getFilename() || 'download'
    item.setSaveDialogOptions({
      defaultPath: fileName,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    const dlId = 'dl_' + (nextDownloadId++)
    const entry = {
      id: dlId, url: item.getURL(), fileName, receivedBytes: 0,
      totalBytes: item.getTotalBytes(), state: 'progressing', startTime: Date.now()
    }
    downloads.set(dlId, entry)
    const broadcast = (ch, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
      if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send(ch, data)
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
    // Don't call item.setSavePath() — let the native save dialog handle it
  })

  return view;
}

function resizeBrowserView(view) {
  if (!view || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const contentSize = mainWindow.getContentSize();
    const headerHeight = 130;
    const leftW = tabSidebarOpen ? tabSidebarWidth : 0;
    const rightW = aiSidebarOpen ? aiSidebarWidth : 0;
    const bounds = {
      x: leftW,
      y: headerHeight,
      width: Math.max(100, contentSize[0] - leftW - rightW),
      height: Math.max(100, contentSize[1] - headerHeight)
    };
    console.log('[Dawn] resizeBrowserView:', JSON.stringify(bounds), 'tabSidebar:', tabSidebarOpen, 'aiSidebar:', aiSidebarOpen);
    view.setBounds(bounds);
    // Windows may need multiple sets due to timing
    setImmediate(() => { try { view.setBounds(bounds); } catch {} });
  } catch (e) {
    console.error('[Dawn] Failed to resize BrowserView:', e.message);
  }
}

function updateNavState() {
  if (!activeTabId || !tabs.has(activeTabId) || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const { view } = tabs.get(activeTabId);
    if (view.webContents.isDestroyed()) return;
    const canGoBack = view.webContents.canGoBack();
    const canGoForward = view.webContents.canGoForward();
    mainWindow.webContents.send('nav-state-changed', canGoBack, canGoForward);
  } catch (e) {
    console.error('[Dawn] Failed to update nav state:', e.message);
  }
}

function switchTab(tabId) {
  if (!tabs.has(tabId) || !mainWindow || mainWindow.isDestroyed()) return;

  const oldActiveId = activeTabId;
  activeTabId = tabId;

  const { view, url, title } = tabs.get(tabId);

  if (oldActiveId !== null && oldActiveId !== tabId && tabs.has(oldActiveId)) {
    try { mainWindow.removeBrowserView(tabs.get(oldActiveId).view); } catch {}
  }

  try {
    const isHome = isNewTabUrl(url);
    if (oldActiveId !== tabId) {
      if (!isHome) {
        mainWindow.addBrowserView(view);
        resizeBrowserView(view);
      } else {
        try { mainWindow.removeBrowserView(view); } catch {}
      }
    } else if (!isHome) {
      resizeBrowserView(view);
    }
    view.webContents.setZoomLevel(tabs.get(tabId).zoomLevel || 0);
  } catch (e) {
    console.error('[Dawn] Failed to set BrowserView:', e.message);
  }

  try {
    mainWindow.webContents.send('tab-switched', tabId, url, title);
  } catch {}
  updateNavState();
}

function showAiSidebar() {
  if (aiSidebarOpen) return;
  aiSidebarOpen = true;
  if (activeTabId && tabs.has(activeTabId)) {
    resizeBrowserView(tabs.get(activeTabId).view);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai-sidebar-shown');
  }
}

function hideAiSidebar() {
  if (!aiSidebarOpen) return;
  aiSidebarOpen = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai-sidebar-hidden');
  }
  setImmediate(() => {
    if (activeTabId && tabs.has(activeTabId) && !aiSidebarOpen) {
      resizeBrowserView(tabs.get(activeTabId).view);
    }
  });
}

function toggleAiSidebar() {
  if (aiSidebarOpen) {
    hideAiSidebar();
  } else {
    showAiSidebar();
  }
}

function addTab(url = NEWTAB_URL, activate = true) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const tabId = nextTabId++;
  const view = createBrowserView(url);

  tabs.set(tabId, {
    view,
    url,
    title: isNewTabUrl(url) ? 'New Tab' : url,
    zoomLevel: 0
  });

  if (activate) {
    switchTab(tabId);
  }

  try {
    mainWindow.webContents.send('tab-created', tabId, url, isNewTabUrl(url) ? 'New Tab' : url);
  } catch {}

  return tabId;
}

function removeTab(tabId) {
  if (!tabs.has(tabId)) return;

  const { view } = tabs.get(tabId);
  const wasActive = tabId === activeTabId;

  // Save for Ctrl+Shift+T restore
  closedTabs.push({ url: tab.url, title: tab.title })
  if (closedTabs.length > 32) closedTabs.shift()

  try { mainWindow.removeBrowserView(view); } catch {}
  try { if (!view.webContents.isDestroyed()) view.webContents.destroy(); } catch {}

  tabs.delete(tabId);

  try { mainWindow.webContents.send('tab-removed', tabId); } catch {}

  if (wasActive) {
    activeTabId = null;
    const tabIds = Array.from(tabs.keys());
    if (tabIds.length > 0) {
      switchTab(tabIds[tabIds.length - 1]);
    }
  }
}

function getTabBySender(sender) {
  for (const [id, tab] of tabs) {
    if (tab.view.webContents === sender) return id;
  }
  return null;
}

function safeIpc(fn) {
  return async (event, ...args) => {
    try { return await fn(event, ...args); }
    catch (e) { console.error('[Dawn] IPC error:', e.message); return null; }
  };
}

ipcMain.handle('navigate', safeIpc((event, url) => {
  const tabId = getTabBySender(event.sender) || activeTabId;
  if (!tabId || !tabs.has(tabId)) return;
  const tab = tabs.get(tabId);
  if (tab.view.webContents.isDestroyed()) return;
  const loadUrl = isNewTabUrl(url) ? getNewTabUrl() : isSettingsUrl(url) ? getSettingsUrl() : url;
  tab.url = url;
  if (url.startsWith('dawn://doc/')) {
    // Document tabs don't load in BrowserView
    return;
  }
  tab.view.webContents.loadURL(loadUrl).catch(e => {
    console.error('[Dawn] Navigate failed:', e.message);
  });
}));

ipcMain.handle('go-back', safeIpc(() => {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const { view } = tabs.get(activeTabId);
  if (!view.webContents.isDestroyed() && view.webContents.canGoBack()) view.webContents.goBack();
}));

ipcMain.handle('go-forward', safeIpc(() => {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const { view } = tabs.get(activeTabId);
  if (!view.webContents.isDestroyed() && view.webContents.canGoForward()) view.webContents.goForward();
}));

ipcMain.handle('reload', safeIpc(() => {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const { view } = tabs.get(activeTabId);
  if (!view.webContents.isDestroyed()) view.webContents.reload();
}));

ipcMain.handle('create-tab', safeIpc((event, url) => {
  return addTab(url || NEWTAB_URL, true);
}));

ipcMain.handle('close-tab', safeIpc((event, tabId) => {
  removeTab(tabId);
}));

ipcMain.handle('switch-tab', safeIpc((event, tabId) => {
  switchTab(tabId);
}));

ipcMain.handle('get-tabs', safeIpc(() => {
  const tabList = [];
  tabs.forEach((tab, id) => { tabList.push({ id, url: tab.url, title: tab.title }); });
  return tabList;
}));

ipcMain.handle('get-active-tab', safeIpc(() => {
  return activeTabId;
}));

ipcMain.handle('window-minimize', safeIpc(() => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
}));

ipcMain.handle('window-maximize', safeIpc(() => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  }
}));

ipcMain.handle('window-close', safeIpc(() => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
}));

ipcMain.handle('toggle-ai-float', safeIpc(() => {
  toggleAiSidebar();
}));

ipcMain.handle('show-ai-float', safeIpc(() => {
  showAiSidebar();
}));

ipcMain.handle('hide-ai-float', safeIpc(() => {
  hideAiSidebar();
}));

ipcMain.handle('resize-ai-float', safeIpc((event, width) => {
  const w = Math.max(320, Math.min(600, Math.round(Number(width) || 420)));
  if (w !== aiSidebarWidth) {
    aiSidebarWidth = w;
    if (aiSidebarOpen && activeTabId && tabs.has(activeTabId)) {
      resizeBrowserView(tabs.get(activeTabId).view);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-sidebar-width-changed', w);
    }
  }
}));

ipcMain.handle('toggle-tab-sidebar', safeIpc(() => {
  tabSidebarOpen = !tabSidebarOpen;
  if (activeTabId && tabs.has(activeTabId)) {
    resizeBrowserView(tabs.get(activeTabId).view);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-sidebar-toggled', tabSidebarOpen);
  }
  return tabSidebarOpen;
}));

ipcMain.handle('show-browser-view', safeIpc(() => {
  if (activeTabId && tabs.has(activeTabId)) {
    const { view } = tabs.get(activeTabId);
    try { mainWindow.addBrowserView(view); } catch {}
    resizeBrowserView(view);
  }
}));

ipcMain.handle('hide-browser-view', safeIpc(() => {
  if (activeTabId && tabs.has(activeTabId)) {
    const { view } = tabs.get(activeTabId);
    try { mainWindow.removeBrowserView(view); } catch {}
  }
}));

function getActiveView() {
  if (!activeTabId || !tabs.has(activeTabId)) return null;
  const { view } = tabs.get(activeTabId);
  if (view.webContents.isDestroyed()) return null;
  return view;
}

ipcMain.handle('get-page-content', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return null;
  return view.webContents.executeJavaScript(`
    (function() {
      try {
        var title = document.title || '';
        var url = window.location.href || '';
        var description = '';
        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) description = metaDesc.content || '';
        if (!description) {
          var ogDesc = document.querySelector('meta[property="og:description"]');
          if (ogDesc) description = ogDesc.content || '';
        }

        var bodyText = '';
        if (document.body) {
          var clone = document.body.cloneNode(true);
          var removals = clone.querySelectorAll('script, style, nav, footer, header, .sidebar, .ad, .advertisement, [role="navigation"], noscript, iframe, svg');
          removals.forEach(function(el) { el.remove(); });
          bodyText = (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim().substring(0, 8000);
        }

        var headings = [];
        var hTags = document.querySelectorAll('h1, h2, h3');
        hTags.forEach(function(h) {
          headings.push(h.tagName + ': ' + (h.textContent || '').trim().substring(0, 100));
        });

        var links = [];
        var aTags = document.querySelectorAll('a[href]');
        aTags.forEach(function(a) {
          var href = a.getAttribute('href');
          var text = (a.textContent || '').trim().substring(0, 60);
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            links.push(text + ' -> ' + href);
          }
        });

        return {
          title: title,
          url: url,
          description: description,
          bodyText: bodyText,
          headings: headings.slice(0, 30),
          links: links.slice(0, 50)
        };
      } catch(e) {
        return {
          title: document.title || '',
          url: window.location.href || '',
          description: '',
          bodyText: (document.body && document.body.innerText ? document.body.innerText.substring(0, 8000) : ''),
          headings: [],
          links: []
        };
      }
    })()
  `);
}));

ipcMain.handle('get-page-html', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return '';
  return view.webContents.executeJavaScript('document.documentElement.outerHTML');
}));

ipcMain.handle('get-page-selection', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return '';
  return view.webContents.executeJavaScript('window.getSelection().toString()');
}));

ipcMain.handle('capture-page', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return null;
  const image = await view.webContents.capturePage();
  return image.toDataURL();
}));

ipcMain.handle('execute-on-page', safeIpc(async (event, script) => {
  const view = getActiveView();
  if (!view) return { error: 'No active page' };
  try {
    const result = await view.webContents.executeJavaScript(script);
    return { result: result };
  } catch (e) {
    return { error: e.message };
  }
}));

ipcMain.handle('get-page-metadata', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return null;
  return view.webContents.executeJavaScript(`
    (function() {
      var title = document.title || '';
      var url = window.location.href || '';
      var description = document.querySelector('meta[name="description"]') ? document.querySelector('meta[name="description"]').content : '';
      var favicon = document.querySelector('link[rel*="icon"]') ? document.querySelector('link[rel*="icon"]').href : '';
      return { title: title, url: url, description: description, favicon: favicon };
    })()
  `);
}));

ipcMain.handle('navigate-to', safeIpc(async (event, url) => {
  const view = getActiveView();
  if (!view) return { ok: false, error: 'No active browser tab' };
  // Normalize URL: add https:// if no protocol
  if (!/^https?:\/\//i.test(url) && !url.startsWith('file://') && !url.startsWith('dawn://')) {
    url = 'https://' + url;
  }
  try {
    await view.webContents.loadURL(url);
  } catch (e) {
    console.error('[Dawn] navigate-to loadURL failed:', e.message);
    return { ok: false, error: e.message };
  }
  // Ensure BrowserView is visible when navigating to a real URL
  if (mainWindow && !mainWindow.isDestroyed() && !isNewTabUrl(url) && !isSettingsUrl(url)) {
    resizeBrowserView(view);
    try { mainWindow.addBrowserView(view); } catch {}
  }
  return { ok: true, url };
}));

ipcMain.handle('web-search', safeIpc(async (event, query) => {
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
  addTab(url, true);
  return { status: 'opened', url: url };
}));

ipcMain.handle('get-page-dom-snapshot', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return null;
  return view.webContents.executeJavaScript(`
    (function() {
      try {
        var forms = [];
        document.querySelectorAll('form').forEach(function(form, fi) {
          var fields = [];
          form.querySelectorAll('input, select, textarea').forEach(function(el) {
            var label = '';
            var labelEl = el.closest('label') || document.querySelector('label[for="' + (el.id || '') + '"]');
            if (labelEl) label = (labelEl.textContent || '').trim().substring(0, 50);
            fields.push({
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              name: el.name || '',
              id: el.id || '',
              placeholder: el.placeholder || '',
              label: label,
              selector: el.id ? '#' + el.id : (el.name ? el.tagName.toLowerCase() + '[name="' + el.name + '"]' : el.tagName.toLowerCase() + ':nth-of-type(' + (Array.from(el.parentElement.children).indexOf(el)+1) + ')')
            });
          });
          forms.push({ index: fi, fields: fields.slice(0, 20), action: form.action || '', method: form.method || 'get' });
        });
        var buttons = [];
        document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(function(el) {
          var text = (el.textContent || el.value || '').trim().substring(0, 40);
          var selector = el.id ? '#' + el.id : (el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase());
          if (text) buttons.push({ text: text, selector: selector });
        });
        return { forms: forms.slice(0, 3), buttons: buttons.slice(0, 20) };
      } catch(e) { return { forms: [], buttons: [] }; }
    })()
  `);
}));

ipcMain.handle('inject-content-script', safeIpc(async () => {
  const view = getActiveView();
  if (!view) return false;
  await view.webContents.executeJavaScript(`
    if (!window.__dawnInjected) {
      window.__dawnInjected = true;
      window.__dawnAPI = {
        click: function(selector) {
          var el = document.querySelector(selector);
          if (!el) return { error: 'Element not found: ' + selector };
          el.click();
          return { ok: true, tag: el.tagName.toLowerCase() };
        },
        fill: function(selector, value) {
          var el = document.querySelector(selector);
          if (!el) return { error: 'Element not found: ' + selector };
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: value };
        },
        select: function(selector, value) {
          var el = document.querySelector(selector);
          if (!el) return { error: 'Element not found: ' + selector };
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        },
        scroll: function(direction, amount) {
          var amt = amount || 300;
          window.scrollBy({ top: direction === 'down' ? amt : -amt, behavior: 'smooth' });
          return { ok: true };
        },
        hover: function(selector) {
          var el = document.querySelector(selector);
          if (!el) return { error: 'Element not found: ' + selector };
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          return { ok: true };
        },
        wait: function(selector, timeout) {
          return new Promise(function(resolve) {
            var el = document.querySelector(selector);
            if (el) { resolve({ ok: true, immediate: true }); return; }
            var start = Date.now();
            var max = timeout || 5000;
            var observer = new MutationObserver(function() {
              var el = document.querySelector(selector);
              if (el) { observer.disconnect(); resolve({ ok: true, waited: Date.now() - start }); }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(function() { observer.disconnect(); resolve({ timeout: true, waited: max }); }, max);
          });
        }
      };
    }
  `);
  return true;
}));

/* ── Find-in-page ── */
let findText = ''
ipcMain.handle('find-in-page', safeIpc(async (event, text) => {
  const view = getActiveView()
  if (!view || view.webContents.isDestroyed()) return { matches: 0 }
  findText = text
  if (text) {
    view.webContents.findInPage(text, { forward: true, findNext: false })
  } else {
    view.webContents.stopFindInPage('clearSelection')
    return { matches: 0 }
  }
  // Wait for found-in-page result
  return new Promise((resolve) => {
    const handler = (e, result) => {
      view.webContents.removeListener('found-in-page', handler)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('found-in-page', result)
      }
      resolve(result)
    }
    view.webContents.on('found-in-page', handler)
  })
}))
ipcMain.handle('get-downloads', safeIpc(() => {
  return Array.from(downloads.values())
}))
ipcMain.handle('cancel-download', safeIpc((event, dlId) => {
  const dl = downloads.get(dlId)
  if (dl) { dl.state = 'cancelled'; downloads.delete(dlId) }
}))
ipcMain.handle('open-download-file', safeIpc(async (event, filePath) => {
  if (filePath) await shell.openPath(filePath)
}))
ipcMain.handle('clear-downloads', safeIpc(() => {
  downloads.clear()
}))

/* ── Panel overlay window (floats above BrowserView) ── */
let panelWindow = null
let panelMode = ''

function closePanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    try {
      panelWindow.removeAllListeners('blur')
      panelWindow.close()
    } catch {}
  }
  panelWindow = null
  panelMode = ''
}

function updatePanelPosition() {
  if (!panelWindow || panelWindow.isDestroyed() || !mainWindow) return
  const mwBounds = mainWindow.getBounds()
  const contentSize = mainWindow.getContentSize()
  const chromeH = mwBounds.height - contentSize[1]
  const toolbarBottom = chromeH + 74 // titlebar(36) + toolbar(38) → just below the toolbar buttons
  const maxHeight = contentSize[1] - 74 // remaining space below toolbar
  const panelW = 400
  const panelH = Math.min(480, maxHeight)
  panelWindow.setBounds({
    x: mwBounds.x + mwBounds.width - panelW - 8, // 8px margin from right edge
    y: mwBounds.y + toolbarBottom + 4,            // 4px gap below toolbar
    width: panelW,
    height: panelH
  })
}

function showPanelWindow(mode) {
  if (panelWindow && !panelWindow.isDestroyed() && panelMode === mode) {
    closePanelWindow()
    return
  }
  closePanelWindow()

  updatePanelPosition()
  panelMode = mode
  panelWindow = new BrowserWindow({
    parent: mainWindow,
    frame: false,
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#f7f4ed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // In dev, load from Vite server; in prod, load from file
  const panelUrl = isDev
    ? getDevServerUrl() + '/panel-overlay.html'
    : 'file://' + path.join(__dirname, '../dist/panel-overlay.html')

  panelWindow.loadURL(panelUrl)
  panelWindow.once('ready-to-show', () => {
    updatePanelPosition()
    panelWindow.show()
    panelWindow.webContents.send('panel-mode', mode)
  })

  // Auto-close when clicking outside (panel loses focus)
  panelWindow.on('blur', () => {
    closePanelWindow()
  })

  // Also close on Escape key in panel
  panelWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      closePanelWindow()
    }
  })

  // Follow main window when moved/resized
  const followMain = () => { if (panelWindow && !panelWindow.isDestroyed()) updatePanelPosition() }
  if (mainWindow) {
    mainWindow.on('move', followMain)
    mainWindow.on('resize', followMain)
  }
  panelWindow.on('closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeListener('move', followMain)
      mainWindow.removeListener('resize', followMain)
    }
    panelWindow = null
    panelMode = ''
  })
}

// Pass data from main window to panel
ipcMain.handle('panel-get-data', safeIpc(async (event, mode) => {
  if (mode === 'history') {
    try { return await mainWindow.webContents.executeJavaScript('window.__panelHistoryData') } catch { return null }
  }
  if (mode === 'downloads') {
    return Array.from(downloads.values())
  }
  return null
}))

ipcMain.handle('show-panel', safeIpc((event, mode) => {
  showPanelWindow(mode)
}))

ipcMain.handle('hide-panel', safeIpc(() => {
  closePanelWindow()
}))

ipcMain.handle('panel-action', safeIpc(async (event, action) => {
  // Forward actions from panel back to main window renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('panel-action', action)
  }
}))

/* ── Page zoom ── */
function getActiveTab() {
  if (!activeTabId || !tabs.has(activeTabId)) return null
  return tabs.get(activeTabId)
}
function adjustZoom(delta) {
  const tab = getActiveTab()
  if (!tab || tab.view.webContents.isDestroyed()) return
  tab.zoomLevel = Math.max(-5, Math.min(5, (tab.zoomLevel || 0) + delta))
  tab.view.webContents.setZoomLevel(tab.zoomLevel)
  if (mainWindow) mainWindow.webContents.send('zoom-changed', tab.zoomLevel)
}
ipcMain.handle('zoom-in', safeIpc(() => adjustZoom(0.5)))
ipcMain.handle('zoom-out', safeIpc(() => adjustZoom(-0.5)))
ipcMain.handle('zoom-reset', safeIpc(() => {
  const tab = getActiveTab()
  if (!tab || tab.view.webContents.isDestroyed()) return
  tab.zoomLevel = 0
  tab.view.webContents.setZoomLevel(0)
  if (mainWindow) mainWindow.webContents.send('zoom-changed', 0)
}))
ipcMain.handle('get-platform', safeIpc(() => process.platform))

ipcMain.handle('get-zoom', safeIpc(() => {
  const tab = getActiveTab()
  return tab ? (tab.zoomLevel || 0) : 0
}))

ipcMain.handle('restore-closed-tab', safeIpc(() => {
  if (closedTabs.length === 0) return null
  const entry = closedTabs.pop()
  return addTab(entry.url, true)
}))

ipcMain.handle('stop-find-in-page', safeIpc(() => {
  const view = getActiveView()
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.stopFindInPage('clearSelection')
  }
  findText = ''
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('find-in-page-closed')
  }
}))

ipcMain.handle('encrypt-secret', safeIpc((event, plaintext) => {
  if (!plaintext) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plaintext).toString('base64');
    }
  } catch (e) {
    console.error('[Dawn] Encryption failed:', e.message);
  }
  return plaintext;
}));

ipcMain.handle('decrypt-secret', safeIpc((event, ciphertext) => {
  if (!ciphertext) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
    }
  } catch (e) {
    console.error('[Dawn] Decryption failed:', e.message);
  }
  return ciphertext;
}));

ipcMain.handle('open-external', safeIpc(async (event, url) => {
  try {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return true;
  } catch (e) {
    return false;
  }
}));

ipcMain.handle('export-data', safeIpc(async () => {
  const exportData = { conversations: [], config: {}, bookmarks: [], version: '1.0', exportedAt: new Date().toISOString() };
  return JSON.stringify(exportData);
}));

ipcMain.handle('import-data', safeIpc(async (event, jsonStr) => {
  try {
    JSON.parse(jsonStr);
    return { success: true, count: 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}));

const fs = require('fs');

ipcMain.handle('open-file-dialog', safeIpc(async (event, filters) => {
  const { dialog, BrowserWindow } = require('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: filters || [
      { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'txt', 'md', 'html'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const buf = fs.readFileSync(filePath);
  const ext = filePath.split('.').pop().toLowerCase();
  return {
    filePath,
    fileName: filePath.split(/[/\\]/).pop(),
    ext,
    data: buf.toString('base64'),
    size: buf.length
  };
}));

ipcMain.handle('read-file-base64', safeIpc(async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const ext = filePath.split('.').pop().toLowerCase();
  return {
    filePath,
    fileName: filePath.split(/[/\\]/).pop(),
    ext,
    data: buf.toString('base64'),
    size: buf.length
  };
}));

ipcMain.handle('download-url', safeIpc(async (event, url) => {
  if (!url) return null;
  const isLocalFile = /^file:\/\/\//i.test(url);
  if (isLocalFile) {
    // file:/// URL → read from disk
    const filePath = decodeURIComponent(url.replace(/^file:\/\/\//i, ''));
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    const ext = filePath.split('.').pop().toLowerCase();
    return {
      filePath,
      fileName: filePath.split(/[/\\]/).pop(),
      ext,
      data: buf.toString('base64'),
      size: buf.length
    };
  }
  // Remote URL → download via net.fetch
  try {
    const response = await net.fetch(url);
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const buf = Buffer.from(await response.arrayBuffer());
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split('/').pop() || 'download';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return {
      filePath: url,
      fileName,
      ext,
      data: buf.toString('base64'),
      size: buf.length
    };
  } catch (e) {
    return { error: e.message };
  }
}));

function setupKeyboardShortcuts() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const shift = input.shift;

    if (ctrl && input.key === 't') {
      event.preventDefault();
      addTab(NEWTAB_URL, true);
      return;
    }
    if (ctrl && input.key === 'w') {
      event.preventDefault();
      if (activeTabId && tabs.has(activeTabId)) removeTab(activeTabId);
      return;
    }
    if (ctrl && input.key === 'Tab') {
      event.preventDefault();
      const tabIds = Array.from(tabs.keys());
      if (tabIds.length <= 1) return;
      const index = tabIds.indexOf(activeTabId);
      const nextIndex = shift
        ? (index - 1 + tabIds.length) % tabIds.length
        : (index + 1) % tabIds.length;
      switchTab(tabIds[nextIndex]);
      return;
    }
    if (ctrl && input.key === 'l') {
      event.preventDefault();
      try { mainWindow.webContents.send('focus-address-bar'); } catch {}
      return;
    }
    if (input.key === 'F5' || (ctrl && input.key === 'r')) {
      event.preventDefault();
      if (activeTabId && tabs.has(activeTabId)) {
        const { view } = tabs.get(activeTabId);
        if (!view.webContents.isDestroyed()) view.webContents.reload();
      }
      return;
    }
    if (ctrl && shift && (input.key === 'a' || input.key === 'A')) {
      event.preventDefault();
      toggleAiSidebar();
      try { mainWindow.webContents.send('toggle-ai-sidebar'); } catch {}
      return;
    }
    if (ctrl && input.key === 'f') {
      event.preventDefault();
      try { mainWindow.webContents.send('focus-find-bar'); } catch {}
      return;
    }
    if (ctrl && shift && input.key === 't') {
      event.preventDefault();
      if (closedTabs.length > 0) {
        const entry = closedTabs.pop()
        addTab(entry.url, true)
      }
      return;
    }
    if (ctrl && input.key === 'h') {
      event.preventDefault();
      try { mainWindow.webContents.send('toggle-history'); } catch {}
      return;
    }
    if (ctrl && (input.key === '=' || input.key === '+')) {
      event.preventDefault();
      adjustZoom(0.5)
      return;
    }
    if (ctrl && input.key === '-') {
      event.preventDefault();
      adjustZoom(-0.5)
      return;
    }
    if (ctrl && input.key === '0') {
      event.preventDefault();
      const tab = getActiveTab()
      if (tab && !tab.view.webContents.isDestroyed()) {
        tab.zoomLevel = 0
        tab.view.webContents.setZoomLevel(0)
      }
      return;
    }
  });
}

/* ── Multi-window: open current page URL in standalone window ── */
ipcMain.handle('new-window', safeIpc(() => {
  const view = getActiveView()
  if (!view || view.webContents.isDestroyed()) return { ok: false, error: 'No active page' }
  const currentUrl = view.webContents.getURL()
  if (!currentUrl || currentUrl.startsWith('dawn://') || currentUrl.startsWith('file://')) {
    return { ok: false, error: 'Cannot open this page in a new window' }
  }
  const newWin = new BrowserWindow({
    width: 1200, height: 800, icon: APP_ICON, title: 'Dawn',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  newWin.loadURL(currentUrl)
  newWin.once('ready-to-show', () => newWin.show())
  return { ok: true }
}))

app.whenReady().then(async () => {
  createMainWindow();

  if (isDev) {
    const ready = await waitForViteServer();
    if (!ready) {
      console.error('[Dawn] Cannot start: Vite dev server not available');
      mainWindow.loadURL('data:text/html,<h2 style="font-family:sans-serif;padding:40px">Dawn: Waiting for dev server...<br><small>Please restart the app.</small></h2>');
      mainWindow.show();
      return;
    }
  }

  await loadMainWindow();

  setupKeyboardShortcuts();

  const initialTabId = addTab(NEWTAB_URL, true);
  if (initialTabId) {
    mainWindow.webContents.send('tabs-initialized', [{ id: initialTabId, url: NEWTAB_URL, title: 'New Tab' }], initialTabId);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      loadMainWindow().then(() => {
        setupKeyboardShortcuts();
        const initialTabId = addTab(NEWTAB_URL, true);
        if (initialTabId) {
          mainWindow.webContents.send('tabs-initialized', [{ id: initialTabId, url: NEWTAB_URL, title: 'New Tab' }], initialTabId);
        }
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ── Clear on exit ── */
ipcMain.handle('clear-on-exit', safeIpc(async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.session.clearStorageData()
    mainWindow.webContents.executeJavaScript('localStorage.clear();indexedDB.deleteDatabase("dawn-ai-memory")')
  }
  for (const [id, tab] of tabs) {
    try { tab.view.webContents.session.clearStorageData() } catch {}
  }
}))