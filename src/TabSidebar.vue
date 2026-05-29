<script setup>
import { ref } from 'vue'
import { useTabGroups } from './composables/useTabGroups'
import { useBookmarks } from './composables/useBookmarks'
import { t } from './composables/useI18n'

const props = defineProps({ tabs: { type: Array, default: () => [] }, activeTabId: Number })
const emit = defineEmits(['select-tab', 'close-tab', 'auto-group', 'navigate', 'toggle-find'])

const { tabGroups, tabSidebarOpen, isAiGrouping, createGroup, renameGroup, deleteGroup, addTabToGroup } = useTabGroups()
const { bookmarks } = useBookmarks()

const editingGroupId = ref(null)
const editName = ref('')
const contextGroupId = ref(null)
const showNewGroupInput = ref(false)
const newGroupName = ref('')
const dragTabId = ref(null)

function selectTab(id) { emit('select-tab', id) }
function closeTab(id) { emit('close-tab', id) }
function navigateTo(url) { emit('navigate', url) }

function getTabById(id) { return props.tabs.find(t => t.id === id) }
function getGroupTabs(group) { return group.tabIds.map(id => getTabById(id)).filter(Boolean) }

function getTabDomain(url) {
  try { return new URL(url).hostname.replace('www.','') } catch { return url?.slice(0,30)||'' }
}

// ── Group actions ──
function startRename(group) {
  contextGroupId.value = null
  editingGroupId.value = group.id
  editName.value = group.name
}
function finishRename() {
  if (editName.value.trim()) renameGroup(editingGroupId.value, editName.value)
  editingGroupId.value = null
}
function doCreateGroup() {
  if (newGroupName.value.trim()) {
    createGroup(newGroupName.value.trim(), [], 'custom')
    newGroupName.value = ''
    showNewGroupInput.value = false
  }
}
function onContextMenu(e, group) {
  e.preventDefault(); e.stopPropagation()
  contextGroupId.value = contextGroupId.value === group.id ? null : group.id
}
function closeContext() { contextGroupId.value = null }

// ── Drag tab to group ──
function onTabDragStart(e, tabId) {
  dragTabId.value = tabId
  e.dataTransfer.effectAllowed = 'link'
  e.dataTransfer.setData('text/plain', String(tabId))
}
function onGroupDragOver(e) { e.preventDefault() }
function onGroupDrop(e, groupId) {
  e.preventDefault()
  if (dragTabId.value !== null) {
    addTabToGroup(groupId, dragTabId.value)
    dragTabId.value = null
  }
}
function onTabDragEnd() { dragTabId.value = null }
</script>

<template>
  <div class="ts-root" >
    <div class="ts-header">
      <button class="ts-icon-btn" @click="$emit('toggle-find')" title="Search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
      <span class="ts-title">Tabs</span>
      <button class="ts-icon-btn" @click="showNewGroupInput = !showNewGroupInput" title="New Group">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button class="ts-group-btn" @click="$emit('auto-group')" :disabled="isAiGrouping" :title="isAiGrouping ? 'AI analyzing...' : 'AI Smart Group'">
        <svg v-if="!isAiGrouping" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3H3v7h7V3zM21 3h-7v7h7V3zM21 14h-7v7h7v-7zM10 14H3v7h7v-7z"/></svg>
        <svg v-else class="ts-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      </button>
    </div>

    <div v-if="tabSidebarOpen" class="ts-body">
      <!-- New group input -->
      <div v-if="showNewGroupInput" class="ts-new-group">
        <input v-model="newGroupName" @keydown.enter="doCreateGroup" @keydown.escape="showNewGroupInput = false" placeholder="Group name..." class="ts-input" />
        <button @click="doCreateGroup" :disabled="!newGroupName.trim()" class="ts-input-btn">OK</button>
      </div>

      <!-- Groups -->
      <div v-for="group in tabGroups" :key="group.id" class="ts-group" @dragover.prevent="onGroupDragOver" @drop="onGroupDrop($event, group.id)">
        <div class="ts-group-header" @contextmenu="onContextMenu($event, group)" @click="group.collapsed = !group.collapsed">
          <svg class="ts-group-chevron" :class="{ rotated: !group.collapsed }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
          <input v-if="editingGroupId === group.id" v-model="editName" @keydown.enter="finishRename" @blur="finishRename" @click.stop class="ts-rename-input" />
          <span v-else class="ts-group-name">{{ group.name }}</span>
          <span class="ts-group-count">{{ getGroupTabs(group).length }}</span>
        </div>
        <!-- Context menu -->
        <div v-if="contextGroupId === group.id" class="ts-ctx-menu" @click.stop>
          <button @click="startRename(group); closeContext()">Rename</button>
          <button @click="deleteGroup(group.id); closeContext()">Delete</button>
        </div>
        <!-- Group tabs -->
        <div v-if="!group.collapsed" class="ts-group-tabs">
          <div v-for="tab in getGroupTabs(group)" :key="tab.id" class="ts-tab" :class="{ active: tab.id === activeTabId }" @click="selectTab(tab.id)">
            <span class="ts-tab-title">{{ tab.title || 'Untitled' }}</span>
            <button class="ts-tab-close" @click.stop="closeTab(tab.id)">&times;</button>
          </div>
          <div v-if="getGroupTabs(group).length === 0" class="ts-empty-group">Drop tabs here</div>
        </div>
      </div>

      <!-- Bookmarks -->
      <div v-if="bookmarks.length > 0" class="ts-bookmarks">
        <div class="ts-bookmarks-label">Bookmarks</div>
        <div v-for="bm in bookmarks" :key="bm.id" class="ts-tab" @click="navigateTo(bm.url)">
          <span class="ts-tab-favicon">{{ bm.type === 'file' ? '📄' : '🌐' }}</span>
          <span class="ts-tab-title">{{ bm.title }}</span>
        </div>
      </div>

      <!-- Ungrouped tabs -->
      <div class="ts-ungrouped">
        <div v-for="tab in props.tabs" :key="tab.id" class="ts-tab"
          :class="{ active: tab.id === activeTabId }"
          :draggable="true"
          @click="selectTab(tab.id)"
          @dragstart="onTabDragStart($event, tab.id)"
          @dragend="onTabDragEnd">
          <span class="ts-tab-favicon">
            <svg v-if="tab.url?.startsWith('dawn://')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          </span>
          <span class="ts-tab-title">{{ tab.title || 'New Tab' }}</span>
          <span class="ts-tab-domain">{{ getTabDomain(tab.url) }}</span>
          <button v-if="props.tabs.length > 1" class="ts-tab-close" @click.stop="closeTab(tab.id)">&times;</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ts-root { width: 240px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--color-bg-hover); border-right: 1px solid var(--color-border); transition: width 0.15s; overflow: hidden; }
