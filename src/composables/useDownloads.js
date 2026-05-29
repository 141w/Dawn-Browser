import { ref } from 'vue'
import { storeApi } from './useStore'

const downloads = ref([])
const showPanel = ref(false)
let _storeSynced = false

function _initStoreSync() {
  if (_storeSynced) return
  _storeSynced = true
  storeApi.onStoreChange('downloads', (value) => {
    if (Array.isArray(value)) downloads.value = value
  })
}

async function _syncToStore() {
  await storeApi.set('downloads', downloads.value)
}

function addDownload(dl) {
  const existing = downloads.value.find(d => d.id === dl.id)
  if (existing) Object.assign(existing, dl)
  else downloads.value.unshift(dl)
  showPanel.value = true
  _syncToStore()
}

function updateProgress(dl) {
  const existing = downloads.value.find(d => d.id === dl.id)
  if (existing) Object.assign(existing, dl)
  _syncToStore()
}

function removeDownload(id) {
  downloads.value = downloads.value.filter(d => d.id !== id)
  _syncToStore()
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '? MB'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function togglePanel() { showPanel.value = !showPanel.value }

export function useDownloads() {
  _initStoreSync()
  return { downloads, showPanel, addDownload, updateProgress, removeDownload, formatSize, togglePanel }
}
