<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useAiConfig } from './composables/useAiConfig'
import { useToolSystem } from './composables/useToolSystem'
import { useSkillSystem } from './composables/useSkillSystem'
import { t } from './composables/useI18n'
import { useHistory } from './composables/useHistory'
import BookmarkManager from './BookmarkManager.vue'

defineProps({ embedded: { type: Boolean, default: false } })

const { config, providers, getProvider, getApiFormat, getEffectiveBaseUrl, getEffectiveModel } = useAiConfig()
const { getRegisteredTools, getPermission, setPermission, resolvePermission, syncMcpTools } = useToolSystem()
const { allSkillsWithStatus, toggleSkill, addCustomSkill, deleteCustomSkill, updateCustomSkill, isCustomSkill, loadSkills, refreshSkills } = useSkillSystem()
const activeTab = ref('general')

const newSkillName = ref('')
const newSkillDesc = ref('')
const newSkillContent = ref('')
const showAddSkill = ref(false)
const githubUrl = ref('')
const useSymlink = ref(false)
const installLoading = ref(false)
const installMsg = ref('')
const editingSkill = ref(null)
const editContent = ref('')

function handleAddSkill() {
  const ok = addCustomSkill(newSkillName.value.trim(), newSkillDesc.value.trim(), newSkillContent.value)
  if (ok) { newSkillName.value=''; newSkillDesc.value=''; newSkillContent.value=''; showAddSkill.value=false }
}
function startEditSkill(s) { editingSkill.value=s.name; editContent.value=s.content||'' }
function saveEditSkill(s) { updateCustomSkill(s.name,null,editContent.value); editingSkill.value=null; editContent.value='' }
async function handleDeleteSkill(n) { if(!confirm(t('skill.confirmDelete') + ' "'+n+'"?')) return; if(isCustomSkill(n)) { deleteCustomSkill(n) } else { const ok = await window.electronAPI.skillUninstall(n); if(ok) refreshSkills() } }

async function handleInstallGithub() {
  if (!githubUrl.value.trim()) return
  installLoading.value = true
  installMsg.value = ''
  try {
    const res = await window.electronAPI.skillInstallGithub(githubUrl.value.trim(), useSymlink.value)
    if (res.success) {
      installMsg.value = t('skill.installSuccess')
      githubUrl.value = ''
      refreshSkills()
    } else {
      installMsg.value = t('skill.installFailed') + ': ' + (res.error || '')
    }
  } catch (e) {
    installMsg.value = t('skill.installFailed') + ': ' + e.message
  }
  installLoading.value = false
}

async function handleInstallZip() {
  installLoading.value = true
  installMsg.value = ''
  try {
    const res = await window.electronAPI.skillInstallZip()
    if (res.success) {
      installMsg.value = t('skill.installSuccess')
      refreshSkills()
    } else {
      installMsg.value = res.error === 'Cancelled' ? '' : t('skill.installFailed') + ': ' + (res.error || '')
    }
  } catch (e) {
    installMsg.value = t('skill.installFailed') + ': ' + e.message
  }
  installLoading.value = false
}

async function handleUpdateSkill(name) {
  installLoading.value = true
  try { await window.electronAPI.skillUpdate(name); refreshSkills() }
  catch {}
  installLoading.value = false
}

function handleOpenFolder(name) {
  window.electronAPI.skillOpenFolder(name)
}

// Custom model management
const newCustomModel = ref('')

const customModels = computed(() => {
  const saved = config.value.customModels
  if (Array.isArray(saved)) return saved
  // Migrate: if customModel is set but not in list, add it
  if (config.value.customModel) return [config.value.customModel]
  return []
})

function addCustomModel() {
  const m = newCustomModel.value.trim()
  if (!m) return
  if (!config.value.customModels) config.value.customModels = []
  if (!config.value.customModels.includes(m)) {
    config.value.customModels.push(m)
  }
  config.value.customModel = m
  config.value.model = m
  newCustomModel.value = ''
}