.ts-header { display: flex; align-items: center; gap: 4px; padding: 6px 4px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; min-height: 36px; }
.ts-title { font-size: 12px; font-weight: 600; color: var(--color-text); flex: 1; }
.ts-icon-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: transparent; border: none; border-radius: 4px; color: var(--color-text-muted); cursor: pointer; flex-shrink: 0; }
.ts-icon-btn:hover { background: var(--color-bg-active); color: var(--color-text); }
.ts-group-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: transparent; border: none; border-radius: 4px; color: var(--color-text-muted); cursor: pointer; flex-shrink: 0; }
.ts-group-btn:hover { background: var(--color-bg-active); color: #3b82f6; }
.ts-group-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ts-spin { animation: ts-spin 1.5s linear infinite; }
@keyframes ts-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.ts-body { flex: 1; overflow-y: auto; padding: 4px; }

.ts-new-group { display: flex; gap: 4px; padding: 4px; margin-bottom: 4px; }
.ts-input { flex: 1; padding: 3px 6px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 4px; font-size: 11px; font-family: inherit; color: var(--color-text); outline: none; }
.ts-input:focus { border-color: var(--color-border-interactive); }
.ts-input-btn { padding: 3px 8px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: 4px; font-size: 10px; font-family: inherit; color: var(--color-text); cursor: pointer; }
.ts-input-btn:disabled { opacity: 0.3; }

.ts-group { margin-bottom: 2px; position: relative; }
.ts-group-header { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 4px; cursor: pointer; transition: all 0.1s; font-size: 11px; font-weight: 600; color: var(--color-text-secondary); }
.ts-group-header:hover { background: var(--color-bg-hover); }
.ts-group-chevron { flex-shrink: 0; transition: transform 0.15s; }
.ts-group-chevron.rotated { transform: rotate(90deg); }
.ts-rename-input { flex: 1; padding: 1px 4px; background: var(--color-bg-elevated); border: 1px solid #2563eb; border-radius: 3px; font-size: 11px; font-weight: 600; font-family: inherit; color: var(--color-text); outline: none; min-width: 0; }
.ts-group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-group-count { font-size: 10px; color: var(--color-text-muted); background: var(--color-bg-active); padding: 0 5px; border-radius: 8px; flex-shrink: 0; }

.ts-ctx-menu { position: absolute; top: 100%; left: 8px; z-index: 50; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 6px; box-shadow: var(--color-shadow) 0 4px 16px; padding: 2px; min-width: 100px; }
.ts-ctx-menu button { display: block; width: 100%; padding: 5px 10px; background: transparent; border: none; border-radius: 4px; font-size: 11px; font-family: inherit; color: var(--color-text); cursor: pointer; text-align: left; }
.ts-ctx-menu button:hover { background: var(--color-bg-active); }

.ts-group-tabs { padding-left: 12px; }
.ts-empty-group { font-size: 10px; color: var(--color-text-muted); padding: 4px 8px; font-style: italic; }

.ts-bookmarks { margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--color-border); }
.ts-bookmarks-label { font-size: 9px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.8px; padding: 4px 8px 2px; }

.ts-ungrouped { }
.ts-tab { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 4px; cursor: pointer; transition: all 0.1s; font-size: 12px; color: var(--color-text-secondary); position: relative; }
.ts-tab:hover { background: var(--color-bg-hover); color: var(--color-text); }
.ts-tab.active { background: var(--color-bg-active); color: var(--color-text); font-weight: 600; }
.ts-tab-favicon { font-size: 12px; flex-shrink: 0; }
.ts-tab-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-tab-domain { font-size: 9px; color: var(--color-text-muted); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.ts-tab-close { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; background: transparent; border: none; border-radius: 3px; color: var(--color-text-muted); cursor: pointer; font-size: 12px; opacity: 0; }
.ts-tab:hover .ts-tab-close { opacity: 1; }
.ts-tab-close:hover { color: #c00; background: rgba(255,95,86,0.1); }
</style>
