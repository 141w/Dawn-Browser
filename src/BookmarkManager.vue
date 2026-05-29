<script setup>
import { ref, computed } from 'vue'
import { useBookmarks } from './composables/useBookmarks'

const emit = defineEmits(['navigate'])
const { bookmarks, addBookmark, removeBookmark, editBookmark, createFolder, getFolders, getBookmarksByFolder, deleteFolder, moveBookmark, exportBookmarksHTML, importBookmarksHTML } = useBookmarks()

const selectedFolderId = ref('root')
const editingId = ref(null)
const editTitle = ref('')
const editUrl = ref('')
const showNewFolder = ref(false)
const newFolderName = ref('')
const dragBmId = ref(null)
const importCount = ref(null)

const currentFolders = computed(() => getFolders(selectedFolderId.value))
const currentBookmarks = computed(() => getBookmarksByFolder(selectedFolderId.value))

const folderPath = computed(() => {
  const path = []
  let pid = selectedFolderId.value
  while (pid && pid !== 'root') {
    const f = bookmarks.value.find(b => b.id === pid)
    if (!f) break
    path.unshift(f)
    pid = f.parentId
  }
  return path
})

function selectFolder(id) { selectedFolderId.value = id }

function startEdit(bm) {
  editingId.value = bm.id
  editTitle.value = bm.title
  editUrl.value = bm.url || ''
}
function finishEdit() {
  if (editingId.value) {
    editBookmark(editingId.value, { title: editTitle.value, url: editUrl.value })
    editingId.value = null
  }
}

function doCreateFolder() {
  if (newFolderName.value.trim()) {
    createFolder(newFolderName.value.trim(), selectedFolderId.value)
    newFolderName.value = ''
    showNewFolder.value = false
  }
}

async function doImport() {
  const count = await importBookmarksHTML()
  importCount.value = count
  setTimeout(() => { importCount.value = null }, 3000)
}

function doExport() {
  const html = exportBookmarksHTML()
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'dawn_bookmarks.html'; a.click()
  URL.revokeObjectURL(url)
}

function onDragStart(e, id) {
  dragBmId.value = id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', id)
}
function onFolderDrop(e, folderId) {
  e.preventDefault()
  if (dragBmId.value) {
    moveBookmark(dragBmId.value, folderId)
    dragBmId.value = null
  }
}
function onDragEnd() { dragBmId.value = null }
</script>

<template>
  <div class="bm-root">
    <!-- Toolbar -->
    <div class="bm-toolbar">
      <button class="bm-btn" @click="showNewFolder = !showNewFolder">+ Folder</button>
      <button class="bm-btn" @click="doImport">Import</button>
      <button class="bm-btn" @click="doExport">Export</button>
      <span v-if="importCount !== null" class="bm-import-count">Imported {{ importCount }}</span>
    </div>

    <!-- New folder input -->
    <div v-if="showNewFolder" class="bm-new-folder">
      <input v-model="newFolderName" @keydown.enter="doCreateFolder" @keydown.escape="showNewFolder = false" placeholder="Folder name..." class="bm-input" />
      <button @click="doCreateFolder" :disabled="!newFolderName.trim()" class="bm-btn-sm">OK</button>
    </div>

    <!-- Breadcrumb -->
    <div class="bm-breadcrumb">
      <button class="bm-crumb" :class="{ active: selectedFolderId === 'root' }" @click="selectFolder('root')">Root</button>
      <template v-for="f in folderPath" :key="f.id">
        <span class="bm-sep">/</span>
        <button class="bm-crumb" :class="{ active: selectedFolderId === f.id }" @click="selectFolder(f.id)">{{ f.title }}</button>
      </template>
    </div>

    <!-- Folder list -->
    <div v-if="currentFolders.length > 0" class="bm-section">
      <div class="bm-section-label">Folders</div>
      <div v-for="folder in currentFolders" :key="folder.id" class="bm-item bm-folder"
        @click="selectFolder(folder.id)"
        @dragover.prevent @drop="onFolderDrop($event, folder.id)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        <span class="bm-item-title">{{ folder.title }}</span>
        <button class="bm-item-del" @click.stop="deleteFolder(folder.id)" title="Delete folder">&times;</button>
      </div>
    </div>

    <!-- Bookmark list -->
    <div class="bm-section">
      <div class="bm-section-label">Bookmarks ({{ currentBookmarks.length }})</div>
      <div v-if="currentBookmarks.length === 0" class="bm-empty">No bookmarks in this folder</div>
      <div v-for="bm in currentBookmarks" :key="bm.id" class="bm-item"
        :draggable="true"
        @dragstart="onDragStart($event, bm.id)"
        @dragend="onDragEnd"
        @click="bm.url && emit('navigate', bm.url)">
        <template v-if="editingId === bm.id">
          <input v-model="editTitle" @keydown.enter="finishEdit" @blur="finishEdit" class="bm-input bm-edit-input" />
          <input v-if="bm.type !== 'file'" v-model="editUrl" @keydown.enter="finishEdit" class="bm-input bm-edit-input" />
        </template>
        <template v-else>
          <span class="bm-item-icon">{{ bm.type === 'file' ? '📄' : '🌐' }}</span>
          <span class="bm-item-title" @dblclick="startEdit(bm)">{{ bm.title }}</span>
          <span v-if="bm.url" class="bm-item-url">{{ bm.url }}</span>
          <button class="bm-item-edit" @click="startEdit(bm)" title="Edit">✎</button>
          <button class="bm-item-del" @click="removeBookmark(bm.id)" title="Delete">&times;</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bm-root { display: flex; flex-direction: column; gap: 8px; }
