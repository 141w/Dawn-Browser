<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import ChatInput from './ChatInput.vue'
import { useAiChat } from './composables/useAiChat'
import { useAgentLoop } from './composables/useAgentLoop'
import { renderMarkdown } from './composables/useMarkdown'
import { formatError } from './composables/useErrorFormat'
import { t } from './composables/useI18n'

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
const {
  conversations, activeConvId, isStreaming, streamError, agentState, pendingToolCalls,
  toolConfirmRequired, agentMode,
  getActiveConversation, createConversation, deleteConversation,
  sendMessage, stopStreaming, skipCurrentTool, interruptAgent, confirmToolCall
} = useAiChat()

const { activePlan } = useAgentLoop()

const activeConv = getActiveConversation()
const messagesEl = ref(null)
const showConvList = ref(false)

// Auto-select first conversation if none active, but don't auto-create
if (!activeConvId.value && conversations.value.length > 0) {
  activeConvId.value = conversations.value[0].id
}

const hasMessages = computed(() => activeConv.value && activeConv.value.messages.length > 0)

function scrollToBottom() { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }
watch(() => activeConv.value?.messages?.length, () => { nextTick(scrollToBottom); renderMultimodal() })

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

function newChat() { createConversation(); showConvList.value = false }
function switchConv(id) { activeConvId.value = id; showConvList.value = false; nextTick(renderMultimodal) }

function handleSend(finalMsg, slashCmd, displayMsg) {
  try {
    if (!finalMsg || !finalMsg.trim()) return
    if (!activeConvId.value) createConversation()
    sendMessage(finalMsg, null, null, slashCmd, displayMsg)
    nextTick(scrollToBottom)
  } catch(e) {
    streamError.value = e.message
  }
}
</script>

