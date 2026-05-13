<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import AiSidebar from "./AiSidebar.vue";
import HomeAI from "./HomeAI.vue";
import TabSidebar from "./TabSidebar.vue";
import DocumentViewer from "./DocumentViewer.vue";
import { t } from "./composables/useI18n";
import { useTips } from "./composables/useTips";
import { useTabGroups } from "./composables/useTabGroups";
import { useBrowserTabs } from "./composables/useBrowserTabs";

const { userTips, addTip, deleteTip } = useTips();
const { tabSidebarOpen, tabGroups, toggleSidebar, autoGroupTabs } = useTabGroups();
const { setTabs: syncBrowserTabs, setActiveTab: syncActiveTab } = useBrowserTabs();

const tabs = ref([]);
const activeTabId = ref(null);

function syncTabsToStore() {
  syncBrowserTabs(tabs.value)
  syncActiveTab(activeTabId.value)
}
watch([tabs, activeTabId], syncTabsToStore, { deep: true, immediate: true })
const currentUrl = ref("");
const canGoBack = ref(false);
const canGoForward = ref(false);
const isLoading = ref(false);
const addressInput = ref(null);
const showAi = ref(false);
const aiSidebarVisible = ref(false);
const aiSidebarWidth = ref(420);
const showTipEditor = ref(false);
const showViewer = ref(false);
const viewingDoc = ref(null);
const docDataMap = ref({});    // tabId → { fileName, ext, data, filePath }
const docDataByUrl = ref({});  // url → { fileName, ext, data, filePath } (set before createTab)
const newTipForm = ref({ name: '', description: '', prompt: '' });

const DOC_EXTENSIONS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'txt', 'md', 'html', 'xml', 'json', 'js', 'ts', 'py', 'css'];

/* ── Computed ── */
const isOnHomePage = computed(() => {
  return !currentUrl.value || currentUrl.value === '' || currentUrl.value === 'dawn://newtab';
});

const activeDocData = computed(() => {
  if (!activeTabId.value) return null
  return docDataMap.value[activeTabId.value] || null
});

const isViewingDoc = computed(() => {
  return activeDocData.value != null || (currentUrl.value && currentUrl.value.startsWith('dawn://doc/'))
});

/* ── AI toggle ── */
function toggleAi() {
  if (isOnHomePage.value) return; // disabled on home page
  const next = !aiSidebarVisible.value;
  aiSidebarVisible.value = next;
  showAi.value = next;
  if (next) window.electronAPI?.showAiFloat();
  else window.electronAPI?.hideAiFloat();
}

/* ── Tab sidebar ── */
async function handleToggleSidebar() {
  const result = await window.electronAPI?.toggleTabSidebar();
  if (typeof result === 'boolean') {
    tabSidebarOpen.value = result;
  } else {
    // Fallback if IPC not available
    toggleSidebar();
  }
}

/* ── Navigation ── */
async function navigate() {
  let url = currentUrl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url) && !/^dawn:\/\//i.test(url) && !/^file:\/\/\//i.test(url)) {
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(url)) url = "https://" + url;
    else url = "https://www.google.com/search?q=" + encodeURIComponent(url);
  }
  // Check if this is a document URL → view inline
  if (isDocUrl(url)) {
    await openDocUrl(url)
    return
  }
  viewingDoc.value = null
  currentUrl.value = url;
  window.electronAPI?.navigate(url);
}

function isDocUrl(url) {
  try {
    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
    return ext && DOC_EXTENSIONS.includes(ext)
  } catch { return false }
}

let _docIdCounter = 0

function getDocDataByUrl(url) {
  return url ? docDataByUrl.value[url] : null
}

async function addDocTab(docData) {
  const docId = `doc_${++_docIdCounter}`
  const url = `dawn://doc/${docId}`
  // Store by URL before createTab — event handlers read this
  docDataByUrl.value[url] = docData
  let actualTabId = null
  try {
    actualTabId = await window.electronAPI?.createTab(url)
  } catch { actualTabId = null }
  if (actualTabId) {
    // Move to tabId-keyed map for fast lookup
    docDataMap.value[actualTabId] = docData
    // Update the tab title immediately
    const tab = tabs.value.find(t => t.id === actualTabId)
    if (tab) {
      tab.title = docData.fileName
      tab.docUrl = url
    }
  }
  return actualTabId
}

