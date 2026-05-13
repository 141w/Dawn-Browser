<script setup>
import { ref, nextTick } from 'vue'
import { t } from './composables/useI18n'
import { useContextRef } from './composables/useContextRef'

const props = defineProps({
  isStreaming: Boolean,
  disabled: Boolean,
})

const emit = defineEmits(['send', 'stop', 'attach-page', 'screenshot'])

const { contextRefs, addContextRef, removeContextRef, clearContextRefs, getContextPrompt, searchRefTypes, REF_TYPES } = useContextRef()

const inputMsg = ref('')
const textareaEl = ref(null)
const showSlashPanel = ref(false)
const slashIndex = ref(0)
const showRefPicker = ref(false)
const refIndex = ref(0)
const filteredRefTypes = ref([])
const filterText = ref('')

/* ── Auto-resize ── */
function autoResize() {
  nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  })
}

/* ── Slash commands ── */
import { useSlashCommands } from './composables/useSlashCommands'
const { getFilteredCommands, matchCommand } = useSlashCommands()

function insertSlashCommand(name) {
  inputMsg.value = name + ' '
  showSlashPanel.value = false
  textareaEl.value?.focus()
}

/* ── Handle input ── */
function onInput() {
  const val = inputMsg.value
  if (val.startsWith('/')) {
    showSlashPanel.value = true; showRefPicker.value = false
    filterText.value = val; slashIndex.value = 0
  } else if (val.includes('@') && !val.includes(' ')) {
    showRefPicker.value = true; showSlashPanel.value = false
    filteredRefTypes.value = searchRefTypes(val.slice(val.lastIndexOf('@') + 1))
    refIndex.value = 0
  } else {
    showSlashPanel.value = false; showRefPicker.value = false
  }
  autoResize()
}

/* ── Context refs ── */
async function insertRef(type) {
  showRefPicker.value = false
  try {
    if (type === 'page') {
      const meta = await window.electronAPI?.getPageMetadata()
      const body = await window.electronAPI?.getPageContent()
      if (meta) {
        const text = (body?.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
        addContextRef('page', {
          label: (meta.title || '').slice(0, 40),
          preview: meta.url,
          content: text,
          meta: { url: meta.url, title: meta.title }
        })
      }
    } else if (type === 'selection') {
      const sel = await window.electronAPI?.getPageSelection()
      if (sel) addContextRef('selection', { label: 'Selection', preview: sel.slice(0, 60), content: sel.slice(0, 1000) })
    } else if (type === 'screenshot') {
      const dataUrl = await window.electronAPI?.capturePage()
      if (dataUrl) addContextRef('screenshot', { label: 'Screenshot', preview: new Date().toLocaleTimeString(), content: dataUrl })
    }
  } catch (e) {
    console.error('[Dawn] Context ref error:', e)
  }
}

/* ── Send ── */
function send() {
  const msg = inputMsg.value.trim()
  if (!msg && contextRefs.value.length === 0) return

  const slashMatch = matchCommand(msg)
  if (slashMatch) {
    inputMsg.value = ''
    slashMatch.command.execute(null, slashMatch.rest ? { lang: slashMatch.rest } : null).then(result => {
      if (result.type === 'prompt') { inputMsg.value = result.message; send() }
      else if (result.type === 'clear') { emit('send', '', true) }
      else if (result.error) { inputMsg.value = result.error }
    })
    return
  }

  const ctx = getContextPrompt()
  const finalMsg = ctx ? ctx + '\n\n' + msg : msg
  inputMsg.value = ''
  clearContextRefs()
  emit('send', finalMsg, false)
  nextTick(autoResize)
}

/* ── Keyboard ── */
function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (showSlashPanel.value) {
      const cmd = getFilteredCommands(filterText.value)[slashIndex.value]
      if (cmd) { insertSlashCommand(cmd.name); return }
    }
    if (showRefPicker.value && filteredRefTypes.value[refIndex.value]) {
      insertRef(filteredRefTypes.value[refIndex.value].type)
      return
    }
    send()
  }
  if (e.key === 'ArrowDown' && showSlashPanel.value) {
    e.preventDefault(); slashIndex.value = Math.min(slashIndex.value + 1, getFilteredCommands(filterText.value).length - 1)
  }
  if (e.key === 'ArrowUp' && showSlashPanel.value) {
    e.preventDefault(); slashIndex.value = Math.max(slashIndex.value - 1, 0)
  }
  if (e.key === 'ArrowDown' && showRefPicker.value) {
    e.preventDefault(); refIndex.value = Math.min(refIndex.value + 1, filteredRefTypes.value.length - 1)
  }
  if (e.key === 'ArrowUp' && showRefPicker.value) {
    e.preventDefault(); refIndex.value = Math.max(refIndex.value - 1, 0)
  }
  if (e.key === 'Escape') { showSlashPanel.value = false; showRefPicker.value = false }
}

defineExpose({ inputMsg, textareaEl })
</script>