<template>
  <div class="ha-root" :class="{ chatting: hasMessages }">
    <!-- Header: always visible -->
    <div class="ha-header">
      <div class="ha-header-left">
        <button class="ha-icon-btn" @click="showConvList = !showConvList" :class="{ active: showConvList }" title="历史对话">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </button>
        <span class="ha-title-sm">{{ activeConv?.title || t('ai.title') }}</span>
      </div>
      <button class="ha-icon-btn" @click="newChat" :title="t('ai.newChat')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>

    <!-- Conversation list -->
    <div v-if="showConvList" class="ha-conv-list">
      <div v-for="conv in conversations" :key="conv.id" class="ha-conv-item" :class="{ active: conv.id === activeConvId }" @click="switchConv(conv.id)">
        <span class="ha-conv-title">{{ conv.title }}</span>
        <span class="ha-conv-time">{{ new Date(conv.createdAt).toLocaleDateString() }}</span>
        <button class="ha-conv-del" @click.stop="deleteConversation(conv.id)">×</button>
      </div>
      <div v-if="conversations.length === 0" class="ha-empty">{{ t('conv.empty') }}</div>
    </div>

    <!-- Agent status bar -->
    <div v-if="agentState !== 'idle'" class="ha-agent-bar" :class="agentState">
      <span class="ha-agent-dot"></span>
      <span v-if="agentState === 'thinking'">{{ t('agent.thinking') }}</span>
      <span v-else-if="agentState === 'executing'">{{ t('agent.executing') }}</span>
      <span v-if="pendingToolCalls.length > 0" class="ha-agent-tool-name">{{ pendingToolCalls.map(tc => tc.name).join(', ') }}</span>
      <button v-if="agentState === 'executing'" class="ha-agent-btn" @click="skipCurrentTool">{{ t('agent.skip') }}</button>
      <button class="ha-agent-btn stop" @click="interruptAgent">{{ t('agent.stop') }}</button>
    </div>

    <!-- MODE 1: Centered welcome + input -->
    <div v-if="!hasMessages && agentState === 'idle'" class="ha-centered">
      <div class="ha-logo">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"><path d="M12 2a10 10 0 0110 10 10 10 0 01-10 10A10 10 0 012 12 10 10 0 0112 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      </div>
      <h1 class="ha-title">{{ t('ai.welcome') }}</h1>
      <ChatInput :isStreaming="isStreaming" @send="handleSend" @stop="stopStreaming" @clear="newChat()" />
    </div>

    <!-- MODE 2: Messages + input at bottom -->
    <template v-else>
      <div class="ha-messages" ref="messagesEl">
        <div v-for="(msg,i) in activeConv?.messages" :key="i" class="ha-msg" :class="msg.role">
          <!-- User message -->
          <div v-if="msg.role==='user'" class="ha-bubble user">
            <span v-if="msg.slashCmd" class="ha-slash-badge">{{ msg.slashCmd.label }}</span>
            {{ msg.content }}
          </div>

          <!-- Assistant message -->
          <div v-else-if="msg.role==='assistant'" class="ha-msg-asst">
            <!-- Tool calls -->
            <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="ha-tool-calls">
              <div v-for="tc in msg.toolCalls" :key="tc.id" class="ha-tool-call">
                <span class="ha-tool-icon">⚙</span>
                <span class="ha-tool-name">{{ tc.name }}</span>
                <span class="ha-tool-args">{{ typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments).slice(0, 80) }}</span>
              </div>
            </div>
            <details v-if="msg.reasoning_content" class="ha-reasoning">
              <summary class="ha-reasoning-toggle">{{ t('reasoning.label') }}</summary>
              <div class="ha-reasoning-body">{{ msg.reasoning_content }}</div>
            </details>
            <div v-if="msg.content" class="ha-bubble asst" v-html="renderMarkdown(msg.content)"></div>
          </div>

          <!-- Tool result -->
          <div v-else-if="msg.role==='tool'" class="ha-tool-result">
            <span class="ha-tool-result-label">{{ msg.name }}</span>
            <span class="ha-tool-result-text">{{ msg.content?.substring(0, 300) }}{{ msg.content?.length > 300 ? '...' : '' }}</span>
          </div>
        </div>

        <!-- Streaming indicators -->
        <div v-if="isStreaming">
          <div v-if="pendingToolCalls.length > 0" class="ha-pending-tools">
            <div v-for="tc in pendingToolCalls" :key="tc.id" class="ha-tool-call running">
              <span class="ha-tool-icon spinning">⚙</span>
              <span class="ha-tool-name">{{ tc.name }}</span>
              <span class="ha-tool-status">executing...</span>
            </div>
          </div>
          <div v-else-if="!activeConv?.messages[activeConv.messages.length-1]?.content && !activeConv?.messages[activeConv.messages.length-1]?.toolCalls?.length" class="ha-thinking">
            <span class="ha-dot"></span><span class="ha-dot"></span><span class="ha-dot"></span>
          </div>
        </div>

        <!-- Tool confirm dialog -->
        <div v-if="toolConfirmRequired" class="ha-tool-confirm">
          <p>{{ t('tool.confirm') }} <strong>{{ toolConfirmRequired.toolName }}</strong>?</p>
          <code>{{ JSON.stringify(toolConfirmRequired.toolArgs).slice(0, 100) }}</code>
          <div class="ha-tool-confirm-actions">
            <button class="ha-confirm-deny" @click="confirmToolCall(false)">{{ t('tool.confirm.deny') }}</button>
            <button class="ha-confirm-allow" @click="confirmToolCall(true)">{{ t('tool.confirm.allow') }}</button>
          </div>
        </div>

        <div v-if="streamError" class="ha-error">{{ formatError(streamError) }}</div>
      </div>
      <div class="ha-input-bottom">
        <ChatInput :isStreaming="isStreaming" @send="handleSend" @stop="stopStreaming" @clear="newChat()" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ha-root { display: flex; flex-direction: column; height: 100%; background: var(--color-bg); }

/* Header */
.ha-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.ha-header-left { display: flex; align-items: center; gap: 8px; }
.ha-title-sm { font-size: 13px; font-weight: 600; color: var(--color-text); }
.ha-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: transparent; border: none;
  border-radius: 6px; color: var(--color-text-secondary); cursor: pointer; transition: all .15s;
}
.ha-icon-btn:hover { background: var(--color-bg-hover); color: var(--color-text); }
.ha-icon-btn.active { background: var(--color-bg-active); color: var(--color-text); }

