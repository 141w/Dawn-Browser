<script setup>
import { ref, computed } from 'vue'
import { useHistory } from './composables/useHistory'

const emit = defineEmits(['close', 'navigate'])
const { historyEntries, searchHistory, clearHistory, removeEntry, loadHistory } = useHistory()

const searchQuery = ref('')
const confirmClear = ref(false)

function doSearch() {
  if (searchQuery.value.trim()) searchHistory(searchQuery.value.trim())
  else loadHistory()
}

function getDateGroup(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  now.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Yesterday'
  const days = Math.floor((Date.now() - ts) / 86400000)
  if (days < 7) return 'This Week'
  return 'Earlier'
}

const grouped = computed(() => {
  const groups = {}
  for (const entry of historyEntries.value) {
    const key = getDateGroup(entry.visitTime)
    if (!groups[key]) groups[key] = []
    groups[key].push(entry)
  }
  return Object.entries(groups)
})

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url?.slice(0, 30) || '' }
}

function openEntry(url) {
  emit('navigate', url)
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function doClear() {
  await clearHistory()
  confirmClear.value = false
}
</script>

<template>
  <div class="hp-panel">
    <div class="hp-header">
      <span class="hp-title">History</span>
      <button class="hp-close" @click="emit('close')">&times;</button>
    </div>
    <div class="hp-search">
      <input v-model="searchQuery" @input="doSearch" placeholder="Search history..." @keydown.escape="searchQuery=''; doSearch()" />
    </div>
    <div class="hp-body">
      <template v-for="[group, entries] in grouped" :key="group">
        <div class="hp-group-label">{{ group }}</div>
        <div v-for="entry in entries" :key="entry.id" class="hp-entry" @click="openEntry(entry.url)">
          <span class="hp-entry-title">{{ entry.title || 'Untitled' }}</span>
          <span class="hp-entry-url">{{ getDomain(entry.url) }}</span>
          <span class="hp-entry-time">{{ formatTime(entry.visitTime) }}</span>
          <button class="hp-entry-del" @click.stop="removeEntry(entry.id)">&times;</button>
        </div>
      </template>
      <div v-if="historyEntries.length === 0" class="hp-empty">No history yet.</div>
    </div>
    <div class="hp-footer">
      <button v-if="!confirmClear" class="hp-clear-btn" @click="confirmClear = true">Clear All</button>
      <template v-else>
        <span class="hp-confirm-text">Are you sure?</span>
        <button class="hp-clear-btn danger" @click="doClear">Yes, Clear</button>
        <button class="hp-clear-btn" @click="confirmClear = false">Cancel</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hp-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 380px;
  background: #f7f4ed; border-left: 1px solid #eceae4; z-index: 200;
  display: flex; flex-direction: column; box-shadow: rgba(0,0,0,0.08) -2px 0 16px;
}
.hp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid #eceae4; flex-shrink: 0;
}
.hp-title { font-size: 13px; font-weight: 600; color: #1c1c1c; }
.hp-close {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; background: transparent; border: none;
  border-radius: 4px; font-size: 16px; color: #5f5f5d; cursor: pointer;
}
.hp-close:hover { background: rgba(28,28,28,0.06); }
.hp-search { padding: 8px 12px; border-bottom: 1px solid #eceae4; flex-shrink: 0; }
.hp-search input {
  width: 100%; padding: 6px 10px; background: #fcfbf8; border: 1px solid #eceae4;
  border-radius: 6px; font-size: 12px; font-family: inherit; color: #1c1c1c; outline: none;
}
.hp-body { flex: 1; overflow-y: auto; padding: 4px 8px; }
.hp-group-label {
  font-size: 10px; font-weight: 700; color: #8a8a88; text-transform: uppercase;
  letter-spacing: 0.5px; padding: 8px 6px 4px;
}
.hp-entry {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border-radius: 6px; cursor: pointer; transition: all 0.1s;
}
.hp-entry:hover { background: rgba(28,28,28,0.04); }
.hp-entry-title { flex: 1; font-size: 12px; color: #1c1c1c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hp-entry-url { font-size: 10px; color: #8a8a88; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.hp-entry-time { font-size: 10px; color: #8a8a88; flex-shrink: 0; }
.hp-entry-del {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; background: transparent; border: none;
  border-radius: 3px; color: #8a8a88; cursor: pointer; font-size: 12px; opacity: 0; transition: all 0.1s;
}
.hp-entry:hover .hp-entry-del { opacity: 1; }
.hp-entry-del:hover { color: #c00; }
.hp-empty { padding: 20px; text-align: center; font-size: 12px; color: #8a8a88; }
.hp-footer { padding: 8px 12px; border-top: 1px solid #eceae4; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.hp-clear-btn {
  padding: 4px 12px; background: rgba(28,28,28,0.04); border: 1px solid #eceae4;
  border-radius: 6px; font-size: 11px; font-family: inherit; color: #5f5f5d; cursor: pointer;
}
.hp-clear-btn.danger { background: rgba(255,95,86,0.1); border-color: rgba(255,95,86,0.2); color: #c00; }
.hp-confirm-text { font-size: 11px; color: #c00; }
</style>
