<script setup>
import { computed } from 'vue'
import { useDownloads } from './composables/useDownloads'

const { downloads, showPanel, formatSize, togglePanel } = useDownloads()

const activeCount = computed(() => downloads.value.filter(d => d.state === 'progressing').length)
const completedCount = computed(() => downloads.value.filter(d => d.state === 'completed').length)

function progressPercent(dl) {
  if (!dl.totalBytes || dl.totalBytes <= 0) return 0
  return Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100))
}

async function cancelDownload(dl) {
  await window.electronAPI?.cancelDownload(dl.id)
  dl.state = 'cancelled'
}

async function openFile(filePath) {
  await window.electronAPI?.openDownloadFile(filePath)
}
</script>

<template>
  <div class="dm-panel" v-if="showPanel">
    <div class="dm-header">
      <span class="dm-title">Downloads</span>
      <button class="dm-close" @click="showPanel = false">&times;</button>
    </div>
    <div class="dm-body">
      <div v-for="dl in downloads" :key="dl.id" class="dm-item">
        <div class="dm-item-info">
          <span class="dm-item-name">{{ dl.fileName }}</span>
          <span class="dm-item-size">{{ formatSize(dl.receivedBytes) }} / {{ formatSize(dl.totalBytes) }}</span>
        </div>
        <div class="dm-bar-bg" v-if="dl.state === 'progressing'">
          <div class="dm-bar-fill" :style="{ width: progressPercent(dl) + '%' }"></div>
        </div>
        <div class="dm-item-actions">
          <span v-if="dl.state === 'progressing'" class="dm-status">{{ progressPercent(dl) }}%</span>
          <span v-else-if="dl.state === 'completed'" class="dm-status done">Done</span>
          <span v-else class="dm-status">{{ dl.state }}</span>
          <button v-if="dl.state === 'progressing'" class="dm-btn" @click="cancelDownload(dl)">Cancel</button>
          <button v-if="dl.state === 'completed'" class="dm-btn" @click="openFile(dl.filePath)">Open</button>
        </div>
      </div>
      <div v-if="downloads.length === 0" class="dm-empty">No downloads yet.</div>
    </div>
  </div>
</template>

<style scoped>
.dm-panel {
  position: absolute; right: 0; bottom: 0; width: 340px; max-height: 340px;
  background: #f7f4ed; border: 1px solid #eceae4; border-radius: 10px;
  box-shadow: rgba(0,0,0,0.1) 0 4px 20px; z-index: 250;
  display: flex; flex-direction: column; overflow: hidden;
}
.dm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #eceae4; flex-shrink: 0;
}
.dm-title { font-size: 12px; font-weight: 600; color: #1c1c1c; }
.dm-close {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; background: transparent; border: none;
  border-radius: 4px; font-size: 14px; color: #5f5f5d; cursor: pointer;
}
.dm-body { flex: 1; overflow-y: auto; padding: 4px 8px; }
.dm-item { padding: 6px 4px; border-bottom: 1px solid rgba(28,28,28,0.04); }
.dm-item-info { display: flex; justify-content: space-between; margin-bottom: 4px; }
.dm-item-name { font-size: 11px; color: #1c1c1c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dm-item-size { font-size: 10px; color: #8a8a88; flex-shrink: 0; margin-left: 8px; }
.dm-bar-bg { height: 3px; background: rgba(28,28,28,0.06); border-radius: 2px; margin-bottom: 4px; }
.dm-bar-fill { height: 100%; background: #2563eb; border-radius: 2px; transition: width 0.2s; }
.dm-item-actions { display: flex; align-items: center; gap: 8px; }
.dm-status { font-size: 10px; color: #8a8a88; }
.dm-status.done { color: #16a34a; }
.dm-btn {
  padding: 1px 8px; background: rgba(28,28,28,0.04); border: 1px solid #eceae4;
  border-radius: 4px; font-size: 10px; font-family: inherit; color: #5f5f5d; cursor: pointer;
}
.dm-btn:hover { background: rgba(28,28,28,0.08); }
.dm-empty { padding: 16px; text-align: center; font-size: 11px; color: #8a8a88; }
</style>
