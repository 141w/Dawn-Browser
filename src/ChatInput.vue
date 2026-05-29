<script setup>
import { ref, computed, nextTick } from 'vue'
import { t } from './composables/useI18n'
import { useContextRef } from './composables/useContextRef'
import { useSlashCommands } from './composables/useSlashCommands'
import { useAiConfig } from './composables/useAiConfig'
import { useAiChat } from './composables/useAiChat'
import { useBrowserTabs } from './composables/useBrowserTabs'

const props = defineProps({ isStreaming: Boolean })
const emit = defineEmits(['send', 'stop', 'clear', 'help'])

const { contextRefs, addContextRef, removeContextRef, clearContextRefs, getContextPrompt, searchRefTypes } = useContextRef()
const { getFilteredCommands, matchCommand } = useSlashCommands()
const { config, providers } = useAiConfig()
const { agentMode, toggleAgentMode } = useAiChat()
const { getOpenPageRefs } = useBrowserTabs()

const inputMsg = ref('')
const textareaEl = ref(null)
const showSlashPanel = ref(false)
const slashIndex = ref(0)
const filterText = ref('')
const showRefPicker = ref(false)
const refIndex = ref(0)
const filteredRefTypes = ref([])
const showModelMenu = ref(false)
const showMoreMenu = ref(false)
const slashChip = ref(null) // { name, label, description, execute }

/* ── Saved models ── */
function loadSavedModels() {
  try { return JSON.parse(localStorage.getItem('dawn-saved-models') || '[]') } catch { return [] }
}
function saveModelEntry(providerId, modelName) {
  const saved = loadSavedModels().filter(m => !(m.provider === providerId && m.model === modelName))
  saved.unshift({ provider: providerId, model: modelName, time: Date.now() })
  if (saved.length > 20) saved.length = 20
  localStorage.setItem('dawn-saved-models', JSON.stringify(saved))
}
function removeSavedModel(idx) {
  const saved = loadSavedModels()
  saved.splice(idx, 1)
  localStorage.setItem('dawn-saved-models', JSON.stringify(saved))
}

const savedModels = computed(() => {
  const saved = loadSavedModels()
  return saved.map(s => {
    const p = providers.find(pr => pr.id === s.provider)
    return { ...s, providerName: p?.name || s.provider }
  })
})

function selectSavedModel(entry) {
  config.value.provider = entry.provider
  config.value.model = entry.model
  config.value.customModel = ''
  showModelMenu.value = false
}

const customModels = computed(() => {
  const saved = config.value.customModels
  if (Array.isArray(saved)) return saved
  if (config.value.customModel) return [config.value.customModel]
  return []
})

function selectCustomModel(m) {
  config.value.customModel = m
  config.value.model = m
  showModelMenu.value = false
}

/* ── Auto-resize ── */
function autoResize() {
  nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  })
}

function onInput() {
  const v = inputMsg.value
  if (v.startsWith('/')) {
    showSlashPanel.value = true; showRefPicker.value = false
    filterText.value = v; slashIndex.value = 0
  } else {
    // Detect @: show picker when there's an @ that's either at start or preceded by space
    const lastAt = v.lastIndexOf('@')
    const hasActiveAt = lastAt >= 0 && (lastAt === 0 || v[lastAt - 1] === ' ')
    if (hasActiveAt) {
      const query = v.slice(lastAt + 1).toLowerCase()
      // Only show if query has no spaces (still typing the ref name)
      if (!query.includes(' ')) {
        showRefPicker.value = true; showSlashPanel.value = false
        const tabs = getOpenPageRefs()
        const staticRefs = searchRefTypes(query).map(r => ({ ...r, id: r.type }))
        const allRefs = [...tabs, ...staticRefs]
        filteredRefTypes.value = query
          ? allRefs.filter(t =>
              (t.label || '').toLowerCase().includes(query) ||
              (t.url || t.preview || '').toLowerCase().includes(query))
          : allRefs
        refIndex.value = 0
      }
    } else {
      showSlashPanel.value = false; showRefPicker.value = false
    }
  }
  autoResize()
}

