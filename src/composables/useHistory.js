import { ref } from 'vue'
import { loadHistoryFromDB, searchHistoryFromDB, clearHistoryFromDB, removeHistoryEntry, saveHistoryEntry } from './useMemory'

const historyEntries = ref([])
let _loaded = false

async function loadHistory() {
  _loaded = true
  try {
    historyEntries.value = await loadHistoryFromDB(200)
  } catch { historyEntries.value = [] }
}

function addEntry(entry) {
  const existing = historyEntries.value.find(e => e.url === entry.url && e.visitTime > Date.now() - 3600000)
  if (existing) {
    existing.visitTime = entry.visitTime
    existing.title = entry.title || existing.title
  } else {
    historyEntries.value.unshift(entry)
    if (historyEntries.value.length > 500) historyEntries.value = historyEntries.value.slice(0, 500)
  }
  saveHistoryEntry(entry).catch(() => {})
}

async function searchHistory(query) {
  if (!query) { await loadHistory(); return }
  try {
    historyEntries.value = await searchHistoryFromDB(query, 100)
  } catch {}
}

async function clearHistory() {
  try { await clearHistoryFromDB() } catch {}
  historyEntries.value = []
}

async function removeEntry(id) {
  try { await removeHistoryEntry(id) } catch {}
  historyEntries.value = historyEntries.value.filter(e => e.id !== id)
}

export function useHistory() {
  if (!_loaded) loadHistory()
  return { historyEntries, addEntry, loadHistory, searchHistory, clearHistory, removeEntry }
}
