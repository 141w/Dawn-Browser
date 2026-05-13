import { ref } from 'vue'

// Shared reactive store of currently open browser tabs
const browserTabs = ref([])
const activeTabId = ref(null)

function setTabs(tabs) { browserTabs.value = tabs || [] }
function setActiveTab(id) { activeTabId.value = id }

function getTabByUrl(url) {
  return browserTabs.value.find(t => t.url === url)
}

function getOpenPageRefs() {
  return browserTabs.value
    .filter(t => t.url && !t.url.startsWith('dawn://'))
    .map(t => ({
      id: t.id,
      type: 'tab',
      label: (t.title || t.url || 'Untitled').slice(0, 50),
      preview: t.url,
      icon: 'page',
      url: t.url,
      title: t.title
    }))
}

export function useBrowserTabs() {
  return {
    browserTabs,
    activeTabId,
    setTabs,
    setActiveTab,
    getTabByUrl,
    getOpenPageRefs
  }
}
