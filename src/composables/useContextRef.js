import { ref } from 'vue'

const contextRefs = ref([])

const REF_TYPES = [
  { type: 'page', trigger: 'page', aliases: ['当前页面', '页面', 'page', 'current'], label: 'Current Page', icon: 'page', desc: '引用当前页面内容' },
  { type: 'screenshot', trigger: 'screen', aliases: ['截图', '屏幕', 'screenshot', 'capture'], label: 'Screenshot', icon: 'camera', desc: '捕获当前页面截图' },
  { type: 'selection', trigger: 'select', aliases: ['选中', '选中文本', 'selection', 'selected'], label: 'Selection', icon: 'select', desc: '引用页面选中文本' },
]

function addContextRef(type, data) {
  const def = REF_TYPES.find(r => r.type === type)
  if (!def) return

  contextRefs.value.push({
    id: 'ctx_' + Date.now().toString(36),
    type,
    label: data.label || def.label,
    icon: def.icon,
    content: data.content || '',
    preview: data.preview || '',
    meta: data.meta || {},
  })
}

function removeContextRef(id) {
  contextRefs.value = contextRefs.value.filter(r => r.id !== id)
}

function clearContextRefs() {
  contextRefs.value = []
}

function getContextPrompt() {
  if (contextRefs.value.length === 0) return ''
  const parts = []
  for (const ref of contextRefs.value) {
    if (ref.type === 'tab') {
      parts.push(`[Open Tab] ${ref.label || ref.title || ''}\nURL: ${ref.url || ref.preview || ''}`)
    } else if (ref.type === 'page') {
      parts.push(`[Webpage] ${ref.meta?.title || ref.label} (${ref.meta?.url || ref.preview})\n\n${(ref.content || '').slice(0, 2000)}`)
    } else if (ref.type === 'selection') {
      parts.push(`[Selection] ${ref.content || ''}`)
    } else if (ref.type === 'screenshot') {
      parts.push('[Screenshot attached]')
    }
  }
  return parts.join('\n\n---\n\n')
}

function searchRefTypes(query) {
  if (!query) return REF_TYPES
  const q = query.toLowerCase()
  return REF_TYPES.filter(t =>
    t.aliases.some(a => a.toLowerCase().includes(q))
  )
}

export function useContextRef() {
  return {
    contextRefs,
    REF_TYPES,
    addContextRef,
    removeContextRef,
    clearContextRefs,
    getContextPrompt,
    searchRefTypes,
  }
}