.bm-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.bm-btn { padding: 4px 10px; background: var(--color-bg-hover); border: 1px solid var(--color-border); border-radius: 5px; font-size: 11px; font-family: inherit; color: var(--color-text); cursor: pointer; }
.bm-btn:hover { background: var(--color-bg-active); }
.bm-btn-sm { padding: 3px 8px; background: var(--color-bg-hover); border: 1px solid var(--color-border); border-radius: 4px; font-size: 10px; font-family: inherit; color: var(--color-text); cursor: pointer; }
.bm-btn-sm:disabled { opacity: 0.3; }
.bm-import-count { font-size: 10px; color: #22c55e; }
.bm-new-folder { display: flex; gap: 4px; }
.bm-input { padding: 4px 8px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 4px; font-size: 12px; font-family: inherit; color: var(--color-text); outline: none; }
.bm-input:focus { border-color: var(--color-border-interactive); }
.bm-edit-input { flex: 1; min-width: 60px; }

.bm-breadcrumb { display: flex; align-items: center; gap: 2px; padding: 4px 0; font-size: 11px; }
.bm-crumb { background: transparent; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: 11px; font-family: inherit; padding: 2px 4px; border-radius: 3px; }
.bm-crumb:hover { background: var(--color-bg-hover); color: var(--color-text); }
.bm-crumb.active { color: var(--color-text); font-weight: 600; }
.bm-sep { color: var(--color-text-muted); }

.bm-section { }
.bm-section-label { font-size: 9px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.8px; padding: 4px 0 2px; }
.bm-empty { font-size: 11px; color: var(--color-text-muted); padding: 8px 0; font-style: italic; }

.bm-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 4px; cursor: pointer; transition: all 0.1s; font-size: 12px; color: var(--color-text-secondary); }
.bm-item:hover { background: var(--color-bg-hover); color: var(--color-text); }
.bm-folder:hover { background: var(--color-accent-bg); color: var(--color-accent); }
.bm-item-icon { font-size: 12px; flex-shrink: 0; }
.bm-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-item-url { font-size: 9px; color: var(--color-text-muted); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.bm-item-edit, .bm-item-del { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: transparent; border: none; border-radius: 3px; color: var(--color-text-muted); cursor: pointer; font-size: 11px; opacity: 0; }
.bm-item:hover .bm-item-edit, .bm-item:hover .bm-item-del { opacity: 1; }
.bm-item-edit:hover { color: var(--color-accent); background: var(--color-accent-hover); }
.bm-item-del:hover { color: #c00; background: var(--color-error-bg); }
</style>
