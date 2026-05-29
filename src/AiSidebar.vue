<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAiConfig } from './composables/useAiConfig'
import { useAiChat } from './composables/useAiChat'
import { useSlashCommands } from './composables/useSlashCommands'
import { useAgentLoop } from './composables/useAgentLoop'
import { useContextManager } from './composables/useContextManager'
import { useProactiveAI } from './composables/useProactiveAI'
import { renderMarkdown } from './composables/useMarkdown'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import mermaid from 'mermaid'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('css', css)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
import { t } from './composables/useI18n'
import { formatError } from './composables/useErrorFormat'
import ChatInput from './ChatInput.vue'

const props = defineProps({ embedded: Boolean })

const { config, providers, getProvider, getEffectiveModel, getEffectiveBaseUrl, getApiFormat } = useAiConfig()
const { conversations, activeConvId, isStreaming, streamError, pendingToolCalls, toolConfirmRequired, agentState, getActiveConversation, createConversation, deleteConversation, sendMessage, stopStreaming, skipCurrentTool, interruptAgent, confirmToolCall, editMessage, regenerateResponse, branchConversation, exportAsMarkdown, exportAsHtml } = useAiChat()
const { getFilteredCommands, matchCommand, getAllCommands, getCommandsByCategory } = useSlashCommands()
const { activePlan, getPlanSummary } = useAgentLoop()
const { contextStats } = useContextManager()
const { pageHints, analyzePage, addSmartBookmark } = useProactiveAI()

const activeConv = getActiveConversation()
const messagesEl = ref(null)
const showConvList = ref(false)
const pageMeta = ref(null)
const pageContent = ref(null)
const editingMsgIdx = ref(-1)
const editingMsgContent = ref('')
const showSummaryPanel = ref(false)
const showFormTemplates = ref(false)
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

/* ── Multimodal rendering ── */
async function renderMultimodal() {
  await nextTick()
  if (!messagesEl.value) return
  // Syntax highlighting for code blocks
  messagesEl.value.querySelectorAll('pre code:not(.hljs)').forEach(el => {
    try { hljs.highlightElement(el) } catch(e) {}
  })
  // Mermaid diagrams
  const mermaidEls = messagesEl.value.querySelectorAll('.mk-mermaid:not([data-processed])')
  if (mermaidEls.length > 0) {
    try {
      await mermaid.run({ nodes: mermaidEls })
      mermaidEls.forEach(el => el.setAttribute('data-processed', 'true'))
    } catch(e) {
      mermaidEls.forEach(el => {
        if (!el.getAttribute('data-processed')) {
          el.setAttribute('data-processed', 'true')
          const pre = document.createElement('pre')
          pre.className = 'mk-code-block'
          pre.textContent = el.textContent
          el.replaceWith(pre)
        }
      })
    }
  }
}
watch(() => activeConv.value?.messages?.length, () => { nextTick(scrollToBottom); renderMultimodal() })

/* ── Conversation ── */
function newChat() { createConversation(); showConvList.value = false }
function switchConv(id) { activeConvId.value = id; showConvList.value = false; nextTick(renderMultimodal) }



/* ── Slash ── */
function insertSlashCommand(cmdName) {
  showConvList.value = false
}