async function insertRef(refItem) {
  showRefPicker.value = false
  try {
    if (refItem.type === 'tab') {
      // Reference an open browser tab
      addContextRef('tab', {
        label: (refItem.title || refItem.label || '').slice(0, 40),
        preview: refItem.url,
        url: refItem.url,
        tabId: refItem.id,
        content: '' // Will be fetched when sending
      })
    } else if (refItem.type === 'file') {
      // Reference an open document tab
      addContextRef('tab', {
      label: (refItem.title || refItem.label || 'Document').slice(0, 40),
        preview: refItem.url,
        url: refItem.url,
        tabId: refItem.id,
        content: ''
      })
    } else if (refItem.type === 'page') {
      const meta = await window.electronAPI?.getPageMetadata()
      const body = await window.electronAPI?.getPageContent()
      if (meta) addContextRef('page', { label: (meta.title||'').slice(0,40), preview: meta.url, content: (body?.bodyText||'').replace(/\s+/g,' ').trim().slice(0,2000), meta:{url:meta.url,title:meta.title} })
    } else if (refItem.type === 'selection') {
      const sel = await window.electronAPI?.getPageSelection()
      if (sel) addContextRef('selection', { label:'Selection', preview:sel.slice(0,60), content:sel.slice(0,1000) })
    } else if (refItem.type === 'screenshot') {
      const d = await window.electronAPI?.capturePage()
      if (d) addContextRef('screenshot', { label:'Screenshot', preview:new Date().toLocaleTimeString(), content:d })
    }
  } catch(e) {}
}

async function send() {
  const msg = inputMsg.value.trim()

  // Send with active slash chip
  if (slashChip.value) {
    let prompt = ''
    try {
      const result = await slashChip.value.execute(null)
      if (result?.type === 'prompt') prompt = result.message
    } catch(e) { console.error('[ChatInput] Slash exec error:', e) }
    const chipInfo = { name: slashChip.value.name, label: slashChip.value.label }
    slashChip.value = null
    // aiContent = full prompt for the AI; displayContent = user text only shown in UI
    const displayContent = msg
    let ctxPrompt = getContextPrompt()
    let aiContent = prompt
    if (ctxPrompt) aiContent = ctxPrompt + '\n\n' + aiContent
    if (msg) aiContent = aiContent + '\n\n' + msg
    clearContextRefs()
    inputMsg.value = ''
    saveModelEntry(config.value.provider, config.value.model)
    emit('send', aiContent, chipInfo, displayContent)
    nextTick(autoResize)
    return
  }

  if (!msg && contextRefs.value.length === 0) return

  const match = matchCommand(msg)
  if (match) {
    inputMsg.value = ''
    showSlashPanel.value = false
    // Handle special system commands immediately
    if (match.command.name === '/help') {
      inputMsg.value = '/'
      showSlashPanel.value = true
      filterText.value = '/'
      slashIndex.value = 0
      return
    }
    if (match.command.name === '/clear') { emit('clear'); return }
    // Store as chip for visual display; preserve any extra text
    slashChip.value = {
      name: match.command.name,
      label: match.command.name,
      description: match.command.description,
      execute: match.command.execute
    }
    inputMsg.value = match.rest || ''
    autoResize()
    return
  }

  let ctxPrompt = getContextPrompt()
  let finalMsg = ctxPrompt ? ctxPrompt+'\n\n'+msg : msg
  saveModelEntry(config.value.provider, config.value.model)
  inputMsg.value = ''
  clearContextRefs()
  emit('send', finalMsg)
  nextTick(autoResize)
}

function removeSlashChip() {
  slashChip.value = null
}

function invokeSlashCmd(cmd) {
  if (cmd.name === '/help') {
    inputMsg.value = '/'
    showSlashPanel.value = true
    filterText.value = '/'
    slashIndex.value = 0
    return
  }
  inputMsg.value = ''
  showSlashPanel.value = false
  if (cmd.name === '/clear') { emit('clear'); return }
  slashChip.value = {
    name: cmd.name,
    label: cmd.name,
    description: cmd.description,
    execute: cmd.execute
  }
  autoResize()
}

