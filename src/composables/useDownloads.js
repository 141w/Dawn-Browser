import { ref } from 'vue'

const downloads = ref([])
const showPanel = ref(false)

function addDownload(dl) {
  const existing = downloads.value.find(d => d.id === dl.id)
  if (existing) Object.assign(existing, dl)
  else downloads.value.unshift(dl)
  showPanel.value = true
}

function updateProgress(dl) {
  const existing = downloads.value.find(d => d.id === dl.id)
  if (existing) Object.assign(existing, dl)
}

function removeDownload(id) {
  downloads.value = downloads.value.filter(d => d.id !== id)
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '? MB'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function togglePanel() { showPanel.value = !showPanel.value }

export function useDownloads() {
  return { downloads, showPanel, addDownload, updateProgress, removeDownload, formatSize, togglePanel }
}
