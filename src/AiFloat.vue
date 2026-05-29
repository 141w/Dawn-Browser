<script setup>
import { ref, onMounted } from 'vue'
import AiSidebar from './AiSidebar.vue'
import { t } from './composables/useI18n'

const width = ref(Number(localStorage.getItem('dawn-ai-width')) || 420)
const height = ref(Number(localStorage.getItem('dawn-ai-height')) || 520)
const isMinimized = ref(false)

function updateWindowSize() {
  const h = isMinimized.value ? 44 : height.value
  window.electronAPI?.resizeAiFloat(Math.round(width.value), Math.round(h))
}

onMounted(() => {
  updateWindowSize()
})

function onClose() {
  window.electronAPI?.hideAiFloat()
}

function onMinimize() {
  isMinimized.value = !isMinimized.value
  updateWindowSize()
}

function onMaximize() {
  isMinimized.value = false
  updateWindowSize()
}
</script>

<template>
  <div class="ai-float-root">
    <div class="ai-float-header">
      <div class="ai-float-dots">
        <span class="ai-float-dot close" @click="onClose"></span>
        <span class="ai-float-dot min" @click="onMinimize"></span>
        <span class="ai-float-dot max" @click="onMaximize"></span>
      </div>
      <span class="ai-float-title">{{ t('aifloat.title') }}</span>
    </div>
    <div v-show="!isMinimized" class="ai-float-body">
      <AiSidebar :embedded="true" />
    </div>
  </div>
</template>

<style>
.ai-float-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--color-shadow) 0px 8px 40px;
}

.ai-float-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.ai-float-dots {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.ai-float-dot { width: 10px; height: 10px; border-radius: 50%; cursor: pointer; transition: opacity 0.15s; }
.ai-float-dot:hover { opacity: 0.8; }
.ai-float-dot.close { background: #ff5f56; }
.ai-float-dot.min { background: #ffbd2e; }
.ai-float-dot.max { background: #27ca40; }

.ai-float-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.ai-float-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