function onKeydown(e) {
  if (e.key==='Enter' && !e.shiftKey) {
    e.preventDefault()
    if (showSlashPanel.value) {
      const c = getFilteredCommands(filterText.value)[slashIndex.value]
      if (c) { invokeSlashCmd(c); return }
    }
    if (showRefPicker.value && filteredRefTypes.value[refIndex.value]) { insertRef(filteredRefTypes.value[refIndex.value]); return }
    send(); return
  }
  if ((e.key==='ArrowDown'||e.key==='ArrowUp') && showSlashPanel.value) { e.preventDefault(); slashIndex.value=e.key==='ArrowDown'?Math.min(slashIndex.value+1,getFilteredCommands(filterText.value).length-1):Math.max(slashIndex.value-1,0) }
  if ((e.key==='ArrowDown'||e.key==='ArrowUp') && showRefPicker.value) { e.preventDefault(); refIndex.value=e.key==='ArrowDown'?Math.min(refIndex.value+1,filteredRefTypes.value.length-1):Math.max(refIndex.value-1,0) }
  if (e.key==='Escape') { showSlashPanel.value=false; showRefPicker.value=false; showModelMenu.value=false; showMoreMenu.value=false }
}

function closeAll() { showSlashPanel.value=false; showRefPicker.value=false; showModelMenu.value=false; showMoreMenu.value=false }
</script>

