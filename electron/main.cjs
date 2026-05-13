const { app, BrowserWindow, ipcMain, BrowserView, net, nativeImage, safeStorage, globalShortcut } = require('electron');
const path = require('path');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

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
    // Show/hide BrowserView: hide for dawn:// pages, show for web
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      if (!isDawn) {
        resizeBrowserView(view);
        try { mainWindow.addBrowserView(view); } catch {}
      } else {
        try { mainWindow.removeBrowserView(view); } catch {}
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

  view.webContents.on('render-process-gone', (event, details) => {
    console.error('[Dawn] Render process gone:', details.reason);
    const tabId = getTabIdByView(view);
    if (tabId) removeTab(tabId);
  });

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
    view.webContents.setZoomLevel(0);
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
    title: isNewTabUrl(url) ? 'New Tab' : url
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
  if (!view) return false;
  view.webContents.loadURL(url);
  // Ensure BrowserView is visible when navigating to a real URL
  if (mainWindow && !mainWindow.isDestroyed() && !isNewTabUrl(url) && !isSettingsUrl(url)) {
    resizeBrowserView(view);  // set bounds before adding
    try { mainWindow.addBrowserView(view); } catch {}
  }
  return true;
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
  });
}

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