/* Conversation list */
.ha-conv-list { padding: 6px; border-bottom: 1px solid var(--color-border); }
.ha-conv-item {
  display: flex; align-items: center; padding: 8px 10px; border-radius: 6px;
  cursor: pointer; transition: all .15s; margin-bottom: 2px; gap: 8px;
}
.ha-conv-item:hover { background: var(--color-bg-hover); }
.ha-conv-item.active { background: var(--color-bg-hover); }
.ha-conv-title { flex: 1; font-size: 13px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ha-conv-time { font-size: 10px; color: var(--color-text-muted); flex-shrink: 0; }
.ha-conv-del {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; background: transparent; border: none;
  border-radius: 4px; color: var(--color-text-muted); cursor: pointer; font-size: 14px; opacity: 0; transition: all .15s;
}
.ha-conv-item:hover .ha-conv-del { opacity: 1; }
.ha-conv-del:hover { background: var(--color-bg-active); color: var(--color-text); }
.ha-empty { padding: 20px; text-align: center; color: var(--color-text-muted); font-size: 13px; }

/* Agent bar */
.ha-agent-bar {
  display: flex; align-items: center; gap: 6px; padding: 5px 12px;
  background: var(--color-accent-bg); border-bottom: 1px solid var(--color-accent-hover);
  font-size: 11px; color: var(--color-accent); flex-shrink: 0; user-select: none;
}
.ha-agent-bar.executing { background: var(--color-accent-hover); }
.ha-agent-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent);
  animation: ha-bounce 1.4s ease-in-out infinite;
}
.ha-agent-tool-name {
  font-family: 'SF Mono', monospace; font-size: 10px; color: var(--color-text);
  margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;
}
.ha-agent-btn {
  padding: 1px 7px; background: var(--color-bg-hover); border: 1px solid var(--color-border);
  border-radius: 4px; font-size: 10px; font-family: inherit; color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0;
}
.ha-agent-btn:hover { background: var(--color-bg-active); }
.ha-agent-btn.stop { background: var(--color-error-bg); border-color: var(--color-error-border); color: var(--color-error); }

/* Centered */
.ha-centered {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; padding: 40px 20px;
}
.ha-title { font-size: 22px; font-weight: 600; color: var(--color-text); letter-spacing: -.3px; }

