<script setup>
import { ref, computed } from 'vue'
import { useAiConfig } from './composables/useAiConfig'
import { t } from './composables/useI18n'

defineProps({ embedded: { type: Boolean, default: false } })

const { config, providers, getProvider, getApiFormat, getEffectiveBaseUrl, getEffectiveModel } = useAiConfig()
const activeTab = ref('general')

const currentProvider = computed(() => getProvider())
const currentModels = computed(() => {
  const p = currentProvider.value
  const models = [...p.models]
  if (config.value.customModel && !models.includes(config.value.customModel)) models.push(config.value.customModel)
  return models
})

function onProviderChange() {
  const p = getProvider()
  if (p.models.length > 0) config.value.model = p.models[0]
  config.value.customModel = ''
}
</script>

<template>
  <div class="bs-root">
    <div class="bs-header">
      <span class="bs-title">{{ t('bs.title') }}</span>
    </div>

    <div class="bs-tabs">
      <button class="bs-tab" :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">{{ t('bs.general') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'ai' }" @click="activeTab = 'ai'">{{ t('bs.ai') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">{{ t('bs.about') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'shortcuts' }" @click="activeTab = 'shortcuts'">Shortcuts</button>
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
      </div>

      <!-- AI Tab -->
      <div v-if="activeTab === 'ai'" class="bs-section">
        <div class="bs-field">
          <label class="bs-label">Provider</label>
          <select class="bs-select" v-model="config.provider" @change="onProviderChange">
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div class="bs-field">
          <label class="bs-label">Model</label>
          <select class="bs-select" v-model="config.model">
            <option v-for="m in currentModels" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div class="bs-field">
          <label class="bs-label">API Key</label>
          <input class="bs-input" type="password" v-model="config.apiKey" :placeholder="currentProvider.apiKeyRequired ? 'Required' : 'Optional'" />
        </div>
        <div class="bs-field">
          <label class="bs-label">Base URL</label>
          <input class="bs-input" v-model="config.baseUrl" :placeholder="currentProvider.baseUrl" />
        </div>
        <div class="bs-field">
          <label class="bs-label">Temperature: {{ config.temperature }}</label>
          <input class="bs-input" type="range" min="0" max="2" step="0.1" v-model.number="config.temperature" style="padding:0;border:none;" />
        </div>
        <div class="bs-field">
          <label class="bs-label">Max Tokens</label>
          <input class="bs-input" type="number" v-model.number="config.maxTokens" min="256" max="128000" step="256" />
        </div>
        <div class="bs-field">
          <label class="bs-label">System Prompt</label>
          <textarea class="bs-input" v-model="config.systemPrompt" rows="3" style="resize:vertical;"></textarea>
        </div>
        <div class="bs-api-info">
          <span>Format: {{ getApiFormat() }}</span>
          <span>Endpoint: {{ getEffectiveBaseUrl() }}</span>
          <span>Model: {{ getEffectiveModel() }}</span>
        </div>
      </div>

      <!-- Shortcuts Tab -->
      <div v-if="activeTab === 'shortcuts'" class="bs-section">
        <div class="bs-shortcuts">
          <div class="bs-shortcut-row"><kbd>Ctrl+T</kbd><span>New Tab</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+W</kbd><span>Close Tab</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+Tab</kbd><span>Next Tab</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+Shift+T</kbd><span>Restore Closed Tab</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+L</kbd><span>Focus Address Bar</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+F</kbd><span>Find in Page</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+H</kbd><span>History</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+R / F5</kbd><span>Reload</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+= / Ctrl+-</kbd><span>Zoom In / Out</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+0</kbd><span>Zoom Reset</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+Shift+A</kbd><span>Toggle AI Sidebar</span></div>
        </div>
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

.bs-api-info {
  display: flex; flex-direction: column; gap: 4px; padding: 10px;
  background: rgba(28,28,28,0.03); border-radius: 6px; font-size: 11px; color: #8a8a88;
  margin-top: 16px;
}

.bs-about { padding: 8px 0; }
.bs-about-title { font-size: 28px; font-weight: 600; color: #1c1c1c; margin: 0 0 4px; }
.bs-about-version { font-size: 13px; color: #8a8a88; margin: 0 0 12px; }
.bs-about-desc { font-size: 14px; color: #5f5f5d; line-height: 1.5; margin: 0 0 16px; }
.bs-about-links { display: flex; flex-direction: column; gap: 6px; }
.bs-about-item { font-size: 12px; color: #5f5f5d; }
.bs-about-item strong { color: #1c1c1c; }
.bs-shortcuts { display: flex; flex-direction: column; gap: 6px; }
.bs-shortcut-row { display: flex; align-items: center; gap: 16px; padding: 6px 10px; background: rgba(28,28,28,0.02); border-radius: 6px; }
.bs-shortcut-row kbd { display: inline-block; padding: 2px 8px; background: #fcfbf8; border: 1px solid #eceae4; border-radius: 4px; font-family: monospace; font-size: 11px; color: #1c1c1c; min-width: 100px; text-align: center; }
.bs-shortcut-row span { font-size: 12px; color: #5f5f5d; }

* { margin: 0; padding: 0; box-sizing: border-box; }
</style>
