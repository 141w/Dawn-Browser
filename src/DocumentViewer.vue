<script setup>
import { ref, watch, onMounted } from 'vue'
import { useDocumentViewer } from './composables/useDocumentViewer'

const props = defineProps({
  fileData: { type: String, default: '' },    // base64
  fileExt: { type: String, default: '' },
  fileName: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const { docContent, docPages, docError, docMeta, isLoading, parseDocument } = useDocumentViewer()

const displayName = ref('')
const showPdfPage = ref(1)
const isDragging = ref(false)

/* ── Parse file data when prop changes ── */
watch(() => [props.fileData, props.fileExt], async ([data, ext]) => {
  if (data && ext) {
    displayName.value = props.fileName
    showPdfPage.value = 1
    await parseDocument(data, ext)
  }
}, { immediate: true })

/* ── Open file dialog ── */
async function openFile() {
  if (!window.electronAPI?.openFileDialog) {
    docError.value = 'File dialog not available (requires Electron)'
    return
  }
  const result = await window.electronAPI.openFileDialog()
  if (!result) return
  displayName.value = result.fileName
  showPdfPage.value = 1
  await parseDocument(result.data, result.ext)
}

/* ── Drag & drop ── */
function onDragOver(e) { e.preventDefault(); isDragging.value = true }
function onDragLeave() { isDragging.value = false }
async function onDrop(e) {
  e.preventDefault()
  isDragging.value = false
  const file = e.dataTransfer.files[0]
  if (!file) return
  displayName.value = file.name
  showPdfPage.value = 1
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const reader = new FileReader()
  reader.onload = () => {
    const base64 = reader.result.split(',')[1]
    parseDocument(base64, ext)
  }
  reader.readAsDataURL(file)
}

/* ── PDF page nav ── */
function prevPage() { if (showPdfPage.value > 1) showPdfPage.value-- }
function nextPage() { if (showPdfPage.value < docPages.value.length) showPdfPage.value++ }
watch(docPages, () => { showPdfPage.value = 1 })
</script>

<template>
  <div
    class="dv-root"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Toolbar -->
    <div class="dv-toolbar">
      <button v-if="emit.close" class="dv-btn dv-btn-back" @click="emit('close')" title="Back">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <button class="dv-btn" @click="openFile" :disabled="isLoading">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>Open</span>
      </button>
      <span v-if="displayName" class="dv-filename">{{ displayName }}</span>
      <span v-if="docMeta" class="dv-meta">{{ docMeta.preview }}</span>

      <!-- Spacer -->
      <span style="flex:1"></span>

      <!-- PDF page nav -->
      <template v-if="docPages.length > 1">
        <div class="dv-pdf-nav">
          <button class="dv-pdf-btn" @click="prevPage" :disabled="showPdfPage <= 1">&larr;</button>
          <span class="dv-pdf-info">{{ showPdfPage }} / {{ docPages.length }}</span>
          <button class="dv-pdf-btn" @click="nextPage" :disabled="showPdfPage >= docPages.length">&rarr;</button>
        </div>
      </template>

      <span v-if="isLoading" class="dv-loading">Loading...</span>
    </div>

    <!-- Error -->
    <div v-if="docError" class="dv-error-bar">{{ docError }}</div>

    <!-- Empty state -->
    <div
      v-if="!docContent && docPages.length === 0 && !docError && !isLoading"
      class="dv-dropzone"
      :class="{ dragging: isDragging }"
    >
      <div class="dv-drop-inner">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        <p class="dv-drop-text">Drop a file or click <strong>Open</strong></p>
        <p class="dv-drop-hint">PDF · DOCX · XLSX · PPTX · CSV · TXT · MD</p>
      </div>
    </div>

    <!-- PDF -->
    <div v-if="docPages.length > 0" class="dv-pdf-container">
      <img
        v-for="(img, i) in docPages"
        :key="i"
        :src="img"
        class="dv-pdf-page"
        :style="{ display: i + 1 === showPdfPage ? 'block' : 'none' }"
        alt="PDF page"
      />
    </div>

    <!-- HTML content (DOCX, XLSX, PPTX, etc.) -->
    <div v-if="docContent" class="dv-content" v-html="docContent"></div>

    <!-- Loader -->
    <div v-if="isLoading" class="dv-loading-center">
      <div class="dv-spinner"></div>
      <span>Parsing document...</span>
    </div>
  </div>
</template>

<style scoped>
.dv-root {
  display: flex; flex-direction: column; height: 100%; background: var(--color-bg);
  font-family: inherit; overflow: hidden;
}

/* Toolbar */
.dv-toolbar {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px;
  background: var(--color-bg-hover); border-bottom: 1px solid var(--color-border);
  flex-shrink: 0; min-height: 42px;
}
.dv-btn {
  display: flex; align-items: center; gap: 5px; padding: 5px 12px;
  background: var(--color-text); color: var(--color-bg-elevated); border: none; border-radius: 7px;
  font-size: 12px; font-family: inherit; cursor: pointer; transition: opacity .15s;
}
.dv-btn:hover { opacity: .85; }
.dv-btn:disabled { opacity: .3; cursor: not-allowed; }
.dv-btn-back { background: transparent; color: var(--color-text); padding: 5px 8px; }
.dv-btn-back:hover { background: var(--color-bg-hover); opacity: 1; }
.dv-filename { font-size: 13px; font-weight: 600; color: var(--color-text); }
.dv-meta { font-size: 11px; color: var(--color-text-muted); }
.dv-loading { font-size: 11px; color: var(--color-text-muted); }

.dv-pdf-nav { display: flex; align-items: center; gap: 6px; }
.dv-pdf-btn {
  display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  background: transparent; border: 1px solid var(--color-border); border-radius: 6px;
  font-size: 14px; color: var(--color-text); cursor: pointer;
}
.dv-pdf-btn:hover { background: var(--color-bg-hover); }
.dv-pdf-btn:disabled { opacity: .2; cursor: not-allowed; }
.dv-pdf-info { font-size: 11px; font-family: monospace; color: var(--color-text-secondary); min-width: 50px; text-align: center; }

/* Error */
.dv-error-bar {
  padding: 10px 16px; background: var(--color-error-bg);
  border-bottom: 1px solid var(--color-error-border);
  font-size: 12px; color: #c00; flex-shrink: 0;
}

/* Dropzone */
.dv-dropzone {
  flex: 1; display: flex; align-items: center; justify-content: center;
  margin: 24px; border: 2px dashed var(--color-border); border-radius: 16px;
  transition: all .2s;
}
.dv-dropzone:hover, .dv-dropzone.dragging { border-color: rgba(28,28,28,0.25); background: var(--color-bg-hover); }
.dv-drop-inner { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px; }
.dv-drop-text { font-size: 14px; color: var(--color-text-secondary); }
.dv-drop-hint { font-size: 11px; color: var(--color-text-muted); }

/* PDF */
.dv-pdf-container {
  flex: 1; overflow: auto; padding: 16px; display: flex; justify-content: center;
  background: var(--color-bg-hover);
}
.dv-pdf-page { max-width: 100%; height: auto; box-shadow: var(--color-shadow) 0px 2px 20px; border-radius: 4px; }

/* HTML content */
.dv-content {
  flex: 1; overflow: auto; padding: 24px 32px; font-size: 14px; line-height: 1.7;
  color: var(--color-text); max-width: 900px; margin: 0 auto; width: 100%;
}
.dv-content :deep(h1) { font-size: 24px; margin: 20px 0 12px; font-weight: 700; }
.dv-content :deep(h2) { font-size: 19px; margin: 16px 0 10px; font-weight: 600; }
.dv-content :deep(h3) { font-size: 16px; margin: 14px 0 8px; font-weight: 600; }
.dv-content :deep(p) { margin: 8px 0; }
.dv-content :deep(ul), .dv-content :deep(ol) { margin: 8px 0; padding-left: 24px; }
.dv-content :deep(li) { margin: 2px 0; }
.dv-content :deep(table) { border-collapse: collapse; margin: 12px 0; width: 100%; }
.dv-content :deep(td), .dv-content :deep(th) { padding: 5px 12px; border: 1px solid var(--color-border); font-size: 13px; }
.dv-content :deep(th) { background: var(--color-bg-hover); font-weight: 600; }
.dv-content :deep(img) { max-width: 100%; height: auto; border-radius: 6px; margin: 10px 0; }
.dv-content :deep(code) { background: var(--color-bg-hover); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 12px; }
.dv-content :deep(pre) { background: var(--color-shadow-sm); padding: 14px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 10px 0; }
.dv-content :deep(blockquote) { border-left: 3px solid var(--color-border); padding-left: 14px; margin: 10px 0; color: var(--color-text-secondary); }

/* Sheet name / Slide label */
.dv-sheet-name { font-size: 14px; font-weight: 600; margin: 18px 0 8px; padding: 4px 0; border-bottom: 2px solid var(--color-border); }
.dv-table-wrap { overflow-x: auto; margin: 8px 0 18px; }
.dv-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.dv-table td, .dv-table th { padding: 5px 12px; border: 1px solid var(--color-border); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-table th { background: var(--color-bg-hover); font-weight: 600; position: sticky; top: 0; }
.dv-table tr:nth-child(even) td { background: var(--color-bg-hover); }

.dv-slide { margin: 14px 0; padding: 18px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 12px; }
.dv-slide-num { font-size: 11px; font-weight: 600; color: var(--color-text-muted); margin-bottom: 10px; text-transform: uppercase; letter-spacing: .5px; }
.dv-slide-text { margin: 5px 0; font-size: 14px; }

.dv-text { font-family: 'SF Mono', monospace; font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }

/* Loading */
.dv-loading-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: var(--color-text-muted); font-size: 13px; }
.dv-spinner { width: 30px; height: 30px; border: 2px solid var(--color-border); border-top-color: var(--color-text-muted); border-radius: 50%; animation: dv-spin .8s linear infinite; }
@keyframes dv-spin { to { transform: rotate(360deg); } }
</style>
