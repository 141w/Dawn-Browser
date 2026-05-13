<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import ChatInput from './ChatInput.vue'
import { useAiChat } from './composables/useAiChat'
import { renderMarkdown } from './composables/useMarkdown'
import { t } from './composables/useI18n'

const { conversations, activeConvId, isStreaming, streamError, getActiveConversation, createConversation, sendMessage, stopStreaming } = useAiChat()

// Always start fresh on home page (during setup, before first render)
createConversation()

const activeConv = getActiveConversation()
const messagesEl = ref(null)
const hasMessages = computed(() => activeConv.value && activeConv.value.messages.length > 0)

function scrollToBottom() { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }
watch(() => activeConv.value?.messages?.length, () => nextTick(scrollToBottom))

function handleSend(finalMsg, slashCmd, displayMsg) {
  try {
    if (!finalMsg || !finalMsg.trim()) return
    if (!activeConvId.value) createConversation()
    sendMessage(finalMsg, null, null, slashCmd, displayMsg)
    nextTick(scrollToBottom)
  } catch(e) {
    console.error('[Dawn] handleSend error:', e.message, e.stack)
    streamError.value = e.message
  }
}
</script>

<template>
  <div class="ha-root" :class="{ chatting: hasMessages }">
    <!-- MODE 1: Centered welcome + input -->
    <div v-if="!hasMessages" class="ha-centered">
      <div class="ha-logo">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"><path d="M12 2a10 10 0 0110 10 10 10 0 01-10 10A10 10 0 012 12 10 10 0 0112 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      </div>
      <h1 class="ha-title">{{ t('ai.welcome') }}</h1>
      <ChatInput :isStreaming="isStreaming" @send="handleSend" @stop="stopStreaming" @clear="createConversation()" />
    </div>

    <!-- MODE 2: Messages + input at bottom -->
    <template v-else>
      <div class="ha-messages" ref="messagesEl">
        <div v-for="(msg,i) in activeConv.messages" :key="i" class="ha-msg" :class="msg.role">
          <div v-if="msg.role==='user'" class="ha-bubble user">
            <span v-if="msg.slashCmd" class="ha-slash-badge">{{ msg.slashCmd.label }}</span>
            {{ msg.content }}
          </div>
          <div v-else-if="msg.role==='assistant' && msg.content" class="ha-bubble asst" v-html="renderMarkdown(msg.content)"></div>
        </div>
        <div v-if="isStreaming && !activeConv.messages[activeConv.messages.length-1]?.content" class="ha-thinking"><span class="ha-dot"></span><span class="ha-dot"></span><span class="ha-dot"></span></div>
        <div v-if="streamError" class="ha-error">{{ streamError }}</div>
      </div>
      <div class="ha-input-bottom">
        <ChatInput :isStreaming="isStreaming" @send="handleSend" @stop="stopStreaming" @clear="createConversation()" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ha-root { display: flex; flex-direction: column; height: 100%; background: #f7f4ed; }

/* Centered */
.ha-centered {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; padding: 40px 20px;
}
.ha-title { font-size: 22px; font-weight: 600; color: #1c1c1c; letter-spacing: -.3px; }

/* Messages mode */
.ha-messages { flex: 1; overflow-y: auto; padding: 20px; }
.ha-msg { margin-bottom: 16px; display: flex; }
.ha-msg.user { justify-content: flex-end; }
.ha-bubble { max-width: 75%; padding: 10px 15px; border-radius: 16px; font-size: 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.ha-bubble.user { background: #1c1c1c; color: #fcfbf8; border-bottom-right-radius: 6px; display: flex; flex-direction: column; gap: 6px; }
.ha-slash-badge { display: inline-flex; align-self: flex-start; padding: 1px 7px; background: rgba(255,255,255,0.12); border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: 600; color: rgba(255,255,255,0.7); letter-spacing: 0.3px; }
.ha-bubble.asst { background: #fcfbf8; color: #1c1c1c; border: 1px solid #eceae4; border-bottom-left-radius: 6px; box-shadow: rgba(0,0,0,0.03) 0px 1px 6px; }
.ha-bubble.asst :deep(p) { margin: 0 0 6px; }
.ha-bubble.asst :deep(p:last-child) { margin: 0; }
.ha-bubble.asst :deep(code) { background: rgba(28,28,28,0.05); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 12px; }
.ha-bubble.asst :deep(pre) { background: rgba(28,28,28,0.04); padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 6px 0; }
.ha-thinking { display: flex; gap: 5px; padding: 12px 15px; }
.ha-dot { width: 6px; height: 6px; border-radius: 50%; background: #c0c0c0; animation: ha-bounce 1.4s infinite; }
.ha-dot:nth-child(2) { animation-delay: .2s; }
.ha-dot:nth-child(3) { animation-delay: .4s; }
@keyframes ha-bounce { 0%,80%,100%{transform:scale(.6);opacity:.4} 40%{transform:scale(1);opacity:1} }
.ha-error { padding: 8px 12px; background: rgba(255,95,86,0.06); border: 1px solid rgba(255,95,86,0.15); border-radius: 8px; font-size: 12px; color: #c00; }
.ha-input-bottom { flex-shrink: 0; padding: 12px 16px 16px; }
</style>