/* Messages mode */
.ha-messages { flex: 1; overflow-y: auto; padding: 20px 24px; }
.ha-msg { margin-bottom: 16px; display: flex; flex-direction: column; }
.ha-msg.user { align-items: flex-end; }
.ha-bubble { max-width: 75%; padding: 10px 15px; border-radius: 16px; font-size: 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.ha-bubble.user { background: var(--color-user-bubble); color: var(--color-user-text); border-bottom-right-radius: 6px; }
.ha-slash-badge { display: inline-flex; align-self: flex-start; padding: 1px 7px; background: rgba(255,255,255,0.15); border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: 600; color: rgba(255,255,255,.7); }
.ha-bubble.asst { background: var(--color-bg-elevated); color: var(--color-text); border: 1px solid var(--color-border); border-bottom-left-radius: 6px; box-shadow: var(--color-shadow-sm) 0 1px 6px; }
.ha-bubble.asst :deep(p) { margin: 0 0 6px; }
.ha-bubble.asst :deep(p:last-child) { margin: 0; }
.ha-bubble.asst :deep(code) { background: var(--color-bg-hover); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 12px; }
.ha-bubble.asst :deep(pre) { background: var(--color-bg-hover); padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 6px 0; }

.ha-bubble.asst :deep(.mk-table) { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
.ha-bubble.asst :deep(.mk-table th),
.ha-bubble.asst :deep(.mk-table td) { border: 1px solid var(--color-border); padding: 6px 10px; text-align: left; }
.ha-bubble.asst :deep(.mk-table th) { background: var(--color-bg-hover); font-weight: 600; }
.ha-bubble.asst :deep(.mk-table tr:hover) { background: var(--color-bg-hover); }
.ha-bubble.asst :deep(h1),.ha-bubble.asst :deep(h2),.ha-bubble.asst :deep(h3) { font-weight: 600; margin: 10px 0 6px; }
.ha-bubble.asst :deep(h1) { font-size: 18px; }
.ha-bubble.asst :deep(h2) { font-size: 16px; }
.ha-bubble.asst :deep(h3) { font-size: 14px; }
.ha-bubble.asst :deep(strong) { font-weight: 600; }
.ha-bubble.asst :deep(.mk-link) { color: var(--color-accent); text-decoration: underline; }
.ha-bubble.asst :deep(.mk-blockquote) { border-left: 3px solid var(--color-border); padding-left: 12px; margin: 8px 0; color: var(--color-text-secondary); font-style: italic; }
.ha-bubble.asst :deep(.mk-ul),.ha-bubble.asst :deep(.mk-ol) { margin: 4px 0; padding-left: 20px; }
.ha-bubble.asst :deep(.mk-li),.ha-bubble.asst :deep(.mk-li-ol) { margin: 2px 0; }
.ha-bubble.asst :deep(.mk-hr) { border: none; border-top: 1px solid var(--color-border); margin: 12px 0; }

/* Tool calls */
.ha-msg-asst { display: flex; flex-direction: column; max-width: 85%; }
.ha-tool-calls { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
.ha-tool-call {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  background: var(--color-bg-hover); border-radius: 4px; font-size: 11px;
  border-left: 2px solid var(--color-text-secondary);
}
.ha-tool-call.running { border-left-color: var(--color-accent); background: var(--color-accent-bg); }
.ha-tool-icon.spinning { display: inline-block; animation: ha-spin 1s linear infinite; }
@keyframes ha-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.ha-tool-name { font-family: monospace; font-size: 10px; font-weight: 600; color: var(--color-text); }
.ha-tool-args { font-size: 10px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.ha-tool-status { font-size: 10px; color: var(--color-text-muted); }

/* Tool result */
.ha-tool-result {
  display: flex; gap: 8px; padding: 4px 8px; font-size: 10px;
  background: var(--color-bg-hover); border-radius: 4px; border-left: 2px solid var(--color-border);
}
.ha-tool-result-label { font-family: monospace; font-weight: 600; color: var(--color-text-secondary); flex-shrink: 0; }
.ha-tool-result-text { color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Pending tools */
.ha-pending-tools { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }

/* Thinking */
.ha-thinking { display: flex; gap: 5px; padding: 12px 15px; }
.ha-dot { width: 6px; height: 6px; border-radius: 50%; background: #c0c0c0; animation: ha-bounce 1.4s infinite; }
.ha-dot:nth-child(2) { animation-delay: .2s; }
.ha-dot:nth-child(3) { animation-delay: .4s; }
@keyframes ha-bounce { 0%,80%,100%{transform:scale(.6);opacity:.4} 40%{transform:scale(1);opacity:1} }
.ha-reasoning { margin-bottom: 6px; }
.ha-reasoning-toggle { font-size: 11px; color: var(--color-text-muted); cursor: pointer; user-select: none; padding: 2px 0; }
.ha-reasoning-toggle:hover { color: var(--color-text-secondary); }
.ha-reasoning-body { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; padding: 8px 10px; background: var(--color-shadow-sm); border-radius: 6px; margin-top: 4px; white-space: pre-wrap; }
.ha-error { padding: 8px 12px; background: var(--color-error-bg); border: 1px solid var(--color-error-border); border-radius: 8px; font-size: 12px; color: var(--color-error); }

/* Tool confirm */
.ha-tool-confirm {
  padding: 10px 12px; background: rgba(59,130,246,.05); border: 1px solid rgba(59,130,246,.15);
  border-radius: 8px; margin-bottom: 8px;
}
.ha-tool-confirm p { font-size: 12px; color: var(--color-text); margin: 0 0 4px; }
.ha-tool-confirm code { display: block; font-size: 10px; color: var(--color-text-muted); margin-bottom: 8px; word-break: break-all; }
.ha-tool-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ha-confirm-deny, .ha-confirm-allow { padding: 4px 14px; border-radius: 6px; font-size: 11px; font-weight: 600; border: none; cursor: pointer; }
.ha-confirm-deny { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.ha-confirm-allow { background: var(--color-user-bubble); color: var(--color-user-text); }

/* Input bottom */
.ha-input-bottom { flex-shrink: 0; padding: 12px 16px 16px; }
</style>