async function openDocUrl(url) {
  viewingDoc.value = null
  currentUrl.value = url
  try {
    const result = await window.electronAPI?.downloadUrl(url)
    if (result && !result.error) {
      addDocTab({ fileName: result.fileName, ext: result.ext, data: result.data, filePath: result.filePath || url })
    } else {
      window.electronAPI?.navigate(url)
    }
  } catch {
    window.electronAPI?.navigate(url)
  }
}

function closeViewer() {
  viewingDoc.value = null
  if (isOnHomePage.value) {
    currentUrl.value = ''
  }
}

async function openDocFile() {
  if (!window.electronAPI?.openFileDialog) return
  const result = await window.electronAPI.openFileDialog()
  if (result && !result.error) {
    await addDocTab({ fileName: result.fileName, ext: result.ext, data: result.data })
  }
}

function goBack() { window.electronAPI?.goBack(); }
function goForward() { window.electronAPI?.goForward(); }
function reload() { window.electronAPI?.reload(); }
function addNewTab(url) { window.electronAPI?.createTab(url || "dawn://newtab"); }
function closeTab(id) { if (tabs.value.length > 1) window.electronAPI?.closeTab(id); }

async function selectTab(id) {
  if (id === activeTabId.value) return;
  window.electronAPI?.switchTab(id);
}

function openSettings() { window.electronAPI?.createTab("dawn://settings"); }
function handleAutoGroup() { autoGroupTabs(tabs.value); }

/* ── Tab data ── */
function updateTabData(tabId, url, title) {
  const tab = tabs.value.find((t) => t.id === tabId);
  if (tab) { if (url !== undefined) tab.url = url; if (title !== undefined) tab.title = title; }
}

/* ── Event handlers ── */
async function handleDidNavigate(url, title) {
  if (isDocUrl(url)) { await openDocUrl(url); return }
  viewingDoc.value = null;
  const dd = getDocDataByUrl(url)
  if (dd) {
    currentUrl.value = dd.filePath || url
    title = dd.fileName || title
  } else {
    currentUrl.value = url;
  }
  updateTabData(activeTabId.value, url, title);
}
async function handleDidNavigateInPage(url, title) {
  if (isDocUrl(url)) { await openDocUrl(url); return }
  const dd = getDocDataByUrl(url)
  if (dd) { title = dd.fileName || title; currentUrl.value = dd.filePath || url }
  else { currentUrl.value = url }
  updateTabData(activeTabId.value, url, title);
}
function handleTitleUpdated(title) { updateTabData(activeTabId.value, undefined, title); }
function handleNavStateChanged(back, forward) { canGoBack.value = back; canGoForward.value = forward; }
function handlePageLoading(loading) { isLoading.value = loading; }

function handleTabCreated(tabId, url, title) {
  if (!tabs.value.find((t) => t.id === tabId)) {
    const dd = getDocDataByUrl(url)
    if (dd) title = dd.fileName || title
    tabs.value.push({ id: tabId, url, title });
  }
}
function handleTabRemoved(tabId) {
  tabs.value = tabs.value.filter((t) => t.id !== tabId);
  delete docDataMap.value[tabId];
  if (viewingDoc.value && Object.keys(docDataMap.value).length === 0) {
    viewingDoc.value = null;
  }
}

function handleTabSwitched(tabId, url, title) {
  activeTabId.value = tabId;
  const dd = getDocDataByUrl(url) || docDataMap.value[tabId]
  if (dd) {
    // Show actual file path in address bar (like Edge)
    currentUrl.value = dd.filePath || url
    title = dd.fileName || title
  } else {
    currentUrl.value = url;
  }
  updateTabData(tabId, url, title);
}
function handleTabsInitialized(initialTabs, initialActiveTabId) {
  tabs.value = initialTabs; activeTabId.value = initialActiveTabId;
  const at = initialTabs.find((t) => t.id === initialActiveTabId);
  currentUrl.value = at ? at.url : "";
}

