<script setup>
import { computed } from 'vue'
import { useDownloads } from './composables/useDownloads'
import { t } from './composables/useI18n'

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
      <span class="dm-title">{{ t('dl.title') }}</span>
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
          <span v-if="dl.state === 'progressing'" class="dm-status">{{ progressPercent(dl) }}% {{ t('dl.progress') }}</span>
          <span v-else-if="dl.state === 'completed'" class="dm-status done">{{ t('dl.done') }}</span>
          <span v-else class="dm-status">{{ dl.state }}</span>
          <button v-if="dl.state === 'progressing'" class="dm-btn" @click="cancelDownload(dl)">{{ t('dl.cancel') }}</button>
          <button v-if="dl.state === 'completed'" class="dm-btn" @click="openFile(dl.filePath)">{{ t('dl.open') }}</button>
        </div>
      </div>
      <div v-if="downloads.length === 0" class="dm-empty">{{ t('dl.empty') }}</div>
    </div>
  </div>
</template>

<style scoped>
.dm-panel {
  position: absolute; right: 0; bottom: 0; width: 340px; max-height: 340px;
  background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 10px;
  box-shadow: var(--color-shadow) 0 4px 20px; z-index: 250;
  display: flex; flex-direction: column; overflow: hidden;
}
.dm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.dm-title { font-size: 12px; font-weight: 600; color: var(--color-text); }
.dm-close {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; background: transparent; border: none;
  border-radius: 4px; font-size: 14px; color: var(--color-text-secondary); cursor: pointer;
}
.dm-body { flex: 1; overflow-y: auto; padding: 4px 8px; }
.dm-item { padding: 6px 4px; border-bottom: 1px solid var(--color-bg-hover); }
.dm-item-info { display: flex; justify-content: space-between; margin-bottom: 4px; }
.dm-item-name { font-size: 11px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dm-item-size { font-size: 10px; color: var(--color-text-muted); flex-shrink: 0; margin-left: 8px; }
.dm-bar-bg { height: 3px; background: var(--color-bg-hover); border-radius: 2px; margin-bottom: 4px; }
.dm-bar-fill { height: 100%; background: var(--color-accent); border-radius: 2px; transition: width 0.2s; }
.dm-item-actions { display: flex; align-items: center; gap: 8px; }
.dm-status { font-size: 10px; color: var(--color-text-muted); }
.dm-status.done { color: #16a34a; }
.dm-btn {
  padding: 1px 8px; background: var(--color-bg-hover); border: 1px solid var(--color-border);
  border-radius: 4px; font-size: 10px; font-family: inherit; color: var(--color-text-secondary); cursor: pointer;
}
.dm-btn:hover { background: var(--color-bg-active); }
.dm-empty { padding: 16px; text-align: center; font-size: 11px; color: var(--color-text-muted); }
</style>

