import { ref } from 'vue'
import { callAI, parseAIJson } from './useAiHelper'
import { useAiConfig } from './useAiConfig'
import { storeApi } from './useStore'

const tabGroups = ref([])
const tabSidebarOpen = ref(false)
const isAiGrouping = ref(false)
const aiGroupError = ref(null)
let _storeSynced = false

const PRESET_CATEGORIES = [
  { key: 'dev', label: '开发文档', patterns: ['github.com', 'gitlab.com', 'stackoverflow.com', 'docs.', 'api.', 'npmjs.com'] },
  { key: 'report', label: '行业报告', patterns: ['report', 'research', 'analysis', 'arxiv', 'paper', '统计', '报告'] },
  { key: 'product', label: '产品官网', patterns: ['.com', '.cn', '.io', '.org', 'product', 'www.'] },
  { key: 'social', label: '社交媒体', patterns: ['twitter.com', 'x.com', 'weibo.com', 'reddit.com', 'bilibili.com', 'zhihu.com'] },
  { key: 'video', label: '视频媒体', patterns: ['youtube.com', 'bilibili.com/video', 'netflix.com', 'twitch.tv', 'vimeo.com'] },
  { key: 'shopping', label: '购物', patterns: ['amazon', 'taobao', 'jd.com', 'shop', 'buy', 'price', 'mall'] },
  { key: 'email', label: '邮件', patterns: ['mail.google.com', 'outlook', 'webmail', 'gmail'] },
]

function _initStoreSync() {
  if (_storeSynced) return
  _storeSynced = true
  storeApi.onStoreChange('tabGroups', (value) => {
    if (Array.isArray(value)) tabGroups.value = value
  })
}

async function _syncToStore() {
  await storeApi.set('tabGroups', tabGroups.value)
}

function loadTabGroups() {
  _initStoreSync()
  // Prefer store data (cross-window), fall back to localStorage
  storeApi.get('tabGroups').then(stored => {
    if (Array.isArray(stored) && stored.length > 0) {
      tabGroups.value = stored
    } else {
      const saved = localStorage.getItem('dawn-tab-groups')
      tabGroups.value = saved ? JSON.parse(saved) : []
      if (tabGroups.value.length > 0) _syncToStore()
    }
  })
  const savedSidebar = localStorage.getItem('dawn-tab-sidebar-open')
  tabSidebarOpen.value = savedSidebar != null ? savedSidebar === 'true' : true
}

function saveTabGroups() {
  localStorage.setItem('dawn-tab-groups', JSON.stringify(tabGroups.value))
  _syncToStore()
}

function classifyTab(title, url) {
  const text = ((title || '') + ' ' + (url || '')).toLowerCase()
  for (const cat of PRESET_CATEGORIES) {
    for (const pattern of cat.patterns) {
      if (text.includes(pattern)) return cat.key
    }
  }
  return 'other'
}

function createGroup(name, tabIds = [], category = 'custom') {
  const group = {
    id: 'group_' + Date.now().toString(36),
    name,
    tabIds,
    category,
    collapsed: false,
    createdAt: Date.now(),
  }
  tabGroups.value.push(group)
  saveTabGroups()
  return group
}

function renameGroup(id, newName) {
  const group = tabGroups.value.find(g => g.id === id)
  if (group && newName.trim()) {
    group.name = newName.trim()
    saveTabGroups()
  }
}

function deleteGroup(id) {
  tabGroups.value = tabGroups.value.filter(g => g.id !== id)
  saveTabGroups()
}

function addTabToGroup(groupId, tabId) {
  const group = tabGroups.value.find(g => g.id === groupId)
  if (!group) return
  if (!group.tabIds.includes(tabId)) {
    group.tabIds.push(tabId)
    saveTabGroups()
  }
}

function removeTabFromGroup(groupId, tabId) {
  const group = tabGroups.value.find(g => g.id === groupId)
  if (!group) return
  group.tabIds = group.tabIds.filter(id => id !== tabId)
  saveTabGroups()
}