function handleFocusAddressBar() {
  if (addressInput.value) { addressInput.value.focus(); addressInput.value.select(); }
}
function handleGlobalAiShortcut() { toggleAi(); }

function handleAiSidebarShown() { aiSidebarVisible.value = true; showAi.value = true; }
function handleAiSidebarHidden() { aiSidebarVisible.value = false; showAi.value = false; }
function handleAiSidebarWidthChanged(w) { aiSidebarWidth.value = w; }
function handleAiFloatShown() { handleAiSidebarShown(); }
function handleAiFloatHidden() { handleAiSidebarHidden(); }
function handleAiFloatClosed() { handleAiSidebarHidden(); }
function handleTabSidebarToggled(open) { tabSidebarOpen.value = open; }

/* ── Tip Editor ── */
function saveNewTip() {
  if (!newTipForm.value.name.trim()) return;
  addTip({
    name: newTipForm.value.name.trim().replace(/\s+/g, '-'),
    description: newTipForm.value.description.trim(),
    prompt: newTipForm.value.prompt.trim(),
  });
  newTipForm.value = { name: '', description: '', prompt: '' };
  showTipEditor.value = false;
}

/* ── Resize handle ── */
let resizeDragging = false;
function onResizeStart(e) {
  e.preventDefault(); resizeDragging = true;
  const startX = e.clientX, startW = aiSidebarWidth.value;
  function onMove(ev) {
    if (!resizeDragging) return;
    aiSidebarWidth.value = Math.max(320, Math.min(600, startW + (startX - ev.clientX)));
  }
  function onUp() {
    resizeDragging = false;
    window.electronAPI?.resizeAiFloat(aiSidebarWidth.value);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ── Event listeners ── */
const eventHandlers = {
  "did-navigate": handleDidNavigate, "did-navigate-in-page": handleDidNavigateInPage,
  "title-updated": handleTitleUpdated, "nav-state-changed": handleNavStateChanged,
  "page-loading": handlePageLoading, "tab-created": handleTabCreated,
  "tab-removed": handleTabRemoved, "tab-switched": handleTabSwitched,
  "tabs-initialized": handleTabsInitialized, "focus-address-bar": handleFocusAddressBar,
  "toggle-ai-sidebar": handleGlobalAiShortcut, "ai-sidebar-shown": handleAiSidebarShown,
  "ai-sidebar-hidden": handleAiSidebarHidden, "ai-sidebar-width-changed": handleAiSidebarWidthChanged,
  "ai-float-shown": handleAiFloatShown, "ai-float-hidden": handleAiFloatHidden,
  "ai-float-closed": handleAiFloatClosed, "tab-sidebar-toggled": handleTabSidebarToggled,
};

function setupListeners() {
  if (!window.electronAPI) return;
  for (const [ch, fn] of Object.entries(eventHandlers)) window.electronAPI.on(ch, fn);
  // Document URL interceptor from BrowserView clicks
  window.electronAPI.on('open-document-url', async (url) => {
    await openDocUrl(url)
  });
}
function removeListeners() {
  if (!window.electronAPI) return;
  for (const [ch, fn] of Object.entries(eventHandlers)) window.electronAPI.off(ch, fn);
}

onMounted(async () => {
  setupListeners();
  if (window.electronAPI) {
    try {
      const its = await window.electronAPI.getTabs();
      const at = await window.electronAPI.getActiveTab();
      if (its && its.length > 0) {
        tabs.value = its;
        activeTabId.value = at && its.find((t) => t.id === at) ? at : its[0].id;
        const ad = tabs.value.find((t) => t.id === activeTabId.value);
        if (ad) currentUrl.value = ad.url;
      }
    } catch (e) { console.error("[Dawn] init:", e); }
  }
});

onBeforeUnmount(() => { removeListeners(); });
</script>

<template>
  <div class="browser">
    <header class="browser-header">
      <div class="titlebar">
        <div class="window-controls">
          <span class="control close" @click="window.electronAPI?.windowClose()"></span>
          <span class="control minimize" @click="window.electronAPI?.windowMinimize()"></span>
          <span class="control maximize" @click="window.electronAPI?.windowMaximize()"></span>
        </div>
        <div class="window-title">Dawn</div>
      </div>

      <div class="toolbar">
        <button class="nav-btn" @click="handleToggleSidebar" :class="{ active: tabSidebarOpen }" title="Toggle tab sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
        <div class="nav-buttons">
          <button class="nav-btn" @click="goBack" :disabled="!canGoBack">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button class="nav-btn" @click="goForward" :disabled="!canGoForward">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button class="nav-btn" @click="reload">
            <svg v-if="!isLoading" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            <svg v-else class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
        </div>

        <div class="address-bar">
          <svg class="lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          <input ref="addressInput" type="text" v-model="currentUrl" @keydown.enter="navigate" :placeholder="t('search.placeholder')" />
        </div>

        <button class="tool-btn" @click="openDocFile" title="Open Document">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </button>
        <button class="tool-btn" @click="showTipEditor = !showTipEditor" :class="{ active: showTipEditor }" title="Tips & Scripts">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </button>
        <button class="tool-btn" @click="toggleAi" :class="{ active: showAi, disabled: isOnHomePage }" :disabled="isOnHomePage" title="AI Assistant (Ctrl+Shift+A)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0110 10 10 10 0 01-10 10A10 10 0 012 12 10 10 0 0112 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>
        <button class="tool-btn" @click="openSettings" title="Settings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </div>

      <div class="tabbar">
        <div v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: tab.id === activeTabId }" @click="selectTab(tab.id)">
          <span class="tab-title">{{ tab.title || "New Tab" }}</span>
          <button v-if="tabs.length > 1" class="tab-close" @click.stop="closeTab(tab.id)">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <button class="new-tab-btn" @click="addNewTab()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </header>

    <div class="browser-body">
      <!-- Tab sidebar (DOM-based, positioned in space NOT covered by BrowserView) -->
      <TabSidebar
        :tabs="tabs"
        :activeTabId="activeTabId"
        @select-tab="selectTab"
        @close-tab="closeTab"
        @auto-group="handleAutoGroup"
      />

      <!-- Main area -->
      <div class="main-content">

        <!-- DOCUMENT VIEWER: for file tabs or direct opens -->
        <div v-if="viewingDoc || isViewingDoc" class="doc-viewer-full">
          <DocumentViewer
            :fileData="(viewingDoc || activeDocData)?.data || ''"
            :fileExt="(viewingDoc || activeDocData)?.ext || ''"
            :fileName="(viewingDoc || activeDocData)?.fileName || ''"
            @close="closeViewer"
          />
        </div>

        <!-- HOME PAGE: Full AI interface when on new tab -->
        <div v-else-if="isOnHomePage" class="home-ai">
          <HomeAI />
        </div>

        <!-- Tips & Scripts Panel (overlay when browsing) -->
        <div v-if="showTipEditor" class="tips-panel">
          <div class="tips-panel-header">
            <span class="tips-panel-title">Tips & Scripts</span>
            <button class="tips-panel-close" @click="showTipEditor = false">&times;</button>
          </div>
          <div class="tips-panel-body">
            <div class="tips-new">
              <input class="tips-input" v-model="newTipForm.name" placeholder="/command-name" @keydown.enter="saveNewTip" />
              <input class="tips-input" v-model="newTipForm.description" placeholder="Short description..." />
              <textarea class="tips-textarea" v-model="newTipForm.prompt" placeholder="Prompt template...&#10;Use {page_content}, {selection}, {url} as variables" rows="3"></textarea>
              <button class="tips-save-btn" @click="saveNewTip" :disabled="!newTipForm.name.trim()">Save Tip</button>
            </div>
            <div v-if="userTips.length > 0" class="tips-list">
              <div v-for="tip in userTips" :key="tip.id" class="tips-item">
                <div class="tips-item-info">
                  <span class="tips-item-name">{{ tip.name }}</span>
                  <span class="tips-item-desc">{{ tip.description }}</span>
                </div>
                <button class="tips-item-del" @click="deleteTip(tip.id)">&times;</button>
              </div>
            </div>
            <div v-else class="tips-empty">No custom tips yet. Create one above.</div>
          </div>
        </div>

        <!-- BROWSING: AI sidebar drawer (only when browsing and AI is toggled) -->
        <aside v-if="aiSidebarVisible && !isOnHomePage" class="ai-drawer" :style="{ width: aiSidebarWidth + 'px' }">
          <div class="ai-drawer-resize-handle" @mousedown="onResizeStart"></div>
          <AiSidebar :embedded="true" />
        </aside>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --color-bg: #f7f4ed;
  --color-surface: #f7f4ed;
  --color-text: #1c1c1c;
  --color-text-secondary: #5f5f5d;
  --color-text-muted: #8a8a88;
  --color-border-light: #eceae4;
  --color-border-interactive: rgba(28, 28, 28, 0.4);
  --font-family: "Camera Plain Variable", ui-sans-serif, system-ui, sans-serif;
  --radius-sm: 6px;
  --radius-full: 9999px;
  font-family: var(--font-family); font-size: 14px; line-height: 1.5;
  color: var(--color-text); background: var(--color-bg);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--color-bg); overflow: hidden; }

