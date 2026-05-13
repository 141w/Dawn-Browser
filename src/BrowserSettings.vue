<script setup>
import { ref } from 'vue'
import { useAiConfig } from './composables/useAiConfig'
import { t } from './composables/useI18n'

defineProps({ embedded: { type: Boolean, default: false } })

const { config } = useAiConfig()
const activeTab = ref('general')

function openAiPanel() {
  if (window.electronAPI) window.electronAPI.showAiFloat()
}
</script>

<template>
  <div class="bs-root">
    <div class="bs-header">
      <span class="bs-title">{{ t('bs.title') }}</span>
    </div>

    <div class="bs-tabs">
      <button class="bs-tab" :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">{{ t('bs.general') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">{{ t('bs.about') }}</button>
    </div>

    <div class="bs-body">

      <!-- General Tab -->
      <div v-if="activeTab === 'general'" class="bs-section">
        <div class="bs-field">
          <label class="bs-label">{{ t('bs.lang') }}</label>
          <select class="bs-select" v-model="config.lang">
            <option value="zh">{{ t('bs.lang.zh') }}</option>
            <option value="en">{{ t('bs.lang.en') }}</option>
          </select>
        </div>

        <div class="bs-field">
          <label class="bs-label">{{ t('bs.newTabMode') }}</label>
          <select class="bs-select" v-model="config.newTabMode">
            <option value="dawn">{{ t('bs.newTabMode.dawn') }}</option>
            <option value="blank">{{ t('bs.newTabMode.blank') }}</option>
            <option value="custom">{{ t('bs.newTabMode.custom') }}</option>
          </select>
        </div>
        <div class="bs-field" v-if="config.newTabMode === 'custom'">
          <label class="bs-label">{{ t('bs.customUrl') }}</label>
          <input class="bs-input" v-model="config.newTabUrl" placeholder="https://..." />
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('bs.searchEngine') }}</label>
          <select class="bs-select" v-model="config.searchEngine">
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="baidu">百度</option>
            <option value="duckduckgo">DuckDuckGo</option>
          </select>
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('bs.downloadPath') }}</label>
          <input class="bs-input" v-model="config.downloadPath" placeholder="Default" />
        </div>
        <div class="bs-field">
          <label class="bs-checkbox-label">
            <input type="checkbox" v-model="config.clearOnExit" />
            <span>{{ t('bs.clearOnExit') }}</span>
          </label>
        </div>

        <hr class="bs-divider" />

        <h3 class="bs-section-title">{{ t('bs.aiSection') }}</h3>
        <p class="bs-section-desc">{{ t('bs.aiSectionDesc') }}</p>
        <button class="bs-open-ai-btn" @click="openAiPanel">{{ t('bs.openAi') }}</button>
      </div>

      <!-- About Tab -->
      <div v-if="activeTab === 'about'" class="bs-section">
        <div class="bs-about">
          <h2 class="bs-about-title">{{ t('bs.aboutTitle') }}</h2>
          <p class="bs-about-version">{{ t('bs.aboutVersion') }}</p>
          <p class="bs-about-desc">{{ t('bs.aboutDesc') }}</p>
          <div class="bs-about-links">
            <div class="bs-about-item"><strong>{{ t('bs.aboutRuntime') }}:</strong> {{ t('bs.aboutRuntimeVal') }}</div>
            <div class="bs-about-item"><strong>{{ t('bs.aboutProviders') }}:</strong> {{ t('bs.aboutProvidersVal') }}</div>
            <div class="bs-about-item"><strong>{{ t('bs.aboutFeatures') }}:</strong> {{ t('bs.aboutFeaturesVal') }}</div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.bs-root {
  min-height: 100vh;
  background: #f7f4ed;
  font-family: "Camera Plain Variable", ui-sans-serif, system-ui, sans-serif;
  display: flex; flex-direction: column;
}
.bs-header {
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px 0; flex-shrink: 0;
}
.bs-title { font-size: 28px; font-weight: 600; color: #1c1c1c; letter-spacing: -0.6px; }

.bs-tabs { display: flex; gap: 1px; padding: 24px 20px 0; justify-content: center; flex-shrink: 0; }
.bs-tab {
  padding: 8px 20px; background: transparent; border: none; border-bottom: 2px solid transparent;
  font-size: 13px; font-weight: 600; font-family: inherit; color: #8a8a88; cursor: pointer; transition: all 0.15s;
}
.bs-tab:hover { color: #5f5f5d; }
.bs-tab.active { color: #1c1c1c; border-bottom-color: #1c1c1c; }

.bs-body { flex: 1; max-width: 520px; margin: 0 auto; padding: 24px 20px 60px; width: 100%; }

.bs-section { }
.bs-section-title { font-size: 15px; font-weight: 600; color: #1c1c1c; margin: 0 0 4px; }
.bs-section-desc { font-size: 12px; color: #8a8a88; margin: 0 0 12px; }

.bs-field { margin-bottom: 16px; }
.bs-label { display: block; font-size: 12px; font-weight: 600; color: #5f5f5d; margin-bottom: 4px; }
.bs-input, .bs-select {
  width: 100%; padding: 8px 10px; background: #f7f4ed; border: 1px solid #eceae4;
  border-radius: 6px; font-size: 13px; font-family: inherit; color: #1c1c1c; outline: none;
}
.bs-input:focus, .bs-select:focus { border-color: rgba(28,28,28,0.4); }
.bs-select { cursor: pointer; }

.bs-checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #1c1c1c; cursor: pointer; }
.bs-checkbox-label input[type="checkbox"] { accent-color: #1c1c1c; }

.bs-divider { border: none; border-top: 1px solid #eceae4; margin: 24px 0; }

.bs-open-ai-btn {
  padding: 10px 20px; background: #1c1c1c; color: #fcfbf8; border: none;
  border-radius: 8px; font-size: 13px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.15s;
  box-shadow: rgba(255,255,255,0.2) 0px 0.5px 0px 0px inset, rgba(0,0,0,0.2) 0px 0px 0px 0.5px inset, rgba(0,0,0,0.05) 0px 1px 2px 0px;
}
.bs-open-ai-btn:hover { opacity: 0.85; }

.bs-about { padding: 8px 0; }
.bs-about-title { font-size: 28px; font-weight: 600; color: #1c1c1c; margin: 0 0 4px; }
.bs-about-version { font-size: 13px; color: #8a8a88; margin: 0 0 12px; }
.bs-about-desc { font-size: 14px; color: #5f5f5d; line-height: 1.5; margin: 0 0 16px; }
.bs-about-links { display: flex; flex-direction: column; gap: 6px; }
.bs-about-item { font-size: 12px; color: #5f5f5d; }
.bs-about-item strong { color: #1c1c1c; }

* { margin: 0; padding: 0; box-sizing: border-box; }
</style>
