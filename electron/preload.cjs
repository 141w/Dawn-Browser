
const { contextBridge, ipcRenderer } = require('electron');

const validChannels = new Set([
  'did-navigate',
  'did-navigate-in-page',
  'will-navigate',
  'title-updated',
  'nav-state-changed',
  'page-loading',
  'tab-switched',
  'tabs-initialized',
  'tab-created',
  'tab-removed',
  'focus-address-bar',
  'favicon-updated',
  'page-context-updated',
  'toggle-ai-sidebar',
  'tab-sidebar-toggled',
  'ai-sidebar-shown',
  'ai-sidebar-hidden',
  'ai-sidebar-width-changed',
  'ai-float-shown',
  'ai-float-hidden',
  'ai-float-closed',
  'open-document-url',
  'found-in-page',
  'find-in-page-closed',
  'focus-find-bar',
  'history-entry',
  'toggle-history',
  'download-started',
  'download-progress',
  'download-completed',
  'panel-mode',
  'panel-action',
  'zoom-changed',
  'store:changed',
  'mcp:status-changed',
  'scheduler:task-updated',
  'scheduler:execute'
]);

const subscriptions = new Map();

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('switch-tab', tabId),
  getTabs: () => ipcRenderer.invoke('get-tabs'),
  getActiveTab: () => ipcRenderer.invoke('get-active-tab'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
    windowMaximize: () => ipcRenderer.invoke('window-maximize'),
    windowClose: () => ipcRenderer.invoke('window-close'),
    toggleAiFloat: () => ipcRenderer.invoke('toggle-ai-float'),
    showAiFloat: () => ipcRenderer.invoke('show-ai-float'),
    hideAiFloat: () => ipcRenderer.invoke('hide-ai-float'),
    resizeAiFloat: (w, h) => ipcRenderer.invoke('resize-ai-float', w, h),
    toggleTabSidebar: () => ipcRenderer.invoke('toggle-tab-sidebar'),
    showBrowserView: () => ipcRenderer.invoke('show-browser-view'),
    hideBrowserView: () => ipcRenderer.invoke('hide-browser-view'),

    getPageContent: () => ipcRenderer.invoke('get-page-content'),
    getPageHtml: () => ipcRenderer.invoke('get-page-html'),
    getPageSelection: () => ipcRenderer.invoke('get-page-selection'),
    capturePage: () => ipcRenderer.invoke('capture-page'),
    executeOnPage: (script) => ipcRenderer.invoke('execute-on-page', script),
    executeScriptSandbox: (script) => ipcRenderer.invoke('execute-script-sandbox', script),
    getPageMetadata: () => ipcRenderer.invoke('get-page-metadata'),
    navigateTo: (url) => ipcRenderer.invoke('navigate-to', url),
    webSearch: (query) => ipcRenderer.invoke('web-search', query),
    getPageDomSnapshot: () => ipcRenderer.invoke('get-page-dom-snapshot'),
    injectContentScript: () => ipcRenderer.invoke('inject-content-script'),
    encryptSecret: (text) => ipcRenderer.invoke('encrypt-secret', text),
    decryptSecret: (text) => ipcRenderer.invoke('decrypt-secret', text),
    findInPage: (text) => ipcRenderer.invoke('find-in-page', text),
    stopFindInPage: () => ipcRenderer.invoke('stop-find-in-page'),
    restoreClosedTab: () => ipcRenderer.invoke('restore-closed-tab'),
    getDownloads: () => ipcRenderer.invoke('get-downloads'),
    cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
    openDownloadFile: (path) => ipcRenderer.invoke('open-download-file', path),
    clearDownloads: () => ipcRenderer.invoke('clear-downloads'),
    showPanel: (mode) => ipcRenderer.invoke('show-panel', mode),
    hidePanel: () => ipcRenderer.invoke('hide-panel'),
    panelAction: (action) => ipcRenderer.invoke('panel-action', action),
    zoomIn: () => ipcRenderer.invoke('zoom-in'),
    zoomOut: () => ipcRenderer.invoke('zoom-out'),
    zoomReset: () => ipcRenderer.invoke('zoom-reset'),
    newWindow: () => ipcRenderer.invoke('new-window'),
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    getZoom: () => ipcRenderer.invoke('get-zoom'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    exportData: () => ipcRenderer.invoke('export-data'),
    importData: (json) => ipcRenderer.invoke('import-data', json),
    openFileDialog: (filters) => ipcRenderer.invoke('open-file-dialog', filters),
    readFileAsBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
    downloadUrl: (url) => ipcRenderer.invoke('download-url', url),
    storeGet: (key) => ipcRenderer.invoke('store:get', key),
    storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
    storeDelete: (key) => ipcRenderer.invoke('store:delete', key),
    mcpStartServer: (config) => ipcRenderer.invoke('mcp:start-server', config),
    mcpStopServer: (id) => ipcRenderer.invoke('mcp:stop-server', id),
    mcpGetStatuses: () => ipcRenderer.invoke('mcp:get-statuses'),
    mcpGetTools: () => ipcRenderer.invoke('mcp:get-tools'),
    mcpCallTool: (name, args) => ipcRenderer.invoke('mcp:call-tool', name, args),
    mcpSetConfigs: (configs) => ipcRenderer.invoke('mcp:set-configs', configs),
    mcpAutoStart: () => ipcRenderer.invoke('mcp:auto-start'),
    runScript: (language, code, timeout) => ipcRenderer.invoke('run-script', language, code, timeout),
    killScripts: () => ipcRenderer.invoke('kill-scripts'),
    agentMemoryEnsure: () => ipcRenderer.invoke('agent-memory:ensure'),
    agentMemoryCreateTask: (id, goal) => ipcRenderer.invoke('agent-memory:create-task', id, goal),
    agentMemoryAddStep: (taskId, tool, input, output) => ipcRenderer.invoke('agent-memory:add-step', taskId, tool, input, output),
    agentMemoryUpdateTask: (taskId, status) => ipcRenderer.invoke('agent-memory:update-task', taskId, status),
    agentMemoryGetTask: (taskId) => ipcRenderer.invoke('agent-memory:get-task', taskId),
    agentMemoryListTasks: (status, limit) => ipcRenderer.invoke('agent-memory:list-tasks', status, limit),
    agentMemoryDeleteTask: (taskId) => ipcRenderer.invoke('agent-memory:delete-task', taskId),
    schedulerAddTask: (task) => ipcRenderer.invoke('scheduler:add-task', task),
    schedulerRemoveTask: (id) => ipcRenderer.invoke('scheduler:remove-task', id),
    schedulerPauseTask: (id) => ipcRenderer.invoke('scheduler:pause-task', id),
    schedulerResumeTask: (id) => ipcRenderer.invoke('scheduler:resume-task', id),
    schedulerMarkDone: (id, result) => ipcRenderer.invoke('scheduler:mark-done', id, result),
    schedulerMarkFailed: (id, error) => ipcRenderer.invoke('scheduler:mark-failed', id, error),
    schedulerListTasks: () => ipcRenderer.invoke('scheduler:list-tasks'),
    schedulerGetTask: (id) => ipcRenderer.invoke('scheduler:get-task', id),

    // Skill management
    skillInstallGithub: (url, useSymlink) => ipcRenderer.invoke('skill:install-github', url, useSymlink),
    skillInstallZip: () => ipcRenderer.invoke('skill:install-zip'),
    skillUninstall: (name) => ipcRenderer.invoke('skill:uninstall', name),
    skillUpdate: (name) => ipcRenderer.invoke('skill:update', name),
    skillList: () => ipcRenderer.invoke('skill:list'),
    skillOpenFolder: (name) => ipcRenderer.invoke('skill:open-folder', name),

  on: (channel, callback) => {
    if (!validChannels.has(channel)) return;
    const handler = (event, ...args) => {
      try {
        callback(...args);
      } catch (e) {
        console.error('[Dawn] Event handler error:', e);
      }
    };
    ipcRenderer.on(channel, handler);
    if (!subscriptions.has(channel)) {
      subscriptions.set(channel, new Set());
    }
    subscriptions.get(channel).add({ original: callback, wrapped: handler });
  },

  off: (channel, callback) => {
    if (!validChannels.has(channel)) return;
    const subs = subscriptions.get(channel);
    if (!subs) return;
    for (const sub of subs) {
      if (sub.original === callback) {
        ipcRenderer.removeListener(channel, sub.wrapped);
        subs.delete(sub);
        break;
      }
    }
  }
});