<template>
  <div class="ci-root">
    <!-- Main card -->
    <div class="ci-card">
      <!-- Text area -->
      <div class="ci-text-area">
        <!-- Inline chips (inside the card, above textarea) -->
        <div v-if="contextRefs.length > 0 || slashChip" class="ci-chips-inline">
          <span v-if="slashChip" class="ci-chip ci-chip-slash" @click="removeSlashChip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span class="ci-chip-name">{{ slashChip.label }}</span>
            <span class="ci-chip-x">&times;</span>
          </span>
          <span v-for="ref in contextRefs" :key="ref.id" class="ci-chip" @click="removeContextRef(ref.id)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span class="ci-chip-name">{{ ref.label || '...' }}</span>
            <span class="ci-chip-x">&times;</span>
          </span>
        </div>
        <textarea ref="textareaEl" v-model="inputMsg" @keydown="onKeydown" @input="onInput"
          :placeholder="t('ai.placeholder')" rows="2" :disabled="props.isStreaming" class="ci-textarea"></textarea>
      </div>

      <!-- Action bar -->
      <div class="ci-bar">
        <div class="ci-bar-left">
          <!-- Agent/Chat toggle -->
          <button class="ci-agent-toggle" :class="{ active: agentMode }" @click="toggleAgentMode" :title="agentMode ? t('chat.agentMode') : t('chat.chatMode')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span>{{ agentMode ? 'Agent' : 'Chat' }}</span>
          </button>

          <!-- @ button -->
          <div class="ci-drop-wrap">
            <button class="ci-tag-btn" @click.stop="showRefPicker=!showRefPicker; showSlashPanel=false; showModelMenu=false; showMoreMenu=false; if(showRefPicker&&filteredRefTypes.length===0){filteredRefTypes=[...getOpenPageRefs(),...searchRefTypes('').map(r=>({...r,id:r.type}))];refIndex=0}">@</button>
            <div v-if="showRefPicker" class="ci-dropdown" @click.stop>
              <div v-for="(ref,idx) in filteredRefTypes" :key="ref.id || ref.type" class="ci-drop-item" :class="{active:idx===refIndex}" @click="insertRef(ref)">
                <svg v-if="ref.icon==='file'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <svg v-else-if="ref.icon==='page'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <svg v-if="ref.icon==='page'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <svg v-else-if="ref.icon==='camera'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                <span>{{ ref.label }}</span>
              </div>
            </div>
          </div>

          <!-- / button -->
          <div class="ci-drop-wrap">
            <button class="ci-tag-btn" @click.stop="showSlashPanel=!showSlashPanel; showRefPicker=false; showModelMenu=false; showMoreMenu=false">/</button>
            <div v-if="showSlashPanel" class="ci-dropdown" @click.stop>
              <div v-for="(cmd,idx) in getFilteredCommands(filterText)" :key="cmd.name" class="ci-drop-item" :class="{active:idx===slashIndex}" @click="invokeSlashCmd(cmd)">
                <span class="ci-drop-name">{{ cmd.name }}</span>
                <span class="ci-drop-desc">{{ cmd.description }}</span>
              </div>
            </div>
          </div>

          <!-- More button -->
          <div class="ci-drop-wrap">
            <button class="ci-icon-btn" @click.stop="showMoreMenu=!showMoreMenu; showSlashPanel=false; showRefPicker=false; showModelMenu=false" :title="t('chat.more') || 'More'">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><line x1="8" y1="12" x2="21" y2="12"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>
            </button>
            <div v-if="showMoreMenu" class="ci-dropdown" @click.stop>
              <div class="ci-drop-item" @click="showMoreMenu=false; inputMsg=inputMsg+'\n[Attach page]'; autoResize()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                <span>{{ t('chat.more') || 'More' }}</span>
              </div>
              <div class="ci-drop-item" @click="showMoreMenu=false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                <span>More</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right side -->
        <div class="ci-bar-right">
          <!-- Model chip -->
          <div class="ci-drop-wrap">
            <button class="ci-model-chip" @click.stop="showModelMenu=!showModelMenu; showSlashPanel=false; showRefPicker=false; showMoreMenu=false">
              <span class="ci-model-chip-label">{{ config.customModel || config.model || 'gpt-4o-mini' }}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div v-if="showModelMenu" class="ci-dropdown ci-dropdown-right" @click.stop>
              <div class="ci-drop-head">{{ t('chat.savedModels') || 'Saved Models' }}</div>
              <div v-if="savedModels.length === 0 && customModels.length === 0" class="ci-drop-empty">{{ t('chat.sendToSave') || 'Send to save' }}</div>
              <div v-for="(m,idx) in savedModels" :key="idx" class="ci-drop-item" @click="selectSavedModel(m)">
                <span class="ci-drop-name">{{ m.model }}</span>
                <span class="ci-drop-desc">{{ m.providerName }}</span>
                <button class="ci-drop-del" @click.stop="removeSavedModel(idx)" :title="t('chat.deleteModel') || 'Delete'">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Send -->
          <button v-if="props.isStreaming" class="ci-send stop" @click="emit('stop')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          </button>
          <button v-else class="ci-send" @click="send" :disabled="!inputMsg.trim() && contextRefs.length===0 && !slashChip">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ci-root { max-width: 720px; width: 100%; margin: 0 auto; }

/* Chips (inline, inside the card) */
.ci-chips-inline { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.ci-chip {
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
  background: var(--color-shadow-sm); border: 1px solid var(--color-border);
  border-radius: 6px; font-size: 11px; cursor: pointer; max-width: 160px;
}
.ci-chip:hover { background: var(--color-error-bg); border-color: var(--color-error-border); }
.ci-chip-slash { background: var(--color-bg-hover); border-color: var(--color-bg-active); }
.ci-chip-slash .ci-chip-name { font-family: 'SF Mono', monospace; font-weight: 600; }
.ci-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text); }
.ci-chip-x { font-size: 13px; color: var(--color-text-muted); flex-shrink: 0; }

/* Card */
.ci-card {
  background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 20px;
  box-shadow: var(--color-shadow-sm) 0px 2px 12px; transition: all .2s;
}
.ci-card:focus-within { border-color: var(--color-border-interactive); box-shadow: var(--color-shadow) 0px 4px 24px; }

/* Text area */
.ci-text-area { padding: 14px 16px 8px; }
.ci-textarea {
  width: 100%; border: none; outline: none; background: transparent;
  font-size: 14px; font-family: inherit; color: var(--color-text); resize: none;
  line-height: 1.6; min-height: 48px; max-height: 200px;
}
.ci-textarea::placeholder { color: var(--color-text-muted); }