<template>
  <div class="cin-root">
    <!-- Inline context chips + textarea -->
    <div class="cin-input-card">
      <div class="cin-content">
        <!-- Context chips -->
        <span v-for="ref in contextRefs" :key="ref.id" class="cin-chip" @click="removeContextRef(ref.id)">
          <svg class="cin-chip-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span class="cin-chip-name">{{ ref.label || '...' }}</span>
          <span class="cin-chip-x">&times;</span>
        </span>

        <textarea
          ref="textareaEl"
          v-model="inputMsg"
          @keydown="onKeydown"
          @input="onInput"
          :placeholder="t('ai.placeholder')"
          rows="1"
          :disabled="props.isStreaming"
          class="cin-textarea"
        ></textarea>
      </div>

      <!-- Slash panel -->
      <div v-if="showSlashPanel" class="cin-popup">
        <div v-for="(cmd, idx) in getFilteredCommands(filterText)" :key="cmd.name"
          class="cin-popup-item" :class="{ active: idx === slashIndex }"
          @click="insertSlashCommand(cmd.name)" @mouseenter="slashIndex = idx">
          <span class="cin-popup-name">{{ cmd.name }}</span>
          <span class="cin-popup-desc">{{ cmd.description }}</span>
        </div>
      </div>

      <!-- Ref picker -->
      <div v-if="showRefPicker" class="cin-popup">
        <div v-for="(ref, idx) in filteredRefTypes" :key="ref.type"
          class="cin-popup-item" :class="{ active: idx === refIndex }"
          @click="insertRef(ref.type)" @mouseenter="refIndex = idx">
          <span class="cin-popup-icon">{{ ref.icon }}</span>
          <span class="cin-popup-name">{{ ref.label }}</span>
          <span class="cin-popup-desc">{{ ref.desc }}</span>
        </div>
      </div>
    </div>

    <!-- Bottom bar -->
    <div class="cin-bar">
      <div class="cin-bar-left">
        <button class="cin-bar-btn" @click="showRefPicker = !showRefPicker" title="Reference context">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="8" x2="12" y2="10"/><line x1="12" y1="14" x2="12" y2="16"/></svg>
        </button>
        <button class="cin-bar-btn" @click="$emit('attach-page')" title="Attach page">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
      </div>
      <button v-if="props.isStreaming" class="cin-send stop" @click="$emit('stop')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
      <button v-else class="cin-send" @click="send" :disabled="!inputMsg.trim() && contextRefs.length === 0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cin-root { display: flex; flex-direction: column; gap: 8px; }

/* Input card */
.cin-input-card {
  background: #fcfbf8; border: 1px solid #eceae4;
  border-radius: 18px; padding: 10px 14px;
  box-shadow: rgba(0,0,0,0.04) 0px 2px 12px;
  position: relative; transition: all 0.2s;
}
.cin-input-card:focus-within {
  border-color: rgba(28,28,28,0.25);
  box-shadow: rgba(0,0,0,0.08) 0px 4px 20px;
}

.cin-content {
  display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px;
  min-height: 32px;
}

/* Inline chips */
.cin-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; background: rgba(59,130,246,0.06);
  border: 1px solid rgba(59,130,246,0.15); border-radius: 8px;
  font-size: 12px; cursor: pointer; transition: all 0.1s;
  max-width: 180px; flex-shrink: 0;
}
.cin-chip:hover { background: rgba(255,95,86,0.06); border-color: rgba(255,95,86,0.2); }
.cin-chip-icon { flex-shrink: 0; }
.cin-chip-name {
  font-weight: 500; color: #1c1c1c;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cin-chip-x { font-size: 13px; color: #8a8a88; flex-shrink: 0; }

/* Textarea */
.cin-textarea {
  flex: 1; min-width: 80px; border: none; outline: none;
  background: transparent; font-size: 14px; font-family: inherit;
  color: #1c1c1c; resize: none; line-height: 1.5;
  padding: 2px 0; min-height: 24px;
}
.cin-textarea::placeholder { color: #8a8a88; }

/* Popups */
.cin-popup {
  position: absolute; bottom: calc(100% + 4px); left: 0; right: 0;
  background: #fcfbf8; border: 1px solid #eceae4; border-radius: 12px;
  max-height: 220px; overflow-y: auto; z-index: 20;
  box-shadow: rgba(0,0,0,0.08) 0px 4px 16px;
}
.cin-popup-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  cursor: pointer; transition: all 0.1s; border-bottom: 1px solid rgba(28,28,28,0.03);
}
.cin-popup-item:last-child { border-bottom: none; }
.cin-popup-item:hover, .cin-popup-item.active { background: rgba(28,28,28,0.04); }
.cin-popup-icon { font-size: 16px; flex-shrink: 0; }
.cin-popup-name { font-family: monospace; font-size: 12px; font-weight: 600; color: #1c1c1c; min-width: 80px; }
.cin-popup-desc { font-size: 11px; color: #8a8a88; flex: 1; }

/* Bottom bar */
.cin-bar { display: flex; align-items: center; justify-content: space-between; padding: 0 4px; }
.cin-bar-left { display: flex; gap: 4px; }
.cin-bar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; background: transparent; border: none;
  border-radius: 8px; color: #8a8a88; cursor: pointer; transition: all 0.15s;
}
.cin-bar-btn:hover { background: rgba(28,28,28,0.06); color: #1c1c1c; }

.cin-send {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: #1c1c1c; border: none;
  border-radius: 10px; color: #fcfbf8; cursor: pointer; transition: all 0.15s;
}
.cin-send:hover { opacity: 0.85; }
.cin-send:disabled { opacity: 0.25; cursor: not-allowed; }
.cin-send.stop { background: #ff5f56; }
</style>
