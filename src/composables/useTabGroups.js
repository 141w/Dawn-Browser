import { ref } from 'vue'
import { useAiConfig } from './useAiConfig'

const tabGroups = ref([])
const tabSidebarOpen = ref(false)
const isAiGrouping = ref(false)
const aiGroupError = ref(null)

const PRESET_CATEGORIES = [
  { key: 'dev', label: '开发文档', patterns: ['github.com', 'gitlab.com', 'stackoverflow.com', 'docs.', 'api.', 'npmjs.com'] },
  { key: 'report', label: '行业报告', patterns: ['report', 'research', 'analysis', 'arxiv', 'paper', '统计', '报告'] },
  { key: 'product', label: '产品官网', patterns: ['.com', '.cn', '.io', '.org', 'product', 'www.'] },
  { key: 'social', label: '社交媒体', patterns: ['twitter.com', 'x.com', 'weibo.com', 'reddit.com', 'bilibili.com', 'zhihu.com'] },
  { key: 'video', label: '视频媒体', patterns: ['youtube.com', 'bilibili.com/video', 'netflix.com', 'twitch.tv', 'vimeo.com'] },
  { key: 'shopping', label: '购物', patterns: ['amazon', 'taobao', 'jd.com', 'shop', 'buy', 'price', 'mall'] },
  { key: 'email', label: '邮件', patterns: ['mail.google.com', 'outlook', 'webmail', 'gmail'] },
]

function loadTabGroups() {
  const saved = localStorage.getItem('dawn-tab-groups')
  tabGroups.value = saved ? JSON.parse(saved) : []
  const savedSidebar = localStorage.getItem('dawn-tab-sidebar-open')
  tabSidebarOpen.value = savedSidebar != null ? savedSidebar === 'true' : true
}

function saveTabGroups() {
  localStorage.setItem('dawn-tab-groups', JSON.stringify(tabGroups.value))
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
    const { config, getEffectiveModel, getEffectiveBaseUrl, getApiFormat, getProvider } = useAiConfig()
    const apiKey = config.value.apiKey
    if (!apiKey) throw new Error('请先在设置中配置 AI API Key')

    const format = getApiFormat()
    const model = getEffectiveModel()
    const baseUrl = getEffectiveBaseUrl()
    const provider = getProvider()

    // Only include web tabs (not dawn:// internal pages)
    const webTabs = tabs.filter(t => t.url && !t.url.startsWith('dawn://'))
    if (webTabs.length < 2) {
      // Too few tabs — fall back to pattern grouping
      return autoGroupTabs(tabs)
    }

    const tabList = webTabs.map((t, i) =>
      `${i + 1}. ${(t.title || 'Untitled').slice(0, 60)} — ${t.url}`
    ).join('\n')

    const systemPrompt = `You are a browser tab organizer. Given a list of open tabs (with titles and URLs), group them into 3–6 meaningful, concise categories. Return ONLY valid JSON — no explanation, no markdown, no code fences.

The JSON must be exactly:
{"groups":[{"name":"Category","tabIndices":[1,3,5]},{"name":"Another","tabIndices":[2,4]}]}

Rules:
- Every tab index must appear in exactly one group
- Keep category names short (1–4 Chinese characters if the tab titles are in Chinese, otherwise English)
- Group by actual topic/domain, not just TLD
- If a tab doesn't fit anywhere, put it in "其他"`

    const userPrompt = `Group these ${webTabs.length} tabs:\n\n${tabList}`

    let content = ''

    if (format === 'anthropic') {
      let url = baseUrl.replace(/\/+$/, '')
      if (!url.endsWith('/messages')) url += '/messages'
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          max_tokens: 1024,
          temperature: 0.2
        })
      })
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`)
      const data = await resp.json()
      content = data.content?.[0]?.text || ''
    } else if (format === 'google') {
      const url = `${baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.2 }
        })
      })
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`)
      const data = await resp.json()
      content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } else {
      // OpenAI / DeepSeek / compatible
      let url = baseUrl.replace(/\/+$/, '')
      if (!url.endsWith('/chat/completions')) url += '/chat/completions'
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1024,
          temperature: 0.2,
          stream: false
        })
      })
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`)
      const data = await resp.json()
      content = data.choices?.[0]?.message?.content || ''
    }

    // Extract JSON — the model might wrap it in ```json ... ``` or just return raw JSON
    let jsonStr = content.trim()
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) jsonStr = fenceMatch[1].trim()
    const json = JSON.parse(jsonStr)

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

function toggleSidebar() {
  tabSidebarOpen.value = !tabSidebarOpen.value
  localStorage.setItem('dawn-tab-sidebar-open', tabSidebarOpen.value.toString())
}

export function useTabGroups() {
  loadTabGroups()
  return {
    tabGroups, tabSidebarOpen, isAiGrouping, aiGroupError, PRESET_CATEGORIES,
    classifyTab, createGroup, renameGroup, deleteGroup, addTabToGroup, removeTabFromGroup,
    autoGroupTabs, aiGroupTabs, getGroupSummary, toggleSidebar,
    loadTabGroups, saveTabGroups,
  }
}
