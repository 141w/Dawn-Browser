<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useHistory } from './composables/useHistory'
import { useDownloads } from './composables/useDownloads'
import { useTips } from './composables/useTips'
import { useBookmarks } from './composables/useBookmarks'

const mode = ref('history')
const showNewTip = ref(false)
const newTip = ref({ name: '', description: '', prompt: '' })

const { historyEntries, searchHistory, clearHistory, removeEntry, loadHistory } = useHistory()
const { downloads } = useDownloads()
const { userTips, addTip, deleteTip } = useTips()
const { bookmarks, removeBookmark, editBookmark, exportBookmarksHTML, importBookmarksHTML } = useBookmarks()
const editingBmId = ref(null)
const editingBm = ref({ title: '', url: '' })
const importCount = ref(0)

const searchQuery = ref('')
const confirmClear = ref(false)

onMounted(() => {
  if (window.electronAPI) {
    window.electronAPI.on('panel-mode', (m) => {
      mode.value = m || 'history'
      if (m === 'history') loadHistory()
    })
  }
  loadHistory()
})

function closePanel() { window.electronAPI?.hidePanel() }

// ── History helpers ──
function doSearch() {
  if (searchQuery.value.trim()) searchHistory(searchQuery.value.trim())
  else loadHistory()
}

function getDateGroup(ts) {
  const d = new Date(ts); const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  now.setDate(now.getDate() - 1); if (d.toDateString() === now.toDateString()) return 'Yesterday'
  return 'Earlier'
}

const groupedHistory = computed(() => {
  const groups = {}
  for (const e of historyEntries.value) {
    const k = getDateGroup(e.visitTime); if (!groups[k]) groups[k] = []; groups[k].push(e)
  }
  return Object.entries(groups)
})

function getDomain(url) { try { return new URL(url).hostname.replace('www.','') } catch { return url?.slice(0,30)||'' } }
function formatTime(ts) { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) }
async function openUrl(url) { await window.electronAPI?.panelAction({ type:'navigate', url }); closePanel() }
async function doClear() { await clearHistory(); confirmClear.value = false }