function autoGroupTabs(tabs) {
  tabGroups.value = []
  const uncategorized = []
  for (const tab of tabs) {
    const category = classifyTab(tab.title, tab.url)
    let group = tabGroups.value.find(g => g.category === category)
    if (!group) {
      const preset = PRESET_CATEGORIES.find(p => p.key === category)
      group = createGroup(preset ? preset.label : '其他', [], category)
    }
    group.tabIds.push(tab.id)
  }
  saveTabGroups()
  return tabGroups.value
}

/* ── AI-powered tab grouping ─────────────────────────────── */

async function aiGroupTabs(tabs) {
  isAiGrouping.value = true
  aiGroupError.value = null

  try {
    const { config, getEffectiveModel, getEffectiveBaseUrl, getApiFormat } = useAiConfig()
    const apiKey = config.value.apiKey
    if (!apiKey) throw new Error('API Key not configured')

    const format = getApiFormat()
    const model = getEffectiveModel()
    const baseUrl = getEffectiveBaseUrl()

    const content = await callAI(systemPrompt, userPrompt, { format, model, baseUrl, maxTokens: 1024, temperature: 0.2 })

    // Extract JSON - the model might wrap it in `json ... ` or just return raw JSON
    const json = parseAIJson(content)

    if (!json.groups || !Array.isArray(json.groups)) {
      throw new Error('AI response missing groups array')
    }

    // Convert to our group format
    tabGroups.value = []
    for (const g of json.groups) {
      const group = {
        id: 'ai_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        name: g.name || '未分类',
        tabIds: (g.tabIndices || []).map(i => webTabs[i - 1]?.id).filter(Boolean),
        category: 'ai',
        collapsed: false,
        createdAt: Date.now(),
      }
      tabGroups.value.push(group)
    }

    // Add dawn:// internal tabs under a separate group if any
    const internalTabs = tabs.filter(t => t.url && t.url.startsWith('dawn://'))
    if (internalTabs.length > 0) {
      tabGroups.value.push({
        id: 'ai_internal_' + Date.now().toString(36),
        name: 'Dawn',
        tabIds: internalTabs.map(t => t.id),
        category: 'internal',
        collapsed: true,
        createdAt: Date.now(),
      })
    }

    saveTabGroups()
    return tabGroups.value

  } catch (e) {
    console.error('[TabGroups] AI grouping failed, falling back to pattern:', e.message)
    aiGroupError.value = e.message
    // Fall back to pattern-based grouping
    return autoGroupTabs(tabs)
  } finally {
    isAiGrouping.value = false
  }
}

function getGroupSummary(groupId, tabs) {
  const group = tabGroups.value.find(g => g.id === groupId)
  if (!group) return null
  const groupTabs = tabs.filter(t => group.tabIds.includes(t.id))
  return {
    name: group.name,
    count: groupTabs.length,
    urls: groupTabs.map(t => t.url),
    titles: groupTabs.map(t => t.title),
  }
}

function getUngroupedTabs(tabs) {
  const groupedIds = new Set()
  for (const g of tabGroups.value) {
    for (const id of g.tabIds) groupedIds.add(id)
  }
  return tabs.filter(t => !groupedIds.has(t.id))
}

function toggleSidebar() {
  tabSidebarOpen.value = !tabSidebarOpen.value
  localStorage.setItem('dawn-tab-sidebar-open', tabSidebarOpen.value.toString())
}

export function useTabGroups() {
  loadTabGroups()
  return {
    tabGroups, tabSidebarOpen, isAiGrouping, aiGroupError, PRESET_CATEGORIES,
    classifyTab, createGroup, renameGroup, deleteGroup, addTabToGroup, removeTabFromGroup,
    autoGroupTabs, aiGroupTabs, getGroupSummary, getUngroupedTabs, toggleSidebar,
    loadTabGroups, saveTabGroups,
  }
}
