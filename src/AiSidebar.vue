<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAiConfig } from './composables/useAiConfig'
import { useAiChat } from './composables/useAiChat'
import { useToolSystem } from './composables/useToolSystem'
import { useSlashCommands } from './composables/useSlashCommands'
import { useAgentLoop } from './composables/useAgentLoop'
import { useContextManager } from './composables/useContextManager'
import { useProactiveAI } from './composables/useProactiveAI'
import { renderMarkdown } from './composables/useMarkdown'
import { t } from './composables/useI18n'
import { formatError } from './composables/useErrorFormat'
import ChatInput from './ChatInput.vue'

const props = defineProps({ embedded: Boolean })

const { config, providers, getProvider, getEffectiveModel, getEffectiveBaseUrl, getApiFormat } = useAiConfig()
const { conversations, activeConvId, isStreaming, streamError, pendingToolCalls, toolConfirmRequired, agentState, getActiveConversation, createConversation, deleteConversation, sendMessage, stopStreaming, skipCurrentTool, interruptAgent, confirmToolCall, editMessage, regenerateResponse, branchConversation, exportAsMarkdown, exportAsHtml } = useAiChat()
const { getRegisteredTools, getEnabledTools, setPermission, resolvePermission } = useToolSystem()
const { getFilteredCommands, matchCommand, getAllCommands, getCommandsByCategory } = useSlashCommands()
const { activePlan, getPlanSummary } = useAgentLoop()
const { contextStats } = useContextManager()
const { pageHints, analyzePage, addSmartBookmark } = useProactiveAI()

const activeConv = getActiveConversation()
const messagesEl = ref(null)
const showSettings = ref(false)
const showConvList = ref(false)
const settingsTab = ref('model')
const newCustomModel = ref('')
const pageMeta = ref(null)
const pageContent = ref(null)
const editingMsgIdx = ref(-1)
const editingMsgContent = ref('')
const showSummaryPanel = ref(false)
const showFormTemplates = ref(false)
const formTemplates = ref([])
const newTemplateName = ref('')
const translationResult = ref(null)
const showTranslation = ref(false)

/* ── Chat send handler ── */
function handleChatSend(finalMsg, slashCmd, displayMsg) {
  try {
    if (!finalMsg || !finalMsg.trim()) return
    if (!activeConvId.value) createConversation()
    sendMessage(finalMsg, null, null, slashCmd, displayMsg)
    nextTick(scrollToBottom)
  } catch(e) {
    console.error('[Dawn] handleChatSend error:', e)
  }
}

/* ── Computed ── */
const currentProvider = computed(() => getProvider())
const currentModels = computed(() => {
  const p = currentProvider.value
  const models = [...p.models]
  if (config.value.customModel && !models.includes(config.value.customModel)) models.push(config.value.customModel)
  return models
})
const enabledTools = computed(() => getEnabledTools())
const browserTools = computed(() => getRegisteredTools().map(t => ({ ...t, currentPermission: resolvePermission(t.name, t.permission) })))
const planSummary = computed(() => getPlanSummary())

/* ── Page ── */
async function fetchPageMeta() {
  try { pageMeta.value = await window.electronAPI?.getPageMetadata() } catch { pageMeta.value = null }
}
async function fetchPageContent() {
  try { pageContent.value = await window.electronAPI?.getPageContent() } catch { pageContent.value = null }
}

/* ── Scroll ── */
function scrollToBottom() {
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}
watch(() => activeConv.value?.messages?.length, () => nextTick(scrollToBottom))

/* ── Conversation ── */
function newChat() { createConversation(); showConvList.value = false; showSettings.value = false }
function switchConv(id) { activeConvId.value = id; showConvList.value = false }

function onProviderChange() {
  const p = getProvider()
  if (p.models.length > 0) config.value.model = p.models[0]
  config.value.customModel = ''
}
function addCustomModel() {
  const m = newCustomModel.value.trim()
  if (!m) return
  config.value.customModel = m
  config.value.model = m
  newCustomModel.value = ''
}

/* ── Tools ── */
function handleToolPermissionChange(toolName, level) {
  setPermission(toolName, level === 'default' ? null : level)
}

/* ── Slash ── */
function insertSlashCommand(cmdName) {
  showSettings.value = false
  showConvList.value = false
}