// ── Downloads helpers ──
function progressPercent(dl) {
  if (!dl.totalBytes||dl.totalBytes<=0) return 0
  return Math.min(100,Math.round((dl.receivedBytes/dl.totalBytes)*100))
}
function formatSize(b) { if(!b||b<=0) return '? MB'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB' }
async function cancelDl(dl) { await window.electronAPI?.cancelDownload(dl.id); dl.state='cancelled' }
async function openFile(p) { await window.electronAPI?.openDownloadFile(p) }

// ── Tips helpers ──
function saveTip() {
  if (!newTip.value.name.trim()) return
  addTip({ name: newTip.value.name.trim().replace(/\s+/g,'-'), description: newTip.value.description.trim(), prompt: newTip.value.prompt.trim() })
  newTip.value = { name:'', description:'', prompt:'' }
  showNewTip.value = false
}

// ── Bookmarks ──
function startEditBm(bm) { editingBmId.value = bm.id; editingBm.value = { title: bm.title, url: bm.url } }
function saveEditBm() { editBookmark(editingBmId.value, editingBm.value); editingBmId.value = null }
function getHost(u) { try { return new URL(u).hostname.replace('www.','') } catch { return u?.slice(0,30)||'' } }
async function doExport() {
  const html = exportBookmarksHTML()
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'dawn-bookmarks.html'; a.click()
  URL.revokeObjectURL(url)
}
async function doImport() {
  const count = await importBookmarksHTML()
  importCount.value = count
  setTimeout(() => { importCount.value = 0 }, 3000)
}
</script>

<template>
  <div class="po-root">
    <div class="po-header">
      <span class="po-title">{{ { history:'History', downloads:'Downloads', bookmarks:'Bookmarks', tips:'Tips' }[mode] || mode }}</span>
      <button class="po-close" @click="closePanel">&times;</button>
    </div>

    <!-- HISTORY -->
    <template v-if="mode === 'history'">
      <div class="po-search">
        <input v-model="searchQuery" @input="doSearch" placeholder="Search history..." @keydown.escape="searchQuery='';doSearch()" />
      </div>
      <div class="po-body">
        <template v-for="[group, entries] in groupedHistory" :key="group">
          <div class="po-group-label">{{ group }}</div>
          <div v-for="e in entries" :key="e.id" class="po-row" @click="openUrl(e.url)">
            <span class="po-row-title">{{ e.title || 'Untitled' }}</span>
            <span class="po-row-sub">{{ getDomain(e.url) }}</span>
            <span class="po-row-time">{{ formatTime(e.visitTime) }}</span>
            <button class="po-row-del" @click.stop="removeEntry(e.id)">&times;</button>
          </div>
        </template>
        <div v-if="historyEntries.length === 0" class="po-empty">No history yet.</div>
      </div>
      <div class="po-footer">
        <button v-if="!confirmClear" class="po-btn" @click="confirmClear = true">Clear All</button>
        <template v-else>
          <span class="po-warn">Sure?</span>
          <button class="po-btn danger" @click="doClear">Yes</button>
          <button class="po-btn" @click="confirmClear = false">Cancel</button>
        </template>
      </div>
    </template>

    <!-- DOWNLOADS -->
    <template v-else-if="mode === 'downloads'">
      <div class="po-body">
        <div v-for="dl in downloads" :key="dl.id" class="po-row">
          <span class="po-row-title">{{ dl.fileName }}</span>
          <span class="po-row-sub">{{ formatSize(dl.receivedBytes) }} / {{ formatSize(dl.totalBytes) }}</span>
          <div v-if="dl.state==='progressing'" class="po-progress"><div class="po-progress-fill" :style="{width:progressPercent(dl)+'%'}"></div></div>
          <div class="po-row-actions">
            <span v-if="dl.state==='progressing'" class="po-status">{{ progressPercent(dl) }}%</span>
            <span v-else-if="dl.state==='completed'" class="po-status done">Done</span>
            <button v-if="dl.state==='progressing'" class="po-btn sm" @click="cancelDl(dl)">Cancel</button>
            <button v-if="dl.state==='completed'" class="po-btn sm" @click="openFile(dl.filePath)">Open</button>
          </div>
        </div>
        <div v-if="downloads.length===0" class="po-empty">No downloads.</div>
      </div>
    </template>

    <!-- BOOKMARKS -->
    <template v-else-if="mode === 'bookmarks'">
      <div class="po-body">
        <div class="po-row-actions" style="padding:4px 0;gap:6px">
          <button class="po-btn sm" @click="doImport">Import</button>
          <button class="po-btn sm" @click="doExport">Export</button>
          <span v-if="importCount > 0" class="po-status done">Imported {{ importCount }}!</span>
        </div>
        <div v-for="bm in bookmarks" :key="bm.id" class="po-row">
          <template v-if="editingBmId === bm.id">
            <input class="po-input" v-model="editingBm.title" style="flex:1" @keydown.enter="saveEditBm" />
            <button class="po-btn sm" @click="saveEditBm">Save</button>
          </template>
          <template v-else>
            <span class="po-row-title" @click="bm.url ? openUrl(bm.url) : null" style="cursor:pointer">{{ bm.title || 'Untitled' }}</span>
            <span class="po-row-sub">{{ getHost(bm.url) }}</span>
            <button class="po-row-del" @click.stop="startEditBm(bm)" title="Edit" style="opacity:1;color:var(--color-accent)">✎</button>
            <button class="po-row-del" @click.stop="removeBookmark(bm.id)">&times;</button>
          </template>
        </div>
        <div v-if="bookmarks.length===0" class="po-empty">No bookmarks yet.</div>
      </div>
    </template>

    <!-- TIPS -->
    <template v-else-if="mode === 'tips'">
      <div class="po-body">
        <button class="po-btn" style="width:100%;margin-bottom:8px" @click="showNewTip=!showNewTip">+ New Tip</button>
        <div v-if="showNewTip" class="po-tip-form">
          <input class="po-input" v-model="newTip.name" placeholder="/command-name" />
          <input class="po-input" v-model="newTip.description" placeholder="Description" />
          <textarea class="po-input" v-model="newTip.prompt" placeholder="Prompt template" rows="2"></textarea>
          <button class="po-btn" @click="saveTip" :disabled="!newTip.name.trim()">Save</button>
        </div>
        <div v-for="t in userTips" :key="t.id" class="po-row">
          <span class="po-row-title" style="font-family:monospace;font-size:11px">{{ t.name }}</span>
          <span class="po-row-sub">{{ t.description }}</span>
          <button class="po-row-del" @click.stop="deleteTip(t.id)">&times;</button>
        </div>
        <div v-if="userTips.length===0" class="po-empty">No tips yet.</div>
      </div>
    </template>
  </div>
</template>

<style>
* { margin:0; padding:0; box-sizing:border-box; }
.po-root { display:flex; flex-direction:column; height:100vh; background:var(--color-bg); font-size:12px; color:var(--color-text); }
.po-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--color-border); flex-shrink:0; }
.po-title { font-size:13px; font-weight:600; }
.po-close { display:flex; align-items:center; justify-content:center; width:24px; height:24px; background:transparent; border:none; border-radius:4px; font-size:16px; color:var(--color-text-secondary); cursor:pointer; }
.po-close:hover { background:var(--color-bg-hover); }
.po-search { padding:8px 10px; border-bottom:1px solid var(--color-border); flex-shrink:0; }
.po-search input { width:100%; padding:5px 8px; background:var(--color-bg-elevated); border:1px solid var(--color-border); border-radius:6px; font-size:12px; font-family:inherit; color:var(--color-text); outline:none; }
.po-body { flex:1; overflow-y:auto; padding:4px 8px; }
.po-group-label { font-size:10px; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.5px; padding:8px 6px 4px; }
.po-row { display:flex; align-items:center; gap:6px; padding:5px 6px; border-radius:6px; cursor:pointer; transition:all .1s; }
.po-row:hover { background:var(--color-bg-hover); }
.po-row-title { flex:1; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.po-row-sub { font-size:10px; color:var(--color-text-muted); max-width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:0; }
.po-row-time { font-size:10px; color:var(--color-text-muted); flex-shrink:0; }
.po-row-del { display:flex; align-items:center; justify-content:center; width:18px; height:18px; background:transparent; border:none; border-radius:3px; color:var(--color-text-muted); cursor:pointer; font-size:12px; opacity:0; }
.po-row:hover .po-row-del { opacity:1; }
.po-row-del:hover { color:#c00; }
.po-row-actions { display:flex; align-items:center; gap:6px; margin-top:4px; }
.po-progress { height:3px; background:var(--color-bg-hover); border-radius:2px; margin-top:2px; }
.po-progress-fill { height:100%; background:var(--color-accent); border-radius:2px; transition:width 0.2s; }
.po-status { font-size:10px; color:var(--color-text-muted); }
.po-status.done { color:#16a34a; }
.po-empty { padding:20px; text-align:center; font-size:11px; color:var(--color-text-muted); }
.po-footer { padding:6px 10px; border-top:1px solid var(--color-border); display:flex; align-items:center; gap:6px; flex-shrink:0; }
.po-btn { padding:3px 10px; background:var(--color-bg-hover); border:1px solid var(--color-border); border-radius:5px; font-size:11px; font-family:inherit; color:var(--color-text-secondary); cursor:pointer; }
.po-btn:hover { background:var(--color-bg-active); }
.po-btn.sm { padding:1px 6px; font-size:10px; }
.po-btn.danger { background:var(--color-error-bg); border-color:var(--color-error-border); color:#c00; }
.po-warn { font-size:11px; color:#c00; }
.po-input { width:100%; padding:4px 7px; background:var(--color-bg-elevated); border:1px solid var(--color-border); border-radius:5px; font-size:11px; font-family:inherit; color:var(--color-text); outline:none; margin-bottom:4px; }
.po-tip-form { padding:8px; background:var(--color-bg-hover); border-radius:6px; margin-bottom:8px; }
</style>