.browser { display: flex; flex-direction: column; height: 100vh; background: var(--color-bg); }
.browser-header { flex-shrink: 0; user-select: none; background: var(--color-surface); }

.titlebar {
  display: flex; align-items: center; justify-content: center;
  height: 36px; padding: 0 12px; background: var(--color-surface);
  -webkit-app-region: drag;
}
.window-controls { display: flex; gap: 8px; position: absolute; left: 12px; -webkit-app-region: no-drag; }
.control { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; transition: opacity 0.15s; }
.control:hover { opacity: 0.8; }
.control.close { background: #ff5f56; }
.control.minimize { background: #ffbd2e; }
.control.maximize { background: #27ca40; }
.window-title { font-size: 13px; font-weight: 400; color: var(--color-text-secondary); }

.toolbar {
  display: flex; align-items: center; gap: 4px; padding: 4px 8px;
  background: var(--color-bg); border-bottom: 1px solid var(--color-border-light); height: 38px;
}
.nav-buttons { display: flex; gap: 1px; }
.nav-btn, .tool-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: transparent; border: none;
  border-radius: var(--radius-sm); color: var(--color-text); cursor: pointer; transition: all 0.15s;
}
.nav-btn:hover:not(:disabled), .tool-btn:hover:not(:disabled) { background: rgba(28,28,28,0.06); }
.nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.nav-btn.active, .tool-btn.active { background: rgba(28,28,28,0.08); color: var(--color-text); }
.tool-btn:disabled { opacity: 0.25; cursor: not-allowed; }

.address-bar {
  flex: 1; display: flex; align-items: center; gap: 6px;
  padding: 0 10px; height: 28px; background: var(--color-surface);
  border: 1px solid var(--color-border-light); border-radius: var(--radius-full); transition: all 0.15s;
}
.address-bar:focus-within { border-color: var(--color-border-interactive); box-shadow: rgba(0,0,0,0.1) 0px 4px 12px; }
.lock-icon { color: var(--color-text-muted); flex-shrink: 0; }
.address-bar input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 13px; font-family: inherit; color: var(--color-text); user-select: text;
}
.address-bar input::placeholder { color: var(--color-text-muted); }

.tabbar {
  display: flex; align-items: flex-end; gap: 1px; padding: 2px 8px 0;
  background: rgba(28,28,28,0.04); overflow-x: auto; flex-shrink: 0; min-height: 30px;
}
.tabbar::-webkit-scrollbar { display: none; }
.tab {
  display: flex; align-items: center; gap: 4px; padding: 3px 8px;
  background: rgba(28,28,28,0.03); border: 1px solid transparent; border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0; font-size: 11px;
  color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s;
  white-space: nowrap; max-width: 140px; height: 24px;
}
.tab:hover { background: rgba(28,28,28,0.06); }
.tab.active { background: var(--color-bg); border-color: var(--color-border-light); color: var(--color-text); }
.tab-title { overflow: hidden; text-overflow: ellipsis; flex: 1; text-align: left; }
.tab-close {
  display: flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; background: transparent; border: none;
  border-radius: 3px; color: var(--color-text-muted); cursor: pointer;
  opacity: 0; transition: all 0.15s; flex-shrink: 0;
}
.tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: rgba(28,28,28,0.1); color: var(--color-text); }
.new-tab-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; background: transparent; border: none;
  border-radius: var(--radius-sm); color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0;
}
.new-tab-btn:hover { background: rgba(28,28,28,0.06); color: var(--color-text); }

