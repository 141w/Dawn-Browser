<script setup>
import { useTabGroups } from './composables/useTabGroups'
import { t } from './composables/useI18n'

const props = defineProps({
  tabs: { type: Array, default: () => [] },
  activeTabId: Number,
})

const emit = defineEmits(['select-tab', 'close-tab', 'auto-group'])

const { tabGroups, tabSidebarOpen, toggleSidebar, deleteGroup } = useTabGroups()

function selectTab(id) { emit('select-tab', id) }
function closeTab(id) { emit('close-tab', id) }
function autoGroup() { emit('auto-group') }

function getTabById(id) {
  return props.tabs.find(t => t.id === id)
}

function getTabDomain(url) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url?.slice(0, 30) || '' }
}
</script>

<template>
  <div class="ts-root" :class="{ collapsed: !tabSidebarOpen }">
    <div class="ts-header">
      <button class="ts-toggle" @click="toggleSidebar" :title="tabSidebarOpen ? 'Collapse' : 'Expand'">
        <svg v-if="tabSidebarOpen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/>
        </svg>
      </button>
      <span v-if="tabSidebarOpen" class="ts-title">Tabs</span>
      <button v-if="tabSidebarOpen" class="ts-group-btn" @click="autoGroup" title="AI Auto-Group">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3H3v7h7V3zM21 3h-7v7h7V3zM21 14h-7v7h7v-7zM10 14H3v7h7v-7z"/></svg>
      </button>
    </div>

    <div v-if="tabSidebarOpen" class="ts-body">

      <!-- AI-generated tab groups -->
      <div v-for="group in tabGroups" :key="group.id" class="ts-group">
        <div class="ts-group-header" @click="group.collapsed = !group.collapsed">
          <svg class="ts-group-chevron" :class="{ rotated: !group.collapsed }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
          <span class="ts-group-name">{{ group.name }}</span>
          <span class="ts-group-count">{{ group.tabIds.length }}</span>
          <button class="ts-group-del" @click.stop="deleteGroup(group.id)">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div v-if="!group.collapsed" class="ts-group-tabs">
          <div v-for="tabId in group.tabIds" :key="tabId" class="ts-tab" :class="{ active: tabId === activeTabId }" @click="selectTab(tabId)">
            <span class="ts-tab-title">{{ getTabById(tabId)?.title || 'Loading...' }}</span>
            <button class="ts-tab-close" @click.stop="closeTab(tabId)">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Ungrouped tabs -->
      <div class="ts-ungrouped">
        <div v-for="tab in tabs" :key="tab.id" class="ts-tab" :class="{ active: tab.id === activeTabId }" @click="selectTab(tab.id)">
          <span class="ts-tab-favicon">
            <svg v-if="tab.url?.startsWith('dawn://')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          </span>
          <span class="ts-tab-title">{{ tab.title || 'New Tab' }}</span>
          <span class="ts-tab-domain">{{ getTabDomain(tab.url) }}</span>
          <button v-if="tabs.length > 1" class="ts-tab-close" @click.stop="closeTab(tab.id)">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ts-root {
  width: 240px; flex-shrink: 0; display: flex; flex-direction: column;
  background: rgba(28,28,28,0.02); border-right: 1px solid #eceae4;
  transition: width 0.15s; overflow: hidden;
}
.ts-root.collapsed { width: 40px; }
.ts-header {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border-bottom: 1px solid #eceae4; flex-shrink: 0; min-height: 36px;
}
.ts-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; background: transparent; border: none;
  border-radius: 4px; color: #8a8a88; cursor: pointer; flex-shrink: 0;
}
.ts-toggle:hover { background: rgba(28,28,28,0.06); color: #1c1c1c; }
.ts-title { font-size: 12px; font-weight: 600; color: #1c1c1c; flex: 1; }
.ts-group-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; background: transparent; border: none;
  border-radius: 4px; color: #8a8a88; cursor: pointer; flex-shrink: 0;
}
.ts-group-btn:hover { background: rgba(28,28,28,0.06); color: #3b82f6; }

.ts-body { flex: 1; overflow-y: auto; padding: 4px; }

.ts-group { margin-bottom: 2px; }
.ts-group-header {
  display: flex; align-items: center; gap: 4px; padding: 4px 6px;
  border-radius: 4px; cursor: pointer; transition: all 0.1s;
  font-size: 11px; font-weight: 600; color: #5f5f5d;
}
.ts-group-header:hover { background: rgba(28,28,28,0.04); }
.ts-group-chevron { flex-shrink: 0; transition: transform 0.15s; }
.ts-group-chevron.rotated { transform: rotate(90deg); }
.ts-group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-group-count {
  font-size: 10px; color: #8a8a88; background: rgba(28,28,28,0.06);
  padding: 0 5px; border-radius: 8px; flex-shrink: 0;
}
.ts-group-del {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; background: transparent; border: none;
  border-radius: 3px; color: #8a8a88; cursor: pointer; opacity: 0; transition: all 0.1s;
}
.ts-group-header:hover .ts-group-del { opacity: 1; }
.ts-group-del:hover { color: #c00; }
.ts-group-tabs { padding-left: 12px; }

.ts-ungrouped { }

.ts-tab {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border-radius: 4px; cursor: pointer; transition: all 0.1s;
  font-size: 12px; color: #5f5f5d; position: relative;
}
.ts-tab:hover { background: rgba(28,28,28,0.04); color: #1c1c1c; }
.ts-tab.active { background: rgba(28,28,28,0.06); color: #1c1c1c; font-weight: 600; }
.ts-tab-favicon { font-size: 12px; flex-shrink: 0; }
.ts-tab-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-tab-domain {
  font-size: 9px; color: #8a8a88; max-width: 80px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
}
.ts-tab-close {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; background: transparent; border: none;
  border-radius: 3px; color: #8a8a88; cursor: pointer; opacity: 0; transition: all 0.1s;
}
.ts-tab:hover .ts-tab-close { opacity: 1; }
.ts-tab-close:hover { color: #c00; background: rgba(255,95,86,0.1); }
</style>