/* ── Export ── */
function downloadExport(fmt, convId) {
  const id = convId || activeConvId.value
  const conv = conversations.value.find(c => c.id === id)
  if (!conv) return
  const content = fmt === 'md' ? exportAsMarkdown(id) : exportAsHtml(id)
  const blob = new Blob([content], { type: fmt === 'md' ? 'text/markdown' : 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeTitle = (conv.title || 'chat').replace(/[^\w\u4e00-\u9fff]/g, '_').substring(0, 40)
  a.download = `dawn-${safeTitle}.${fmt === 'md' ? 'md' : 'html'}`
  a.click()
  URL.revokeObjectURL(url)
  showExportMenu.value = false
  convContextMenu.value = null
}

function onConvContextMenu(e, conv) {
  e.preventDefault()
  convContextMenu.value = { id: conv.id, x: e.clientX, y: e.clientY }
}

function closeConvContextMenu() { convContextMenu.value = null }

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
  fetchPageMeta(); fetchPageContent()
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
        <div style="position:relative;">
          <button class="ai-icon-btn" @click="showExportMenu = !showExportMenu" :title="t('ai.export')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <div v-if="showExportMenu" class="ai-ctx-menu" style="position:absolute;right:0;top:100%;z-index:100;" @click.stop>
            <div class="ai-ctx-item" @click="downloadExport('md')">{{ t('ai.exportMd') || 'Export MD' }}</div>
            <div class="ai-ctx-item" @click="downloadExport('html')">{{ t('ai.exportHtml') || 'Export HTML' }}</div>
          </div>
        </div>
        <button class="ai-icon-btn" @click="newChat" :title="t('ai.newChat')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button class="ai-icon-btn" @click="window.electronAPI?.createTab('dawn://settings')" :title="t('ai.settings')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </div>
    </div>

    <div v-if="pageMeta && pageMeta.url && pageMeta.url !== 'dawn://newtab'" class="ai-page-bar">
      <img v-if="pageMeta.favicon" :src="pageMeta.favicon" class="ai-favicon" />
      <div class="ai-page-info"><span class="ai-page-title">{{ pageMeta.title || 'Untitled' }}</span><span class="ai-page-url">{{ pageMeta.url }}</span></div>
    </div>

    <div v-if="showConvList" class="ai-conv-list">
      <div class="ai-conv-item" v-for="conv in conversations" :key="conv.id" :class="{ active: conv.id === activeConvId }" @click="switchConv(conv.id)" @contextmenu="onConvContextMenu($event, conv)">
        <span class="ai-conv-title">{{ conv.title }}</span>
        <span class="ai-conv-time">{{ new Date(conv.createdAt).toLocaleDateString() }}</span>
        <button class="ai-conv-del" @click.stop="deleteConversation(conv.id)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div v-if="conversations.length === 0" class="ai-empty">{{ t('conv.empty') }}</div>
    </div>
    <!-- Conversation context menu -->
    <div v-if="convContextMenu" class="ai-ctx-menu" :style="{ position:'fixed', left: convContextMenu.x+'px', top: convContextMenu.y+'px', zIndex:200 }" @click.stop>
      <div class="ai-ctx-item" @click="downloadExport('md', convContextMenu.id); closeConvContextMenu()">{{ t('ai.exportMd') || 'Export MD' }}</div>
      <div class="ai-ctx-item" @click="downloadExport('html', convContextMenu.id); closeConvContextMenu()">{{ t('ai.exportHtml') || 'Export HTML' }}</div>
      <div class="ai-ctx-item ai-ctx-danger" @click="deleteConversation(convContextMenu.id); closeConvContextMenu()">{{ t('ai.deleteConv') || 'Delete' }}</div>
    </div>
    <div v-if="convContextMenu || showExportMenu" style="position:fixed;inset:0;z-index:199;" @click="closeConvContextMenu(); showExportMenu=false"></div>


    <div v-if="!showConvList" class="ai-chat" :class="{ 'ai-chat-panels': showSummaryPanel || showTranslation }">
      <!-- Agent status bar -->
      <div v-if="agentState !== 'idle'" class="ai-agent-bar" :class="agentState">
        <span class="ai-agent-dot"></span>
        <span v-if="agentState === 'thinking'">{{ t('agent.thinking') }}</span>
        <span v-else-if="agentState === 'executing'">{{ t('agent.executing') }}</span>
        <span v-if="pendingToolCalls.length > 0" class="ai-agent-tool-name">{{ pendingToolCalls.map(tc => tc.name).join(', ') }}</span>
        <button v-if="agentState === 'executing'" class="ai-agent-btn" @click="skipCurrentTool" :title="t('ai.skipTool')">{{ t('agent.skip') }}</button>
        <button class="ai-agent-btn stop" @click="interruptAgent" :title="t('ai.stop')">{{ t('agent.stop') }}</button>
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
            <details v-if="msg.reasoning_content" class="ai-reasoning">
              <summary class="ai-reasoning-toggle">{{ t('reasoning.label') }}</summary>
              <div class="ai-reasoning-body">{{ msg.reasoning_content }}</div>
            </details>
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
.ai-sidebar { display: flex; flex-direction: column; height: 100%; background: var(--color-bg); font-family: inherit; }
.ai-sidebar.embedded { border-left: none; }
.ai-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; height: 42px; }
.ai-header-left, .ai-header-right { display: flex; align-items: center; gap: 4px; }
.ai-title { font-size: 13px; font-weight: 600; color: var(--color-text); margin-left: 4px; }
.ai-icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: none; border-radius: 6px; color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s; }
.ai-icon-btn:hover { background: var(--color-bg-hover); color: var(--color-text); }
.ai-icon-btn.active { background: var(--color-bg-active); color: var(--color-text); }
.ai-page-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-hover); flex-shrink: 0; }
.ai-favicon { width: 16px; height: 16px; border-radius: 2px; flex-shrink: 0; }
.ai-page-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ai-page-title { font-size: 11px; font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-page-url { font-size: 10px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-conv-list { flex: 1; overflow-y: auto; padding: 6px; }
.ai-conv-item { display: flex; align-items: center; padding: 8px 10px; border-radius: 6px; cursor: pointer; transition: all 0.15s; margin-bottom: 2px; gap: 8px; }
.ai-conv-item:hover { background: var(--color-bg-hover); }
.ai-conv-item.active { background: var(--color-bg-hover); }
.ai-conv-title { flex: 1; font-size: 13px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-conv-time { font-size: 10px; color: var(--color-text-muted); flex-shrink: 0; }
.ai-conv-del { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: transparent; border: none; border-radius: 4px; color: var(--color-text-muted); cursor: pointer; opacity: 0; transition: all 0.15s; }
.ai-conv-item:hover .ai-conv-del { opacity: 1; }
.ai-conv-del:hover { background: var(--color-bg-active); color: var(--color-text); }
.ai-empty { padding: 20px; text-align: center; color: var(--color-text-muted); font-size: 13px; }
.ai-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.ai-agent-bar {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  background: var(--color-accent-bg); border-bottom: 1px solid var(--color-accent-hover);
  font-size: 11px; color: var(--color-accent); flex-shrink: 0; user-select: none;
}
.ai-agent-bar.executing { background: var(--color-accent-hover); }
.ai-agent-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent);
  animation: ai-bounce 1.4s ease-in-out infinite;
}
.ai-agent-tool-name {
  font-family: 'SF Mono', monospace; font-size: 10px; color: var(--color-text);
  margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;
}
.ai-agent-btn {
  padding: 1px 7px; background: var(--color-bg-hover); border: 1px solid var(--color-border);
  border-radius: 4px; font-size: 10px; font-family: inherit; color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0;
}
.ai-agent-btn:hover { background: var(--color-bg-active); }
.ai-agent-btn.stop { background: var(--color-error-bg); border-color: var(--color-error-border); color: var(--color-error); }
.ai-messages { flex: 1; overflow-y: auto; padding: 12px 16px 12px 16px; }
.ai-welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; }
.ai-welcome-icon { opacity: 0.2; }
.ai-welcome-text { font-size: 15px; font-weight: 600; color: var(--color-text); }
.ai-welcome-hint { font-size: 12px; color: var(--color-text-muted); }
.ai-welcome-commands { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; justify-content: center; max-width: 320px; }
.ai-welcome-cmd { display: flex; flex-direction: column; align-items: flex-start; padding: 8px 10px; background: var(--color-shadow-sm); border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; transition: all 0.15s; text-align: left; gap: 2px; min-width: 100px; }
.ai-welcome-cmd:hover { background: var(--color-bg-hover); border-color: rgba(28,28,28,0.2); }
.ai-welcome-cmd-name { font-size: 12px; font-weight: 600; font-family: 'SF Mono', monospace; color: var(--color-text); }
.ai-welcome-cmd-desc { font-size: 10px; color: var(--color-text-muted); }
.ai-msg { margin-bottom: 12px; }
.ai-msg.user { display: flex; flex-direction: column; align-items: flex-end; }
.ai-msg.user .ai-msg-content { background: var(--color-user-bubble); color: var(--color-user-text); border-radius: 12px 12px 4px 12px; padding: 8px 12px; display: inline-block; max-width: 85%; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.ai-slash-badge { display: inline-flex; align-self: flex-end; padding: 1px 7px; background: var(--color-bg-hover); border: 1px solid var(--color-border); border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 4px; }
.ai-msg-images { margin-top: 4px; }
.ai-attached-img { max-width: 200px; max-height: 150px; border-radius: 8px; border: 1px solid var(--color-border); }
.ai-msg.assistant .ai-msg-content { padding: 4px 0; font-size: 13px; line-height: 1.6; color: var(--color-text); word-break: break-word; }
.ai-tool-calls { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
.ai-tool-call { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--color-bg-hover); border-radius: 4px; font-size: 11px; border-left: 2px solid var(--color-text-secondary); }
.ai-tool-call.running { border-left-color: var(--color-accent); background: var(--color-accent-bg); }
.ai-tool-call-icon.spinning { display: inline-block; animation: ai-spin 1s linear infinite; }
@keyframes ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.ai-msg-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; margin-top: 4px; }
.ai-msg:hover .ai-msg-actions { opacity: 1; }
.ai-msg-action-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: transparent; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-muted); cursor: pointer; transition: all 0.15s; }
.ai-msg-action-btn:hover { background: var(--color-bg-hover); color: var(--color-text); border-color: rgba(28,28,28,0.2); }
.ai-msg-action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.ai-edit-block { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.ai-edit-textarea { width: 100%; padding: 8px 10px; background: var(--color-bg); border: 1px solid var(--color-border-interactive); border-radius: 8px; font-size: 13px; font-family: inherit; color: var(--color-text); outline: none; resize: vertical; min-height: 48px; }
.ai-edit-btn { padding: 4px 12px; border-radius: 6px; font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; border: none; }
.ai-edit-btn.cancel { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.ai-edit-btn.save { background: var(--color-user-bubble); color: var(--color-user-text); }
.ai-reasoning { margin-bottom: 4px; }
.ai-reasoning-toggle { font-size: 10px; color: var(--color-text-muted); cursor: pointer; user-select: none; }
.ai-reasoning-toggle:hover { color: var(--color-text-secondary); }
.ai-reasoning-body { font-size: 11px; color: var(--color-text-secondary); line-height: 1.5; padding: 6px 8px; background: var(--color-shadow-sm); border-radius: 4px; margin-top: 2px; white-space: pre-wrap; }
.ai-thinking { display: inline-flex; align-items: center; gap: 4px; padding: 8px 0; }
.ai-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-muted); animation: ai-bounce 1.4s ease-in-out infinite; }
.ai-dot:nth-child(2) { animation-delay: 0.2s; }
.ai-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
.mk-body :deep(.mk-code-block) { position: relative; background: var(--color-bg-hover); border: 1px solid var(--color-border); border-radius: 8px; padding: 8px 10px; margin: 8px 0; overflow-x: auto; font-family: 'SF Mono', monospace; font-size: 12px; }
.mk-body :deep(.mk-inline-code) { background: var(--color-bg-hover); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 12px; }
.mk-body :deep(h1),.mk-body :deep(h2),.mk-body :deep(h3) { font-weight: 600; margin: 10px 0 6px; }
.mk-body :deep(h1) { font-size: 18px; }
.mk-body :deep(h2) { font-size: 16px; }
.mk-body :deep(h3) { font-size: 14px; }
.mk-body :deep(strong) { font-weight: 600; }
.mk-body :deep(.mk-link) { color: var(--color-accent); text-decoration: underline; }
.mk-body :deep(.mk-blockquote) { border-left: 3px solid var(--color-border); padding-left: 12px; margin: 8px 0; color: var(--color-text-secondary); font-style: italic; }