function removeCustomModel(m) {
  if (!config.value.customModels) return
  config.value.customModels = config.value.customModels.filter(x => x !== m)
  if (config.value.customModel === m) config.value.customModel = ''
  if (config.value.model === m) {
    const p = getProvider()
    config.value.model = p.models.length > 0 ? p.models[0] : ''
  }
}

// MCP state
const mcpStatuses = ref({})
const mcpAdding = ref(false)
const mcpNewServer = ref({ id: '', command: '', args: '', env: '', enabled: true })

const currentProvider = computed(() => getProvider())
const currentModels = computed(() => {
  const p = currentProvider.value
  const models = [...p.models]
  // Include all custom models
  for (const m of customModels.value) {
    if (!models.includes(m)) models.push(m)
  }
  // Legacy: include customModel if not already in list
  if (config.value.customModel && !models.includes(config.value.customModel)) models.push(config.value.customModel)
  return models
})

function onProviderChange() {
  const p = getProvider()
  if (p.models.length > 0) config.value.model = p.models[0]
  config.value.customModel = ''
}

async function refreshMcpStatuses() {
  if (typeof window === 'undefined' || !window.electronAPI?.mcpGetStatuses) return
  try { mcpStatuses.value = await window.electronAPI.mcpGetStatuses() } catch {}
}

async function mcpToggleServer(id) {
  const status = mcpStatuses.value[id]
  if (!window.electronAPI) return
  if (status?.status === 'connected') {
    await window.electronAPI.mcpStopServer(id)
  } else {
    const srv = config.value.mcpServers?.find(s => s.id === id)
    if (srv) await window.electronAPI.mcpStartServer(srv)
  }
  await refreshMcpStatuses()
  syncMcpTools()
}

async function mcpAddServer() {
  const s = mcpNewServer.value
  if (!s.id || !s.command) return
  const entry = {
    id: s.id.trim(),
    command: s.command.trim(),
    args: s.args ? s.args.split(/\s+/).filter(Boolean) : [],
    env: s.env ? Object.fromEntries(s.env.split(',').map(p => { const [k, ...v] = p.split('='); return [k.trim(), v.join('=').trim()] }).filter(([k]) => k)) : {},
    enabled: s.enabled
  }
  if (!config.value.mcpServers) config.value.mcpServers = []
  if (config.value.mcpServers.some(x => x.id === entry.id)) return
  config.value.mcpServers.push(entry)
  mcpAdding.value = false
  mcpNewServer.value = { id: '', command: '', args: '', env: '', enabled: true }
  if (entry.enabled && window.electronAPI?.mcpStartServer) {
    await window.electronAPI.mcpStartServer(entry)
    await refreshMcpStatuses()
    syncMcpTools()
  }
}

function mcpRemoveServer(id) {
  if (!config.value.mcpServers) return
  config.value.mcpServers = config.value.mcpServers.filter(s => s.id !== id)
  if (window.electronAPI?.mcpStopServer) window.electronAPI.mcpStopServer(id).then(() => refreshMcpStatuses())
}

async function clearBrowsingData(type) {
  const { clearHistory } = useHistory()
  if (type === 'history' || type === 'all') {
    await clearHistory()
  }
  if (type === 'downloads' || type === 'all') {
    if (window.electronAPI?.clearDownloads) await window.electronAPI.clearDownloads()
  }
}

// Apply appearance settings to the page and broadcast to all windows
function applyAppearance() {
  if (!config.value) return
  const root = document.documentElement
  root.style.fontSize = (config.value.fontSize || 14) + 'px'
  root.setAttribute('data-theme', config.value.theme || 'light')
  // Broadcast theme change to other windows via IPC store
  if (window.electronAPI?.storeSet) {
    window.electronAPI.storeSet('__theme', {
      theme: config.value.theme || 'light',
      fontSize: config.value.fontSize || 14
    })
  }
}
watch(() => [config.value?.theme, config.value?.fontSize], applyAppearance)
onMounted(applyAppearance)
</script>

