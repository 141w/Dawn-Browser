import { ref } from 'vue'

const tabGroups = ref([])
const tabSidebarOpen = ref(false)

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
    tabGroups,
    tabSidebarOpen,
    PRESET_CATEGORIES,
    classifyTab,
    createGroup,
    deleteGroup,
    addTabToGroup,
    removeTabFromGroup,
    autoGroupTabs,
    getGroupSummary,
    toggleSidebar,
    loadTabGroups,
    saveTabGroups,
  }
}