.mk-body :deep(.mk-table) { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
.mk-body :deep(.mk-table th),
.mk-body :deep(.mk-table td) { border: 1px solid var(--color-border); padding: 6px 10px; text-align: left; }
.mk-body :deep(.mk-table th) { background: var(--color-bg-hover); font-weight: 600; }
.mk-body :deep(.mk-table tr:hover) { background: var(--color-bg-hover); }
.mk-body :deep(.mk-ul),.mk-body :deep(.mk-ol) { margin: 4px 0; padding-left: 20px; }
.mk-body :deep(.mk-li),.mk-body :deep(.mk-li-ol) { margin: 2px 0; }
.mk-body :deep(.mk-hr) { border: none; border-top: 1px solid var(--color-border); margin: 12px 0; }
.ai-side-panel { width: 50%; min-width: 200px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--color-border); overflow-y: auto; background: var(--color-bg-hover); }
.ai-translation-header, .ai-summary-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.ai-translation-title, .ai-summary-title { font-size: 12px; font-weight: 600; color: var(--color-text); }
.ai-translation-close, .ai-summary-close { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: transparent; border: none; border-radius: 4px; font-size: 16px; color: var(--color-text-secondary); cursor: pointer; }
.ai-translation-body, .ai-summary-body { flex: 1; overflow-y: auto; padding: 10px; }
.ai-translation-para-pair { margin-bottom: 16px; border-bottom: 1px solid var(--color-bg-hover); padding-bottom: 12px; }
.ai-translation-label { font-size: 9px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.ai-translation-original p, .ai-translation-translated p { font-size: 12px; line-height: 1.6; margin: 0; }
.ai-translation-original p { color: var(--color-text-secondary); }
.ai-translation-translated p { color: var(--color-text); }
.ai-summary-page-title { font-size: 14px; font-weight: 600; color: var(--color-text); margin-bottom: 2px; }
.ai-summary-page-url { font-size: 10px; color: var(--color-text-muted); word-break: break-all; }
.ai-summary-empty { padding: 20px 0; text-align: center; font-size: 12px; color: var(--color-text-muted); }

/* Context menu */
.ai-ctx-menu { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 8px; padding: 4px; box-shadow: var(--color-shadow) 0 4px 16px; min-width: 140px; }
.ai-ctx-item { padding: 6px 12px; font-size: 12px; color: var(--color-text); cursor: pointer; border-radius: 5px; }
.ai-ctx-item:hover { background: var(--color-bg-hover); }
.ai-ctx-danger { color: var(--color-error); }</style>