<template>
  <div class="bs-root">
    <div class="bs-header">
      <span class="bs-title">{{ t('bs.title') }}</span>
    </div>

    <div class="bs-tabs">
      <button class="bs-tab" :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">{{ t('bs.general') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'appearance' }" @click="activeTab = 'appearance'">{{ t('bs.appearance') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'ai' }" @click="activeTab = 'ai'">{{ t('bs.ai') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'tools' }" @click="activeTab = 'tools'">{{ t('bs.tools') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'mcp' }" @click="activeTab = 'mcp'; refreshMcpStatuses()">MCP</button>
      <button class="bs-tab" :class="{ active: activeTab === 'bookmarks' }" @click="activeTab = 'bookmarks'">{{ t('bs.bookmarks') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'privacy' }" @click="activeTab = 'privacy'">{{ t('bs.privacy') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">{{ t('bs.about') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'shortcuts' }" @click="activeTab = 'shortcuts'">{{ t('bs.shortcuts') }}</button>
      <button class="bs-tab" :class="{ active: activeTab === 'skills' }" @click="activeTab = 'skills'">{{ t('bs.skills') }}</button>
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
      </div>

      <!-- Appearance Tab -->
      <div v-if="activeTab === 'appearance'" class="bs-section">
        <div class="bs-field">
          <label class="bs-label">{{ t('bs.theme') }}</label>
          <select class="bs-select" v-model="config.theme">
            <option value="light">{{ t('bs.theme.light') }}</option>
            <option value="dark">{{ t('bs.theme.dark') }}</option>
            <option value="system">{{ t('bs.theme.system') }}</option>
          </select>
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('bs.fontSize') }}: {{ config.fontSize || 14 }}px</label>
          <input class="bs-input" type="range" min="12" max="20" step="1" v-model.number="config.fontSize" style="padding:0;border:none;" />
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('bs.uiDensity') }}</label>
          <select class="bs-select" v-model="config.uiDensity">
            <option value="compact">{{ t('bs.density.compact') }}</option>
            <option value="default">{{ t('bs.density.default') }}</option>
            <option value="comfortable">{{ t('bs.density.comfortable') }}</option>
          </select>
        </div>
      </div>

      <!-- AI Tab -->
      <div v-if="activeTab === 'ai'" class="bs-section">
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.provider') }}</label>
          <select class="bs-select" v-model="config.provider" @change="onProviderChange">
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.modelLabel') }}</label>
          <select class="bs-select" v-model="config.model">
            <option v-for="m in currentModels" :key="m" :value="m">{{ m }}</option>
          </select>
          <div class="bs-custom-model" style="display:flex;gap:4px;margin-top:4px;">
            <input class="bs-input" v-model="newCustomModel" :placeholder="t('settings.customModel')" @keydown.enter="addCustomModel" />
            <button class="bs-mcp-btn" @click="addCustomModel" style="flex-shrink:0;">{{ t('settings.add') }}</button>
          </div>
          <div v-if="customModels.length > 0" class="bs-custom-model-list" style="margin-top:8px;">
            <div v-for="m in customModels" :key="m" class="bs-custom-model-item" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:var(--color-bg-hover);border-radius:4px;margin-bottom:2px;">
              <span style="font-size:12px;font-family:monospace;color:var(--color-text);">{{ m }}</span>
              <button style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:14px;" @click="removeCustomModel(m)" :title="t('bs.removeModel')">&times;</button>
            </div>
          </div>
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.apiKey') }}</label>
          <input class="bs-input" type="password" v-model="config.apiKey" :placeholder="currentProvider.apiKeyRequired ? t('bs.required') : t('bs.optional')" />
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.baseUrl') }}</label>
          <input class="bs-input" v-model="config.baseUrl" :placeholder="currentProvider.baseUrl" />
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.temperature') }}: {{ config.temperature }}</label>
          <input class="bs-input" type="range" min="0" max="2" step="0.1" v-model.number="config.temperature" style="padding:0;border:none;" />
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.maxTokens') }}</label>
          <input class="bs-input" type="number" v-model.number="config.maxTokens" min="256" max="128000" step="256" />
        </div>
        <div class="bs-field">
          <label class="bs-label">{{ t('settings.systemPrompt') }}</label>
          <textarea class="bs-input" v-model="config.systemPrompt" rows="3" style="resize:vertical;"></textarea>
        </div>
        <div class="bs-api-info">
          <span>{{ t('bs.format') }}: {{ getApiFormat() }}</span>
          <span>{{ t('bs.endpoint') }}: {{ getEffectiveBaseUrl() }}</span>
          <span>{{ t('settings.modelLabel') }}: {{ getEffectiveModel() }}</span>
        </div>
      </div>

      <!-- Tools Tab -->
      <div v-if="activeTab === 'tools'" class="bs-section">
        <div class="bs-section-title" style="font-size:14px;font-weight:600;color:var(--color-text);margin-bottom:4px;">{{ t('bs.toolsTitle') }}</div>
        <div class="bs-section-desc" style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">{{ t('bs.toolsDesc') }}</div>
        <div class="bs-tools-list">
          <div v-for="tool in getRegisteredTools()" :key="tool.name" class="bs-tool-row">
            <div class="bs-tool-info">
              <span class="bs-tool-name">{{ tool.name }}</span>
              <span class="bs-tool-desc">{{ tool.description?.substring(0, 80) }}{{ tool.description?.length > 80 ? '...' : '' }}</span>
            </div>
            <select class="bs-select bs-tool-select" :value="resolvePermission(tool.name, tool.permission)" @change="setPermission(tool.name, $event.target.value)">
              <option value="safe">{{ t('perm.safe') }} ({{ t('perm.auto') }})</option>
              <option value="confirm">{{ t('perm.confirm') }}</option>
              <option value="deny">{{ t('perm.deny') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- MCP Tab -->
      <div v-if="activeTab === 'mcp'" class="bs-section">
        <div class="bs-section-title" style="font-size:14px;font-weight:600;color:var(--color-text);margin-bottom:4px;">{{ t('bs.mcpTitle') }}</div>
        <div class="bs-section-desc" style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">{{ t('bs.mcpDesc') }}</div>

        <div class="bs-mcp-list">
          <div v-for="srv in (config.mcpServers || [])" :key="srv.id" class="bs-mcp-row">
            <div class="bs-mcp-info">
              <span class="bs-mcp-name">{{ srv.id }}</span>
              <span class="bs-mcp-cmd">{{ srv.command }} {{ (srv.args || []).join(' ') }}</span>
              <span class="bs-mcp-status" :class="mcpStatuses[srv.id]?.status || 'disconnected'">{{ mcpStatuses[srv.id]?.status || 'disconnected' }}</span>
              <span v-if="mcpStatuses[srv.id]?.error" class="bs-mcp-error">{{ mcpStatuses[srv.id].error }}</span>
            </div>
            <div class="bs-mcp-actions">
              <button class="bs-mcp-btn" @click="mcpToggleServer(srv.id)">{{ (mcpStatuses[srv.id]?.status === 'connected') ? t('bs.stop') : t('bs.start') }}</button>
              <button class="bs-mcp-btn bs-mcp-btn-danger" @click="mcpRemoveServer(srv.id)">{{ t('bs.remove') }}</button>
            </div>
            <div v-if="mcpStatuses[srv.id]?.tools?.length" class="bs-mcp-tools">
              <span v-for="tool in mcpStatuses[srv.id].tools" :key="tool.name" class="bs-mcp-tool-tag">{{ tool.originalName }}</span>
            </div>
          </div>
          <div v-if="!(config.mcpServers || []).length" class="bs-mcp-empty">{{ t('bs.mcpEmpty') }}</div>
        </div>

        <div v-if="mcpAdding" class="bs-mcp-form">
          <div class="bs-field">
            <label class="bs-label">{{ t('bs.mcpServerId') }}</label>
            <input class="bs-input" v-model="mcpNewServer.id" :placeholder="t('bs.mcpServerIdPh')" />
          </div>
          <div class="bs-field">
            <label class="bs-label">{{ t('bs.mcpCommand') }}</label>
            <input class="bs-input" v-model="mcpNewServer.command" :placeholder="t('bs.mcpCommandPh')" />
          </div>
          <div class="bs-field">
            <label class="bs-label">{{ t('bs.mcpArgs') }}</label>
            <input class="bs-input" v-model="mcpNewServer.args" :placeholder="t('bs.mcpArgsPh')" />
          </div>
          <div class="bs-field">
            <label class="bs-label">{{ t('bs.mcpEnv') }}</label>
            <input class="bs-input" v-model="mcpNewServer.env" :placeholder="t('bs.mcpEnvPh')" />
          </div>
          <div class="bs-field">
            <label class="bs-checkbox-label">
              <input type="checkbox" v-model="mcpNewServer.enabled" />
              <span>{{ t('bs.mcpAutoStart') }}</span>
            </label>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="bs-mcp-btn" @click="mcpAddServer">{{ t('bs.mcpAdd') }}</button>
            <button class="bs-mcp-btn" @click="mcpAdding = false">{{ t('ai.cancel') }}</button>
          </div>
        </div>
        <button v-else class="bs-mcp-btn" style="margin-top:8px;" @click="mcpAdding = true">+ {{ t('bs.mcpAdd') }}</button>
      </div>

      <!-- Bookmarks Tab -->
      <div v-if="activeTab === 'bookmarks'" class="bs-section">
        <BookmarkManager />
      </div>

      <!-- Privacy Tab -->
      <div v-if="activeTab === 'privacy'" class="bs-section">
        <div class="bs-field">
          <label class="bs-checkbox-label">
            <input type="checkbox" v-model="config.clearOnExit" />
            <span>{{ t('bs.clearOnExit') }}</span>
          </label>
        </div>
        <div class="bs-field">
          <label class="bs-checkbox-label">
            <input type="checkbox" v-model="config.doNotTrack" />
            <span>{{ t('bs.doNotTrack') }}</span>
          </label>
          <div class="bs-hint">{{ t('bs.doNotTrackHint') }}</div>
        </div>
        <div class="bs-field" style="margin-top:16px;">
          <label class="bs-label">{{ t('bs.clearBrowsingData') }}</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="bs-mcp-btn" @click="clearBrowsingData('history')">{{ t('bs.clearHistory') }}</button>
            <button class="bs-mcp-btn" @click="clearBrowsingData('downloads')">{{ t('bs.clearDownloads') }}</button>
            <button class="bs-mcp-btn bs-mcp-btn-danger" @click="clearBrowsingData('all')">{{ t('bs.clearAll') }}</button>
          </div>
        </div>
      </div>

      <!-- Shortcuts Tab -->
      <div v-if="activeTab === 'shortcuts'" class="bs-section">
        <div class="bs-shortcuts">
          <div class="bs-shortcut-row"><kbd>Ctrl+T</kbd><span>{{ t('bs.sc.newTab') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+W</kbd><span>{{ t('bs.sc.closeTab') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+Tab</kbd><span>{{ t('bs.sc.nextTab') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+Shift+T</kbd><span>{{ t('bs.sc.restoreTab') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+L</kbd><span>{{ t('bs.sc.focusAddr') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+F</kbd><span>{{ t('bs.sc.findInPage') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+H</kbd><span>{{ t('bs.sc.history') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+R / F5</kbd><span>{{ t('bs.sc.reload') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+= / Ctrl+-</kbd><span>{{ t('bs.sc.zoom') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+0</kbd><span>{{ t('bs.sc.zoomReset') }}</span></div>
          <div class="bs-shortcut-row"><kbd>Ctrl+Shift+A</kbd><span>{{ t('bs.sc.toggleAI') }}</span></div>
        </div>
      </div>

            <!-- Skills Tab -->
      <div v-if="activeTab === 'skills'" class="bs-section">
        <div class="bs-section-title" style="font-size:14px;font-weight:600;color:var(--color-text);margin-bottom:4px;">{{ t('skill.title') }}</div>
        <div class="bs-section-desc" style="font-size:12px;color:var(--color-text-secondary);margin-bottom:12px;">{{ t('skill.desc') }}</div>

        <!-- Install from GitHub -->
        <div style="padding:12px;background:var(--color-bg-secondary,rgba(0,0,0,0.03));border-radius:8px;border:1px solid var(--color-border,rgba(0,0,0,0.08));margin-bottom:12px;">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--color-text);">{{ t('skill.install') }}</div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input v-model="githubUrl" :placeholder="t('skill.githubPlaceholder')" style="flex:1;padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:12px;background:var(--color-bg);color:var(--color-text);" @keydown.enter="handleInstallGithub" />
            <button class="bs-btn-primary" @click="handleInstallGithub" :disabled="!githubUrl.trim() || installLoading" style="padding:6px 14px;font-size:12px;white-space:nowrap;">{{ installLoading ? t('skill.installing') : t('skill.installBtn') }}</button>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--color-text-secondary);cursor:pointer;">
              <input type="checkbox" v-model="useSymlink" style="accent-color:var(--color-primary,#2563eb);" /> {{ t('skill.useSymlink') }}
            </label>
            <button class="bs-btn" @click="handleInstallZip" :disabled="installLoading" style="padding:4px 12px;font-size:11px;">{{ t('skill.installZip') }}</button>
          </div>
          <div v-if="installMsg" style="margin-top:6px;font-size:11px;" :style="installMsg.includes('Failed') || installMsg.includes('失败') ? 'color:#ef4444;' : 'color:#22c55e;'">{{ installMsg }}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
          <div v-for="skill in allSkillsWithStatus" :key="skill.name" style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:var(--color-bg-secondary,rgba(0,0,0,0.03));border-radius:8px;border:1px solid var(--color-border,rgba(0,0,0,0.08));">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                <span style="font-weight:600;font-size:13px;color:var(--color-text);">{{ skill.name }}</span>
                <span style="font-size:10px;padding:1px 6px;border-radius:4px;font-weight:500;"
                  :style="skill.source === 'custom' ? 'background:#e8f5e9;color:#2e7d32;' : 'background:#e3f2fd;color:#1565c0;'">
                  {{ skill.source === 'bundled' ? t('skill.source.bundled') : skill.source === 'custom' ? t('skill.source.custom') : t('skill.source.installed') }}
                </span>
              </div>
              <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.4;">{{ skill.description }}</div>
              <div v-if="editingSkill === skill.name" style="margin-top:8px;">
                <textarea v-model="editContent" rows="6" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:6px;font-family:monospace;font-size:12px;resize:vertical;background:var(--color-bg);color:var(--color-text);"></textarea>
                <div style="display:flex;gap:6px;margin-top:6px;">
                  <button class="bs-btn-primary" @click="saveEditSkill(skill)" style="padding:4px 12px;font-size:11px;">{{ t('skill.save') }}</button>
                  <button class="bs-btn" @click="editingSkill = null" style="padding:4px 12px;font-size:11px;">{{ t('skill.cancel') }}</button>
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <button @click="toggleSkill(skill.name)"
                :style="skill.enabled ? 'background:#4caf50;color:#fff;' : 'background:#9e9e9e;color:#fff;'"
                style="padding:3px 10px;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500;">
                {{ skill.enabled ? t('skill.on') : t('skill.off') }}
              </button>
              <button v-if="skill.source === 'custom'" @click="startEditSkill(skill)"
                style="padding:3px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:11px;cursor:pointer;background:var(--color-bg);color:var(--color-text);">
                Edit
              </button>
              <button v-if="skill.source === 'installed'" @click="handleOpenFolder(skill.name)"
                style="padding:3px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:11px;cursor:pointer;background:var(--color-bg);color:var(--color-text);">
                {{ t('skill.openFolder') }}
              </button>
              <button v-if="skill.source === 'installed' && skill.installInfo?.source?.startsWith('github')" @click="handleUpdateSkill(skill.name)"
                style="padding:3px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:11px;cursor:pointer;background:var(--color-bg);color:var(--color-text);">
                {{ t('skill.update') }}
              </button>
              <button v-if="skill.source === 'custom' || skill.source === 'installed'" @click="handleDeleteSkill(skill.name)"
                style="padding:3px 8px;border:1px solid #ef5350;border-radius:4px;font-size:11px;cursor:pointer;background:var(--color-bg);color:#ef5350;">
                Del
              </button>
            </div>
          </div>
          <div v-if="allSkillsWithStatus.length === 0" style="padding:16px;text-align:center;color:var(--color-text-secondary);font-size:13px;">
            {{ t('skill.noSkills') }}
          </div>
        </div>

        <div v-if="!showAddSkill" style="margin-top:8px;">
          <button class="bs-btn-primary" @click="showAddSkill = true" style="padding:6px 16px;font-size:12px;">{{ t('skill.addCustom') }}</button>
        </div>
        <div v-else style="padding:12px;background:var(--color-bg-secondary,rgba(0,0,0,0.03));border-radius:8px;border:1px solid var(--color-border,rgba(0,0,0,0.08));margin-top:8px;">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--color-text);">{{ t('skill.newSkill') }}</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <input v-model="newSkillName" placeholder="" :placeholder="t('skill.name')" style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:12px;background:var(--color-bg);color:var(--color-text);" />
            <input v-model="newSkillDesc" placeholder="" :placeholder="t('skill.description')" style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:12px;background:var(--color-bg);color:var(--color-text);" />
            <textarea v-model="newSkillContent" placeholder="" :placeholder="t('skill.content')" rows="8" style="padding:8px;border:1px solid var(--color-border);border-radius:6px;font-family:monospace;font-size:12px;resize:vertical;background:var(--color-bg);color:var(--color-text);"></textarea>
            <div style="display:flex;gap:6px;">
              <button class="bs-btn-primary" @click="handleAddSkill" :disabled="!newSkillName.trim() || !newSkillDesc.trim() || !newSkillContent.trim()" style="padding:6px 16px;font-size:12px;">{{ t('skill.create') }}</button>
              <button class="bs-btn" @click="showAddSkill = false" style="padding:6px 16px;font-size:12px;">{{ t('skill.cancel') }}</button>
            </div>
          </div>
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
  background: var(--color-bg);
  font-family: "Camera Plain Variable", ui-sans-serif, system-ui, sans-serif;
  display: flex; flex-direction: column;
}
.bs-header {
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px 0; flex-shrink: 0;
}
.bs-title { font-size: 28px; font-weight: 600; color: var(--color-text); letter-spacing: -0.6px; }

.bs-tabs { display: flex; gap: 1px; padding: 24px 20px 0; justify-content: center; flex-shrink: 0; }
.bs-tab {
  padding: 8px 20px; background: transparent; border: none; border-bottom: 2px solid transparent;
  font-size: 13px; font-weight: 600; font-family: inherit; color: var(--color-text-muted); cursor: pointer; transition: all 0.15s;
}
.bs-tab:hover { color: var(--color-text-secondary); }
.bs-tab.active { color: var(--color-text); border-bottom-color: var(--color-text); }

.bs-body { flex: 1; max-width: 520px; margin: 0 auto; padding: 24px 20px 60px; width: 100%; }

.bs-section { }
.bs-section-title { font-size: 15px; font-weight: 600; color: var(--color-text); margin: 0 0 4px; }
.bs-section-desc { font-size: 12px; color: var(--color-text-muted); margin: 0 0 12px; }

.bs-field { margin-bottom: 16px; }
.bs-label { display: block; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 4px; }
.bs-input, .bs-select {
  width: 100%; padding: 8px 10px; background: var(--color-bg); border: 1px solid var(--color-border);
  border-radius: 6px; font-size: 13px; font-family: inherit; color: var(--color-text); outline: none;
}
.bs-input:focus, .bs-select:focus { border-color: var(--color-border-interactive); }
.bs-select { cursor: pointer; }

.bs-checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-text); cursor: pointer; }
.bs-checkbox-label input[type="checkbox"] { accent-color: var(--color-text); }
.bs-hint { font-size: 10px; color: var(--color-text-muted); margin-top: 2px; padding-left: 24px; }

.bs-divider { border: none; border-top: 1px solid var(--color-border); margin: 24px 0; }

.bs-api-info {
  display: flex; flex-direction: column; gap: 4px; padding: 10px;
  background: var(--color-shadow-sm); border-radius: 6px; font-size: 11px; color: var(--color-text-muted);
  margin-top: 16px;
}

.bs-about { padding: 8px 0; }
.bs-about-title { font-size: 28px; font-weight: 600; color: var(--color-text); margin: 0 0 4px; }
.bs-about-version { font-size: 13px; color: var(--color-text-muted); margin: 0 0 12px; }
.bs-about-desc { font-size: 14px; color: var(--color-text-secondary); line-height: 1.5; margin: 0 0 16px; }
.bs-about-links { display: flex; flex-direction: column; gap: 6px; }
.bs-about-item { font-size: 12px; color: var(--color-text-secondary); }
.bs-about-item strong { color: var(--color-text); }
.bs-shortcuts { display: flex; flex-direction: column; gap: 6px; }
.bs-shortcut-row { display: flex; align-items: center; gap: 16px; padding: 6px 10px; background: var(--color-bg-hover); border-radius: 6px; }
.bs-shortcut-row kbd { display: inline-block; padding: 2px 8px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 4px; font-family: monospace; font-size: 11px; color: var(--color-text); min-width: 100px; text-align: center; }
.bs-shortcut-row span { font-size: 12px; color: var(--color-text-secondary); }

.bs-tools-list { display: flex; flex-direction: column; gap: 6px; }
.bs-tool-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; background: var(--color-bg-hover); border-radius: 6px; }
.bs-tool-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.bs-tool-name { font-size: 12px; font-weight: 600; color: var(--color-text); font-family: monospace; }
.bs-tool-desc { font-size: 10px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bs-tool-select { width: 120px; flex-shrink: 0; }

.bs-mcp-list { display: flex; flex-direction: column; gap: 8px; }
.bs-mcp-row { padding: 10px; background: var(--color-bg-hover); border-radius: 6px; }
.bs-mcp-info { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.bs-mcp-name { font-size: 13px; font-weight: 600; color: var(--color-text); font-family: monospace; }
.bs-mcp-cmd { font-size: 11px; color: var(--color-text-muted); font-family: monospace; }
.bs-mcp-status { font-size: 10px; font-weight: 600; text-transform: uppercase; }
.bs-mcp-status.connected { color: #0f6e56; }
.bs-mcp-status.connecting { color: #854f0b; }
.bs-mcp-status.error { color: #a32d2d; }
.bs-mcp-status.disconnected { color: var(--color-text-muted); }
.bs-mcp-error { font-size: 10px; color: #a32d2d; }
.bs-mcp-actions { display: flex; gap: 6px; margin-bottom: 4px; }
.bs-mcp-btn { padding: 4px 12px; font-size: 11px; font-weight: 600; font-family: inherit; background: var(--color-text); color: var(--color-bg); border: none; border-radius: 4px; cursor: pointer; }
.bs-mcp-btn:hover { opacity: 0.85; }
.bs-mcp-btn-danger { background: #a32d2d; }
.bs-mcp-tools { display: flex; flex-wrap: wrap; gap: 4px; }
.bs-mcp-tool-tag { font-size: 10px; padding: 1px 6px; background: rgba(15,110,86,0.08); color: #0f6e56; border-radius: 3px; font-family: monospace; }
.bs-mcp-empty { font-size: 12px; color: var(--color-text-muted); padding: 8px 0; }
.bs-mcp-form { margin-top: 12px; padding: 12px; background: var(--color-bg-hover); border-radius: 6px; }

* { margin: 0; padding: 0; box-sizing: border-box; }
</style>
