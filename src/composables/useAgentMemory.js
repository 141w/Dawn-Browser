import { ref } from 'vue'

const tasks = ref([])
const memories = ref([])
let _initialized = false

async function ensureDb() {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryEnsure) return false
  return window.electronAPI.agentMemoryEnsure()
}

async function loadTasks(status, limit = 50) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryListTasks) return
  try {
    tasks.value = await window.electronAPI.agentMemoryListTasks(status, limit)
  } catch {}
}

async function createTask(id, goal) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryCreateTask) return null
  const task = await window.electronAPI.agentMemoryCreateTask(id, goal)
  await loadTasks()
  return task
}

async function addStep(taskId, tool, input, output) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryAddStep) return null
  return window.electronAPI.agentMemoryAddStep(taskId, tool, input, output)
}

async function updateTaskStatus(taskId, status) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryUpdateTask) return
  await window.electronAPI.agentMemoryUpdateTask(taskId, status)
  await loadTasks()
}

async function getTask(taskId) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryGetTask) return null
  return window.electronAPI.agentMemoryGetTask(taskId)
}

async function deleteTask(taskId) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryDeleteTask) return
  await window.electronAPI.agentMemoryDeleteTask(taskId)
  await loadTasks()
}

// ── Memory functions ──

async function loadMemories(limit = 100) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryListMemories) return
  try {
    memories.value = await window.electronAPI.agentMemoryListMemories(limit)
  } catch {}
}

async function addMemory(content, tags = '', sourceConvId = '') {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryAddMemory) return null
  const result = await window.electronAPI.agentMemoryAddMemory(content, tags, sourceConvId)
  await loadMemories()
  return result
}

async function deleteMemory(id) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryDeleteMemory) return
  await window.electronAPI.agentMemoryDeleteMemory(id)
  await loadMemories()
}

async function clearMemories() {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryClearMemories) return
  await window.electronAPI.agentMemoryClearMemories()
  memories.value = []
}

async function getMemoriesForPrompt(limit = 20) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryListMemories) return ''
  try {
    const mems = await window.electronAPI.agentMemoryListMemories(limit)
    if (!mems || mems.length === 0) return ''
    const lines = mems.map(m => `- ${m.content}`)
    return `\n\n## User Memory (from previous conversations)\nThe following are known user preferences and facts. Respect them:\n${lines.join('\n')}`
  } catch { return '' }
}

async function extractMemoriesFromConversation(messages) {
  if (!messages || messages.length < 4) return // Need at least 2 exchanges
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryListMemories) return

  // Build conversation summary for extraction
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 500) : ''}`)
    .join('\n')
    .substring(0, 4000)

  // Heuristic extraction: look for preference patterns
  const patterns = [
    /(?:我|我想要?|我希望|请(?:总是|一直|每次)|以后|从现在开始|记住)[：:]\s*(.+?)(?:\n|$)/gi,
    /(?:I want|I prefer|please always|remember|from now on)[:\s]+(.+?)(?:\n|$)/gi,
  ]

  const extracted = []
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(conversationText)) !== null) {
      const content = match[1].trim()
      if (content.length > 5 && content.length < 200) {
        extracted.push(content)
      }
    }
  }

  // Save extracted memories
  for (const content of extracted) {
    // Check if similar memory already exists
    const existing = memories.value.find(m => m.content === content)
    if (!existing) {
      await addMemory(content, 'auto-extract', '')
    }
  }
}

async function init() {
  if (_initialized) return
  _initialized = true
  await ensureDb()
  await loadTasks()
  await loadMemories()
}

export function useAgentMemory() {
  init()
  return {
    tasks, memories, ensureDb, loadTasks, createTask, addStep,
    updateTaskStatus, getTask, deleteTask,
    loadMemories, addMemory, deleteMemory, clearMemories,
    getMemoriesForPrompt, extractMemoriesFromConversation, init
  }
}