/* ── Export ── */
function downloadExport(fmt) {
  const activeConv = conversations.value.find(c => c.id === activeConvId.value)
  if (!activeConv) return
  const content = fmt === 'md' ? exportAsMarkdown(activeConvId.value) : exportAsHtml(activeConvId.value)
  const blob = new Blob([content], { type: fmt === 'md' ? 'text/markdown' : 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `dawn-chat.md`; a.click()
  URL.revokeObjectURL(url)
}

/* ── Edit ── */
function startEdit(idx, content) { editingMsgIdx.value = idx; editingMsgContent.value = content }
function saveEdit(idx) {
  const content = editingMsgContent.value.trim()
  if (!content) return
  editMessage(activeConvId.value, idx, content)
  editingMsgIdx.value = -1; editingMsgContent.value = ''
  sendMessage(content, null)
}
function cancelEdit() { editingMsgIdx.value = -1; editingMsgContent.value = '' }
function doRegenerate() { regenerateResponse(activeConvId.value) }
function doBranch(idx) { branchConversation(activeConvId.value, idx) }

/* ── Form templates ── */
function loadFormTemplates() { const saved = localStorage.getItem('dawn-form-templates'); formTemplates.value = saved ? JSON.parse(saved) : [] }
function saveFormTemplate() {
  const name = newTemplateName.value.trim()
  if (!name) return
  formTemplates.value.push({ name, fields: [], createdAt: Date.now() })
  localStorage.setItem('dawn-form-templates', JSON.stringify(formTemplates.value))
  newTemplateName.value = ''
}
function deleteFormTemplate(idx) { formTemplates.value.splice(idx, 1); localStorage.setItem('dawn-form-templates', JSON.stringify(formTemplates.value)) }

/* ── Translation ── */
function showTranslationCompare() {
  const conv = conversations.value.find(c => c.id === activeConvId.value)
  if (!conv) return
  let userMsg = null, asstMsg = null
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (!asstMsg && conv.messages[i].role === 'assistant') asstMsg = conv.messages[i]
    if (!userMsg && conv.messages[i].role === 'user') userMsg = conv.messages[i]
    if (userMsg && asstMsg) break
  }
  if (!userMsg || !asstMsg || !asstMsg.content) return
  const origParas = (userMsg.content || '').split(/\n\n+/).filter(p => p.trim())
  const transParas = asstMsg.content.split(/\n\n+/).filter(p => p.trim())
  translationResult.value = { paragraphs: origParas.map((o, i) => ({ original: o, translated: transParas[i] || '' })) }
  showTranslation.value = true
}

/* ── Init ── */
let metaInterval = null
onMounted(() => {
  fetchPageMeta(); fetchPageContent(); loadFormTemplates()
  metaInterval = setInterval(() => {
    fetchPageMeta().then(() => { if (pageMeta.value) addSmartBookmark(pageMeta.value) })
    fetchPageContent().then(() => { if (pageContent.value) analyzePage(pageContent.value) })
  }, 3000)
})
onBeforeUnmount(() => { if (metaInterval) clearInterval(metaInterval) })
</script>

<template>
  <div class="ai-sidebar" :class="{ embedded: props.embedded }">
    <div class="ai-header">
      <div class="ai-header-left">
        <button v-if="!props.embedded" class="ai-icon-btn" @click="showConvList = !showConvList" :class="{ active: showConvList }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </button>
        <span v-if="!props.embedded" class="ai-title">{{ t('ai.title') }}</span>
      </div>
      <div class="ai-header-right">
        <button v-if="!props.embedded" class="ai-icon-btn" @click="showSummaryPanel = !showSummaryPanel" :class="{ active: showSummaryPanel }" :title="showSummaryPanel ? t('ai.hidePanel') : t('ai.panel')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
        </button>
        <button class="ai-icon-btn" @click="downloadExport('md')" :title="t('ai.export')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="ai-icon-btn" @click="newChat" :title="t('ai.newChat')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button class="ai-icon-btn" @click="showSettings = !showSettings" :class="{ active: showSettings }" :title="t('ai.settings')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </div>
    </div>

    <div v-if="pageMeta && pageMeta.url && pageMeta.url !== 'dawn://newtab'" class="ai-page-bar">
      <img v-if="pageMeta.favicon" :src="pageMeta.favicon" class="ai-favicon" />
      <div class="ai-page-info"><span class="ai-page-title">{{ pageMeta.title || 'Untitled' }}</span><span class="ai-page-url">{{ pageMeta.url }}</span></div>
    </div>

    <div v-if="showConvList" class="ai-conv-list">
      <div class="ai-conv-item" v-for="conv in conversations" :key="conv.id" :class="{ active: conv.id === activeConvId }" @click="switchConv(conv.id)">
        <span class="ai-conv-title">{{ conv.title }}</span>
        <span class="ai-conv-time">{{ new Date(conv.createdAt).toLocaleDateString() }}</span>
        <button class="ai-conv-del" @click.stop="deleteConversation(conv.id)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div v-if="conversations.length === 0" class="ai-empty">{{ t('conv.empty') }}</div>
    </div>

    <div v-else-if="showSettings" class="ai-settings">
      <div class="ai-settings-tabs">
        <button class="ai-tab" :class="{ active: settingsTab === 'model' }" @click="settingsTab = 'model'">{{ t('settings.model') }}</button>
        <button class="ai-tab" :class="{ active: settingsTab === 'tools' }" @click="settingsTab = 'tools'">{{ t('settings.tools') }}</button>
        <button class="ai-tab" :class="{ active: settingsTab === 'forms' }" @click="settingsTab = 'forms'">{{ t('settings.forms') }}</button>
      </div>

      <template v-if="settingsTab === 'model'">
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.provider') }}</label><select class="ai-select" v-model="config.provider" @change="onProviderChange"><option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option></select></div>
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.modelLabel') }}</label><select class="ai-select" v-model="config.model"><option v-for="m in currentModels" :key="m" :value="m">{{ m }}</option></select><div class="ai-custom-model"><input class="ai-input" v-model="newCustomModel" :placeholder="t('settings.customModel')" @keydown.enter="addCustomModel" /><button class="ai-small-btn" @click="addCustomModel">{{ t('settings.add') }}</button></div></div>
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.apiKey') }}</label><input class="ai-input" type="password" v-model="config.apiKey" :placeholder="currentProvider.apiKeyRequired ? 'Required' : 'Optional'" /></div>
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.baseUrl') }}</label><input class="ai-input" v-model="config.baseUrl" :placeholder="currentProvider.baseUrl" /></div>
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.temperature') }}: {{ config.temperature }}</label><input class="ai-range" type="range" min="0" max="2" step="0.1" v-model.number="config.temperature" /></div>
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.maxTokens') }}</label><input class="ai-input" type="number" v-model.number="config.maxTokens" min="256" max="128000" step="256" /></div>
        <div class="ai-setting-group"><label class="ai-label">{{ t('settings.systemPrompt') }}</label><textarea class="ai-textarea" v-model="config.systemPrompt" rows="3"></textarea></div>
        <div class="ai-setting-info"><span>Format: {{ getApiFormat() }}</span><span>Endpoint: {{ getEffectiveBaseUrl() }}</span><span>Model: {{ getEffectiveModel() }}</span></div>
      </template>

      <template v-else-if="settingsTab === 'tools'">
        <div class="ai-tool-settings">
          <p class="ai-tool-settings-desc">{{ t('settings.toolsDesc') }}</p>
          <div class="ai-tool-item" v-for="tool in browserTools" :key="tool.name">
            <div class="ai-tool-info"><span class="ai-tool-name">{{ tool.name }}</span><span class="ai-tool-desc">{{ tool.description }}</span></div>
            <select class="ai-tool-perm-select" :value="tool.currentPermission" @change="handleToolPermissionChange(tool.name, $event.target.value)"><option value="default">{{ t('perm.default') }} ({{ tool.permission }})</option><option value="safe">{{ t('perm.safe') }}</option><option value="confirm">{{ t('perm.confirm') }}</option><option value="deny">{{ t('perm.deny') }}</option></select>
          </div>
        </div>
      </template>

      <template v-else-if="settingsTab === 'forms'">
        <div class="ai-form-templates">
          <p class="ai-tool-settings-desc">{{ t('settings.formsDesc') }}</p>
          <div class="ai-save-template"><input class="ai-input" v-model="newTemplateName" :placeholder="t('settings.templateName')" @keydown.enter="saveFormTemplate" /><button class="ai-small-btn" @click="saveFormTemplate" :disabled="!newTemplateName.trim()">{{ t('settings.saveTemplate') }}</button></div>
          <div v-if="formTemplates.length === 0" class="ai-empty" style="padding:16px">{{ t('settings.noTemplates') }}</div>
          <div v-for="(tmpl, idx) in formTemplates" :key="idx" class="ai-template-item">
            <div class="ai-template-info"><span class="ai-template-name">{{ tmpl.name }}</span><span class="ai-template-fields">{{ tmpl.fields?.length || 0 }} {{ t('settings.fields') }}</span></div>
            <div class="ai-template-actions"><button class="ai-small-btn" @click="fillFromTemplate(tmpl)">{{ t('settings.fill') }}</button><button class="ai-template-del" @click="deleteFormTemplate(idx)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>
          </div>
        </div>
      </template>
    </div>

    <div v-else class="ai-chat" :class="{ 'ai-chat-panels': showSummaryPanel || showTranslation }">
      <!-- Agent status bar -->
      <div v-if="agentState !== 'idle'" class="ai-agent-bar" :class="agentState">
        <span class="ai-agent-dot"></span>
        <span v-if="agentState === 'thinking'">Agent 思考中...</span>
        <span v-else-if="agentState === 'executing'">Agent 执行工具中...</span>
        <span v-if="pendingToolCalls.length > 0" class="ai-agent-tool-name">{{ pendingToolCalls.map(tc => tc.name).join(', ') }}</span>
        <button v-if="agentState === 'executing'" class="ai-agent-btn" @click="skipCurrentTool" title="Skip current tool">Skip</button>
        <button class="ai-agent-btn stop" @click="interruptAgent" title="Stop agent">Stop</button>
      </div>
      <div class="ai-messages" ref="messagesEl" :class="{ 'ai-messages-narrow': showSummaryPanel || showTranslation }">
        <div v-if="!activeConv || activeConv.messages.length === 0" class="ai-welcome">
          <div class="ai-welcome-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"><path d="M12 2a10 10 0 0110 10 10 10 0 01-10 10A10 10 0 012 12 10 10 0 0112 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </div>
          <p class="ai-welcome-text">{{ t('ai.welcome') }}</p>
          <p class="ai-welcome-hint">{{ t('ai.welcome.hint') }}</p>
          <div class="ai-welcome-commands">
            <button v-for="cmd in getAllCommands().slice(0, 6)" :key="cmd.name" class="ai-welcome-cmd" @click="insertSlashCommand(cmd.name)">
              <span class="ai-welcome-cmd-name">{{ cmd.name }}</span><span class="ai-welcome-cmd-desc">{{ cmd.description }}</span>
            </button>
          </div>
        </div>

        <template v-for="(msg, i) in activeConv?.messages" :key="i">
          <div v-if="msg.role === 'user'" class="ai-msg user">
            <div v-if="editingMsgIdx === i" class="ai-edit-block">
              <textarea class="ai-edit-textarea" v-model="editingMsgContent" @keydown.ctrl.enter="saveEdit(i)" @keydown.escape="cancelEdit" rows="2"></textarea>
              <div class="ai-edit-actions"><button class="ai-edit-btn cancel" @click="cancelEdit">{{ t('ai.cancel') }}</button><button class="ai-edit-btn save" @click="saveEdit(i)">{{ t('ai.saveSend') }}</button></div>
            </div>
            <template v-else>
              <span v-if="msg.slashCmd" class="ai-slash-badge">{{ msg.slashCmd.label }}</span>
              <div class="ai-msg-content">{{ msg.content }}</div>
              <div v-if="msg.images" class="ai-msg-images"><img v-for="(img, j) in msg.images" :key="j" :src="img" class="ai-attached-img" /></div>
              <div class="ai-msg-actions">
                <button class="ai-msg-action-btn" @click="startEdit(i, msg.content)" :title="t('msg.edit')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="ai-msg-action-btn" @click="doBranch(i)" :title="t('msg.branch')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></button>
              </div>
            </template>
          </div>

          <div v-else-if="msg.role === 'assistant'" class="ai-msg assistant">
            <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="ai-tool-calls">
              <div v-for="tc in msg.toolCalls" :key="tc.id" class="ai-tool-call"><span class="ai-tool-call-icon">&#9881;</span><span class="ai-tool-call-name">{{ tc.name }}</span><span class="ai-tool-call-args">{{ typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments).slice(0, 80) }}</span></div>
            </div>
            <div v-if="msg.content" class="ai-msg-content mk-body" v-html="renderMarkdown(msg.content)"></div>
            <div v-if="msg.content && i === activeConv?.messages?.length - 1" class="ai-msg-actions">
              <button class="ai-msg-action-btn" @click="doRegenerate" :disabled="isStreaming" :title="t('msg.regenerate')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg></button>
              <button class="ai-msg-action-btn" @click="doBranch(i)" :title="t('msg.branch')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></button>
              <button v-if="msg.content" class="ai-msg-action-btn" @click="showTranslationCompare" :title="t('ai.compare')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg></button>
            </div>
          </div>

          <div v-else-if="msg.role === 'tool'" class="ai-msg tool-result">
            <div class="ai-tool-result"><span class="ai-tool-result-label">{{ msg.name }}</span><span class="ai-tool-result-content">{{ msg.content?.substring(0, 300) }}{{ msg.content?.length > 300 ? '...' : '' }}</span></div>
          </div>
        </template>

        <div v-if="toolConfirmRequired" class="ai-tool-confirm">
          <p class="ai-tool-confirm-text">{{ t('tool.confirm') }} <strong>{{ toolConfirmRequired.toolName }}</strong>?<code>{{ JSON.stringify(toolConfirmRequired.toolArgs).slice(0, 100) }}</code></p>
          <div class="ai-tool-confirm-actions"><button class="ai-tool-confirm-deny" @click="confirmToolCall(false)">{{ t('tool.deny') }}</button><button class="ai-tool-confirm-allow" @click="confirmToolCall(true)">{{ t('tool.allow') }}</button></div>
        </div>

        <div v-if="isStreaming && activeConv?.messages?.length > 0">
          <div v-if="pendingToolCalls.length > 0" class="ai-pending-tools">
            <div v-for="tc in pendingToolCalls" :key="tc.id" class="ai-tool-call running"><span class="ai-tool-call-icon spinning">&#9881;</span><span class="ai-tool-call-name">{{ tc.name }}</span><span class="ai-tool-call-status">{{ t('tool.executing') }}</span></div>
          </div>
          <div v-else-if="!activeConv.messages[activeConv.messages.length - 1]?.content && !activeConv.messages[activeConv.messages.length - 1]?.toolCalls?.length" class="ai-msg assistant"><div class="ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div></div>
        </div>
        <div v-if="streamError" class="ai-error">{{ formatError(streamError) }}</div>
      </div>

      <ChatInput :isStreaming="isStreaming" @send="handleChatSend" @stop="stopStreaming" @clear="newChat()" />

      <div v-if="showSummaryPanel || showTranslation" class="ai-side-panel">
        <div v-if="showTranslation && translationResult" class="ai-translation-panel">
          <div class="ai-translation-header"><span class="ai-translation-title">{{ t('translation.title') }}</span><button class="ai-translation-close" @click="showTranslation = false; translationResult = null">&times;</button></div>
          <div class="ai-translation-body">
            <div v-for="(para, idx) in translationResult.paragraphs" :key="idx" class="ai-translation-para-pair">
              <div class="ai-translation-original"><span class="ai-translation-label">{{ t('translation.original') }}</span><p>{{ para.original }}</p></div>
              <div class="ai-translation-translated"><span class="ai-translation-label">{{ t('translation.translated') }}</span><p>{{ para.translated }}</p></div>
            </div>
          </div>
        </div>
        <div v-else-if="showSummaryPanel" class="ai-summary-panel">
          <div class="ai-summary-header"><span class="ai-summary-title">{{ t('summary.title') }}</span><button class="ai-summary-close" @click="showSummaryPanel = false">&times;</button></div>
          <div class="ai-summary-body">
            <div v-if="pageContent" class="ai-summary-section"><div class="ai-summary-page-title">{{ pageContent.title }}</div><div class="ai-summary-page-url">{{ pageContent.url }}</div></div>
            <div v-if="!pageContent" class="ai-summary-empty">{{ t('summary.empty') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-sidebar { display: flex; flex-direction: column; height: 100%; background: #f7f4ed; font-family: inherit; }
.ai-sidebar.embedded { border-left: none; }
.ai-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #eceae4; flex-shrink: 0; height: 42px; }
.ai-header-left, .ai-header-right { display: flex; align-items: center; gap: 4px; }
.ai-title { font-size: 13px; font-weight: 600; color: #1c1c1c; margin-left: 4px; }
.ai-icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: none; border-radius: 6px; color: #5f5f5d; cursor: pointer; transition: all 0.15s; }
.ai-icon-btn:hover { background: rgba(28,28,28,0.06); color: #1c1c1c; }
.ai-icon-btn.active { background: rgba(28,28,28,0.08); color: #1c1c1c; }
.ai-page-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #eceae4; background: rgba(28,28,28,0.02); flex-shrink: 0; }
.ai-favicon { width: 16px; height: 16px; border-radius: 2px; flex-shrink: 0; }
.ai-page-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ai-page-title { font-size: 11px; font-weight: 600; color: #1c1c1c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-page-url { font-size: 10px; color: #8a8a88; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-conv-list { flex: 1; overflow-y: auto; padding: 6px; }
.ai-conv-item { display: flex; align-items: center; padding: 8px 10px; border-radius: 6px; cursor: pointer; transition: all 0.15s; margin-bottom: 2px; gap: 8px; }
.ai-conv-item:hover { background: rgba(28,28,28,0.04); }
.ai-conv-item.active { background: rgba(28,28,28,0.06); }
.ai-conv-title { flex: 1; font-size: 13px; color: #1c1c1c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-conv-time { font-size: 10px; color: #8a8a88; flex-shrink: 0; }
.ai-conv-del { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: transparent; border: none; border-radius: 4px; color: #8a8a88; cursor: pointer; opacity: 0; transition: all 0.15s; }
.ai-conv-item:hover .ai-conv-del { opacity: 1; }
.ai-conv-del:hover { background: rgba(28,28,28,0.08); color: #1c1c1c; }
.ai-empty { padding: 20px; text-align: center; color: #8a8a88; font-size: 13px; }
.ai-settings { flex: 1; overflow-y: auto; padding: 12px; }
.ai-settings-tabs { display: flex; gap: 2px; margin-bottom: 14px; }
.ai-tab { flex: 1; padding: 6px 0; background: transparent; border: none; border-bottom: 2px solid transparent; font-size: 12px; font-weight: 600; color: #8a8a88; cursor: pointer; transition: all 0.15s; }
.ai-tab.active { color: #1c1c1c; border-bottom-color: #1c1c1c; }
.ai-setting-group { margin-bottom: 14px; }
.ai-label { display: block; font-size: 12px; font-weight: 600; color: #5f5f5d; margin-bottom: 4px; }
.ai-select, .ai-input { width: 100%; padding: 6px 8px; background: #f7f4ed; border: 1px solid #eceae4; border-radius: 6px; font-size: 13px; font-family: inherit; color: #1c1c1c; outline: none; }
.ai-select:focus, .ai-input:focus { border-color: rgba(28,28,28,0.4); }
.ai-custom-model { display: flex; gap: 4px; margin-top: 4px; }
.ai-custom-model .ai-input { flex: 1; }
.ai-small-btn { padding: 6px 10px; background: #1c1c1c; color: #fcfbf8; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; flex-shrink: 0; }
.ai-small-btn:hover { opacity: 0.85; }
.ai-range { width: 100%; accent-color: #1c1c1c; }
.ai-textarea { width: 100%; padding: 6px 8px; background: #f7f4ed; border: 1px solid #eceae4; border-radius: 6px; font-size: 12px; font-family: inherit; color: #1c1c1c; outline: none; resize: vertical; }
.ai-textarea:focus { border-color: rgba(28,28,28,0.4); }
.ai-setting-info { display: flex; flex-direction: column; gap: 2px; padding: 8px; background: rgba(28,28,28,0.03); border-radius: 6px; font-size: 11px; color: #8a8a88; }
.ai-tool-settings { padding: 0; }
.ai-tool-settings-desc { font-size: 11px; color: #5f5f5d; margin-bottom: 10px; }
.ai-tool-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; margin-bottom: 4px; background: rgba(28,28,28,0.02); border-radius: 6px; gap: 8px; }
.ai-tool-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ai-tool-name { font-family: 'SF Mono', monospace; font-size: 11px; font-weight: 600; color: #1c1c1c; }
.ai-tool-desc { font-size: 10px; color: #8a8a88; }
.ai-tool-perm-select { padding: 3px 6px; background: #f7f4ed; border: 1px solid #eceae4; border-radius: 4px; font-size: 10px; font-family: inherit; color: #1c1c1c; outline: none; flex-shrink: 0; }
.ai-form-templates { padding: 0; }
.ai-save-template { display: flex; gap: 6px; margin-bottom: 14px; }
.ai-save-template .ai-input { flex: 1; }
.ai-template-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; margin-bottom: 4px; background: rgba(28,28,28,0.02); border-radius: 6px; gap: 8px; }
.ai-template-info { display: flex; flex-direction: column; min-width: 0; }
.ai-template-name { font-size: 12px; font-weight: 600; color: #1c1c1c; }
.ai-template-fields { font-size: 10px; color: #8a8a88; }
.ai-template-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.ai-template-del { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: transparent; border: none; border-radius: 4px; color: #8a8a88; cursor: pointer; }
.ai-template-del:hover { background: rgba(255,95,86,0.1); color: #c00; }
.ai-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.ai-agent-bar {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  background: rgba(59,130,246,0.06); border-bottom: 1px solid rgba(59,130,246,0.12);
  font-size: 11px; color: #2563eb; flex-shrink: 0; user-select: none;
}
.ai-agent-bar.executing { background: rgba(59,130,246,0.1); }
.ai-agent-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #2563eb;
  animation: ai-bounce 1.4s ease-in-out infinite;
}
.ai-agent-tool-name {
  font-family: 'SF Mono', monospace; font-size: 10px; color: #1c1c1c;
  margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;
}
.ai-agent-btn {
  padding: 1px 7px; background: rgba(28,28,28,0.06); border: 1px solid #eceae4;
  border-radius: 4px; font-size: 10px; font-family: inherit; color: #5f5f5d; cursor: pointer; flex-shrink: 0;
}
.ai-agent-btn:hover { background: rgba(28,28,28,0.12); }
.ai-agent-btn.stop { background: rgba(255,95,86,0.1); border-color: rgba(255,95,86,0.2); color: #c00; }
.ai-messages { flex: 1; overflow-y: auto; padding: 12px 16px 12px 16px; }
.ai-welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; }
.ai-welcome-icon { opacity: 0.2; }
.ai-welcome-text { font-size: 15px; font-weight: 600; color: #1c1c1c; }
.ai-welcome-hint { font-size: 12px; color: #8a8a88; }
.ai-welcome-commands { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; justify-content: center; max-width: 320px; }
.ai-welcome-cmd { display: flex; flex-direction: column; align-items: flex-start; padding: 8px 10px; background: rgba(28,28,28,0.03); border: 1px solid #eceae4; border-radius: 8px; cursor: pointer; transition: all 0.15s; text-align: left; gap: 2px; min-width: 100px; }
.ai-welcome-cmd:hover { background: rgba(28,28,28,0.06); border-color: rgba(28,28,28,0.2); }
.ai-welcome-cmd-name { font-size: 12px; font-weight: 600; font-family: 'SF Mono', monospace; color: #1c1c1c; }
.ai-welcome-cmd-desc { font-size: 10px; color: #8a8a88; }
.ai-msg { margin-bottom: 12px; }
.ai-msg.user { display: flex; flex-direction: column; align-items: flex-end; }
.ai-msg.user .ai-msg-content { background: #1c1c1c; color: #fcfbf8; border-radius: 12px 12px 4px 12px; padding: 8px 12px; display: inline-block; max-width: 85%; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.ai-slash-badge { display: inline-flex; align-self: flex-end; padding: 1px 7px; background: rgba(28,28,28,0.06); border: 1px solid #eceae4; border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: 600; color: #5f5f5d; margin-bottom: 4px; }
.ai-msg-images { margin-top: 4px; }
.ai-attached-img { max-width: 200px; max-height: 150px; border-radius: 8px; border: 1px solid #eceae4; }
.ai-msg.assistant .ai-msg-content { padding: 4px 0; font-size: 13px; line-height: 1.6; color: #1c1c1c; word-break: break-word; }
.ai-tool-calls { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
.ai-tool-call { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(28,28,28,0.04); border-radius: 4px; font-size: 11px; border-left: 2px solid #5f5f5d; }
.ai-tool-call.running { border-left-color: #3b82f6; background: rgba(59,130,246,0.06); }
.ai-tool-call-icon.spinning { display: inline-block; animation: ai-spin 1s linear infinite; }
@keyframes ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.ai-msg-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; margin-top: 4px; }
.ai-msg:hover .ai-msg-actions { opacity: 1; }
.ai-msg-action-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: transparent; border: 1px solid #eceae4; border-radius: 4px; color: #8a8a88; cursor: pointer; transition: all 0.15s; }
.ai-msg-action-btn:hover { background: rgba(28,28,28,0.06); color: #1c1c1c; border-color: rgba(28,28,28,0.2); }
.ai-msg-action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.ai-edit-block { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.ai-edit-textarea { width: 100%; padding: 8px 10px; background: #f7f4ed; border: 1px solid rgba(28,28,28,0.4); border-radius: 8px; font-size: 13px; font-family: inherit; color: #1c1c1c; outline: none; resize: vertical; min-height: 48px; }
.ai-edit-btn { padding: 4px 12px; border-radius: 6px; font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; border: none; }
.ai-edit-btn.cancel { background: rgba(28,28,28,0.06); color: #5f5f5d; }
.ai-edit-btn.save { background: #1c1c1c; color: #fcfbf8; }
.ai-thinking { display: inline-flex; align-items: center; gap: 4px; padding: 8px 0; }
.ai-dot { width: 6px; height: 6px; border-radius: 50%; background: #8a8a88; animation: ai-bounce 1.4s ease-in-out infinite; }
.ai-dot:nth-child(2) { animation-delay: 0.2s; }
.ai-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
.mk-body :deep(.mk-code-block) { position: relative; background: rgba(28,28,28,0.05); border: 1px solid #eceae4; border-radius: 8px; padding: 8px 10px; margin: 8px 0; overflow-x: auto; font-family: 'SF Mono', monospace; font-size: 12px; }
.mk-body :deep(.mk-inline-code) { background: rgba(28,28,28,0.05); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 12px; }
.mk-body :deep(h1),.mk-body :deep(h2),.mk-body :deep(h3) { font-weight: 600; margin: 10px 0 6px; }
.mk-body :deep(h1) { font-size: 18px; }
.mk-body :deep(h2) { font-size: 16px; }
.mk-body :deep(h3) { font-size: 14px; }
.mk-body :deep(strong) { font-weight: 600; }
.mk-body :deep(.mk-link) { color: #3b82f6; text-decoration: underline; }
.mk-body :deep(.mk-blockquote) { border-left: 3px solid #eceae4; padding-left: 12px; margin: 8px 0; color: #5f5f5d; font-style: italic; }
.ai-side-panel { width: 50%; min-width: 200px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid #eceae4; overflow-y: auto; background: rgba(28,28,28,0.01); }
.ai-translation-header, .ai-summary-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #eceae4; flex-shrink: 0; }
.ai-translation-title, .ai-summary-title { font-size: 12px; font-weight: 600; color: #1c1c1c; }
.ai-translation-close, .ai-summary-close { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: transparent; border: none; border-radius: 4px; font-size: 16px; color: #5f5f5d; cursor: pointer; }
.ai-translation-body, .ai-summary-body { flex: 1; overflow-y: auto; padding: 10px; }
.ai-translation-para-pair { margin-bottom: 16px; border-bottom: 1px solid rgba(28,28,28,0.04); padding-bottom: 12px; }
.ai-translation-label { font-size: 9px; font-weight: 600; color: #8a8a88; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.ai-translation-original p, .ai-translation-translated p { font-size: 12px; line-height: 1.6; margin: 0; }
.ai-translation-original p { color: #5f5f5d; }
.ai-translation-translated p { color: #1c1c1c; }
.ai-summary-page-title { font-size: 14px; font-weight: 600; color: #1c1c1c; margin-bottom: 2px; }
.ai-summary-page-url { font-size: 10px; color: #8a8a88; word-break: break-all; }
.ai-summary-empty { padding: 20px 0; text-align: center; font-size: 12px; color: #8a8a88; }
</style>