/* Action bar */
.ci-bar { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px 10px; gap: 8px; }
.ci-bar-left, .ci-bar-right { display: flex; align-items: center; gap: 4px; }

/* Tag buttons (@ and /) */
.ci-tag-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: transparent;
  border: 1px solid var(--color-border); border-radius: 7px;
  font-size: 15px; font-weight: 600; font-family: monospace;
  color: var(--color-text-muted); cursor: pointer; transition: all .15s;
}
.ci-tag-btn:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); border-color: var(--color-border-interactive); }

/* Agent toggle */
.ci-agent-toggle {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px; background: transparent;
  border: 1px solid var(--color-border); border-radius: 14px;
  font-size: 11px; font-family: inherit; font-weight: 600;
  color: var(--color-text-muted); cursor: pointer; transition: all .15s;
  white-space: nowrap; user-select: none;
}
.ci-agent-toggle svg { flex-shrink: 0; color: var(--color-text-muted); transition: color .15s; }
.ci-agent-toggle:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); border-color: var(--color-border-interactive); }
.ci-agent-toggle.active {
  background: rgba(59,130,246,0.08); border-color: rgba(59,130,246,0.3); color: var(--color-accent);
}
.ci-agent-toggle.active svg { color: var(--color-accent); }
.ci-agent-toggle.active:hover { background: var(--color-accent-hover); }

.ci-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: transparent;
  border: 1px solid var(--color-border); border-radius: 7px;
  color: var(--color-text-muted); cursor: pointer; transition: all .15s;
}
.ci-icon-btn:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); border-color: var(--color-border-interactive); }

/* Dropdown wrapper */
.ci-drop-wrap { position: relative; }

/* Dropdown menu (small, like context menu) */
.ci-dropdown {
  position: absolute; bottom: calc(100% + 6px); left: 0;
  min-width: 180px; max-width: 300px;
  background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 10px;
  box-shadow: var(--color-shadow) 0px 4px 20px; z-index: 40;
  overflow: hidden; padding: 4px;
}
.ci-dropdown-right { left: auto; right: 0; }

.ci-drop-head {
  padding: 6px 10px; font-size: 10px; font-weight: 600; color: var(--color-text-muted);
  text-transform: uppercase; letter-spacing: .5px;
}
.ci-drop-empty { padding: 10px; font-size: 11px; color: var(--color-text-muted); text-align: center; }

.ci-drop-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 6px; cursor: pointer; transition: all .1s;
  font-size: 12px; color: var(--color-text);
}
.ci-drop-item:hover, .ci-drop-item.active { background: var(--color-bg-hover); }
.ci-drop-item svg { flex-shrink: 0; color: var(--color-text-muted); }
.ci-drop-name { font-family: monospace; font-size: 11px; font-weight: 600; color: var(--color-text); min-width: 60px; }
.ci-drop-desc { font-size: 10px; color: var(--color-text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ci-drop-del {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; background: transparent; border: none;
  border-radius: 4px; color: var(--color-text-muted); cursor: pointer; flex-shrink: 0;
}
.ci-drop-del:hover { background: var(--color-error-bg); color: var(--color-error); }

/* Model chip */
.ci-model-chip {
  display: flex; align-items: center; gap: 5px; padding: 4px 10px;
  background: transparent; border: 1px solid var(--color-border); border-radius: 14px;
  font-size: 11px; font-family: inherit; color: var(--color-text-secondary); cursor: pointer;
  transition: all .15s; white-space: nowrap;
}
.ci-model-chip:hover { background: var(--color-bg-hover); color: var(--color-text); }
.ci-model-chip-label { max-width: 100px; overflow: hidden; text-overflow: ellipsis; }

/* Send */
.ci-send {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; background: var(--color-text); border: none;
  border-radius: 9px; color: var(--color-bg-elevated); cursor: pointer; flex-shrink: 0; transition: all .15s;
}
.ci-send:hover { opacity: .85; }
.ci-send:disabled { opacity: .2; cursor: not-allowed; }
.ci-send.stop { background: var(--color-error); }
</style>