/* ── Body ── */
.browser-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

.main-content { flex: 1; min-width: 0; display: flex; position: relative; overflow: hidden; }

/* ── Home AI (full page) ── */
.home-ai {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  background: var(--color-bg);
}

/* ── AI Drawer (browsing sidebar) ── */
.ai-drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  background: var(--color-bg); border-left: 1px solid var(--color-border-light);
  z-index: 100; display: flex; flex-direction: column;
  box-shadow: rgba(0,0,0,0.1) -2px 0px 20px;
  animation: drawer-slide-in 0.2s ease-out;
}
@keyframes drawer-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }

.ai-drawer-resize-handle {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px; cursor: col-resize; z-index: 10;
}
.ai-drawer-resize-handle:hover { background: rgba(28,28,28,0.15); }

/* ── Document Viewer (full main content) ── */
.doc-viewer-full {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  background: var(--color-bg);
}

/* ── Tips Panel ── */
.tips-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 380px;
  background: var(--color-bg); border-left: 1px solid var(--color-border-light); z-index: 200;
  display: flex; flex-direction: column; box-shadow: rgba(0,0,0,0.08) -2px 0px 16px;
  animation: drawer-slide-in 0.15s ease-out;
}
.tips-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--color-border-light); flex-shrink: 0;
}
.tips-panel-title { font-size: 13px; font-weight: 600; color: var(--color-text); }
.tips-panel-close {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; background: transparent; border: none;
  border-radius: 4px; font-size: 16px; color: #5f5f5d; cursor: pointer;
}
.tips-panel-close:hover { background: rgba(28,28,28,0.06); }
.tips-panel-body { flex: 1; overflow-y: auto; padding: 12px; }
.tips-new { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.tips-input, .tips-textarea {
  padding: 7px 10px; background: #f7f4ed; border: 1px solid #eceae4;
  border-radius: 6px; font-size: 12px; font-family: inherit; color: #1c1c1c; outline: none;
}
.tips-input:focus, .tips-textarea:focus { border-color: rgba(28,28,28,0.4); }
.tips-textarea { resize: vertical; min-height: 60px; }
.tips-save-btn {
  padding: 6px 14px; background: #1c1c1c; color: #fcfbf8; border: none;
  border-radius: 6px; font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer; align-self: flex-end;
}
.tips-save-btn:hover { opacity: 0.85; }
.tips-save-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.tips-list { display: flex; flex-direction: column; gap: 3px; }
.tips-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px; background: rgba(28,28,28,0.02); border-radius: 6px; gap: 8px;
}
.tips-item-info { display: flex; flex-direction: column; min-width: 0; }
.tips-item-name { font-family: monospace; font-size: 11px; font-weight: 600; color: #1c1c1c; }
.tips-item-desc { font-size: 10px; color: #8a8a88; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tips-item-del {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; background: transparent; border: none;
  border-radius: 4px; color: #8a8a88; cursor: pointer; flex-shrink: 0;
}
.tips-item-del:hover { color: #c00; }
.tips-empty { padding: 16px; text-align: center; font-size: 12px; color: #8a8a88; }

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }
</style>
