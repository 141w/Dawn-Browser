import { ref } from 'vue'

const tasks = ref([])
const memories = ref([])
const dailyNotes = ref([])
let _initialized = false
let _promotionTimer = null

// ─── Helpers ───

function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return 'q' + Math.abs(hash).toString(36)
}

function extractKeywords(text) {
  if (!text) return []
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'this',
    'that', 'it', 'its', 'i', 'me', 'my', 'you', 'your', 'he', 'she',
    'we', 'they', 'what', 'when', 'how', 'who', 'which', 'and', 'or',
    'but', 'not', 'so', 'if', 'then', 'than', 'just', 'also', 'more',
    'some', 'any', 'all', 'very', 'here', 'there', 'now', 'then',
    'please', 'help', 'want', 'need', 'use', 'make', 'get', 'go', 'come',
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has',
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那',
    '就', '都', '和', '与', '或', '但', '不', '也', '还', '很', '着', '过',
    '把', '被', '让', '给', '从', '到', '对', '为', '会', '能', '可以', '要',
    '有', '没', '什么', '怎么', '吗', '呢', '吧', '啊'
  ])
  return text
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
    .slice(0, 15)
}

// ─── Init ───

async function ensureDb() {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryEnsure) return false
  return window.electronAPI.agentMemoryEnsure()
}

// ─── Tasks ───

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

// ─── Memory CRUD ───

async function loadMemories(limit = 100) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryListMemories) return
  try {
    memories.value = await window.electronAPI.agentMemoryListMemories(limit)
  } catch {}
}

async function addMemory(content, tags = '', sourceConvId = '', type = 'short-term') {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryAddMemory) return null
  const result = await window.electronAPI.agentMemoryAddMemory(content, tags, sourceConvId, type)
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

// ─── Active Memory: Search + Inject ───

async function searchMemories(keywords, limit = 20) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemorySearchMemories) return []
  try {
    return await window.electronAPI.agentMemorySearchMemories(keywords, limit)
  } catch { return [] }
}

async function recordRecalls(memoryList, query) {
  if (!memoryList || memoryList.length === 0) return
  const queryHash = simpleHash(query)
  for (const mem of memoryList) {
    try {
      await window.electronAPI.agentMemoryRecordRecall(mem.id, query, queryHash)
    } catch {}
  }
}

async function getMemoriesForPrompt(userMessage, limit = 20) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemorySearchMemories) return ''
  try {
    const keywords = extractKeywords(userMessage)
    const mems = keywords.length > 0
      ? await window.electronAPI.agentMemorySearchMemories(keywords, limit)
      : await window.electronAPI.agentMemoryListMemories(limit)
    if (!mems || mems.length === 0) return ''

    // Record recalls (fire-and-forget, non-blocking)
    const queryHash = simpleHash(userMessage)
    for (const mem of mems) {
      window.electronAPI.agentMemoryRecordRecall(mem.id, userMessage, queryHash).catch(() => {})
    }

    const lines = mems.map(m => `- ${m.content}`)
    return `\n\n## User Memory (from previous conversations)\nThe following are known user preferences and facts. Respect them:\n${lines.join('\n')}`
  } catch { return '' }
}

// ─── Memory Flush: Extract memories from conversation ───

function extractHeuristic(messages) {
  const patterns = [
    /(?:我喜欢|我希望|请总是|总是|记住|以后|从现在开始|我不喜欢|请不要|帮我记住|记一下|备注)[，:：\s]*(.+?)(?:[。！\n]|$)/gi,
    /(?:I want|I prefer|please always|remember|from now on|I don't like|please don't|keep in mind|note that)[:\s]+(.+?)(?:[.!?\n]|$)/gi,
  ]
  const results = []
  const userMessages = messages.filter(m => m.role === 'user')
  for (const msg of userMessages) {
    if (!msg.content) continue
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(msg.content)) !== null) {
        const content = match[1].trim()
        if (content.length > 3 && content.length < 300) results.push(content)
      }
    }
  }
  return [...new Set(results)]
}

async function extractViaLLM(conv, aiConfig) {
  if (!aiConfig || !aiConfig.apiKey) return []
  try {
    const conversationText = conv.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${(m.content || '').substring(0, 300)}`)
      .join('\n')
      .substring(0, 3000)

    const prompt = `From the following conversation, extract the user's key preferences, habits, and important facts. Only extract explicitly stated information that would be useful in future conversations. Output a JSON array where each item has {content: string, tags: string}. If nothing worth extracting, output [].\n\n${conversationText}`

    const baseUrl = (aiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const url = baseUrl + '/chat/completions'
    const headers = { 'Content-Type': 'application/json' }
    if (aiConfig.apiKey) headers['Authorization'] = `Bearer ${aiConfig.apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: aiConfig.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      })
    })

    if (!response.ok) return []
    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || ''

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && item.content && typeof item.content === 'string')
      .map(item => item.content.trim())
      .filter(c => c.length > 3 && c.length < 300)
  } catch (e) {
    console.warn('[AgentMemory] LLM extraction failed:', e.message)
    return []
  }
}

async function flushConversationMemory(conv, aiConfig) {
  if (!conv || !conv.messages || conv.messages.length < 2) return []

  // Phase 1: Heuristic extraction (zero cost)
  const heuristicResults = extractHeuristic(conv.messages)

  // Phase 2: LLM extraction for longer conversations
  let llmResults = []
  if (conv.messages.length >= 10 && aiConfig && aiConfig.apiKey) {
    llmResults = await extractViaLLM(conv, aiConfig)
  }

  // Deduplicate and save
  const allResults = [...new Set([...heuristicResults, ...llmResults])]
  const saved = []
  for (const content of allResults) {
    try {
      const result = await addMemory(content, 'auto-extract', conv.id, 'short-term')
      if (result) saved.push(content)
    } catch {}
  }

  // Save daily note
  if (saved.length > 0) {
    try {
      const today = new Date().toISOString().slice(0, 10)
      await saveDailyNote(today, conv.title || 'Untitled', saved)
    } catch {}
  }

  return saved
}

// ─── Daily Notes ───

async function saveDailyNote(dateStr, title, entries) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemorySaveDailyNote) return
  return window.electronAPI.agentMemorySaveDailyNote(dateStr, title, entries)
}

async function loadDailyNotes(days = 7) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryGetDailyNotes) return
  try {
    dailyNotes.value = await window.electronAPI.agentMemoryGetDailyNotes(days)
  } catch {}
}

async function readDailyNote(dateStr) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryReadDailyNote) return null
  return window.electronAPI.agentMemoryReadDailyNote(dateStr)
}

// ─── Promotion ───

async function promoteMemories(cfg) {
  if (typeof window === 'undefined' || !window.electronAPI?.agentMemoryPromoteMemories) return { promoted: 0 }
  return window.electronAPI.agentMemoryPromoteMemories(cfg)
}

async function runPromotionCheck() {
  try {
    const result = await promoteMemories({
      minRecallCount: 3,
      minUniqueQueries: 2,
      minScore: 0.5,
      maxAge: 7 * 24 * 3600000
    })
    if (result && result.promoted > 0) {
      console.log(`[AgentMemory] Promoted ${result.promoted} memories to long-term`)
      await loadMemories()
    }
    return result
  } catch { return { promoted: 0 } }
}

// ─── Init ───

async function init() {
  if (_initialized) return
  _initialized = true
  await ensureDb()
  await loadTasks()
  await loadMemories()
  await loadDailyNotes()

  // Run promotion check after 5 minutes, then every 30 minutes
  setTimeout(() => {
    runPromotionCheck()
    _promotionTimer = setInterval(runPromotionCheck, 30 * 60 * 1000)
  }, 5 * 60 * 1000)
}

export function useAgentMemory() {
  init()
  return {
    tasks, memories, dailyNotes,
    ensureDb, loadTasks, createTask, addStep, updateTaskStatus, getTask, deleteTask,
    loadMemories, addMemory, deleteMemory, clearMemories,
    searchMemories, recordRecalls, getMemoriesForPrompt,
    extractHeuristic, extractViaLLM, flushConversationMemory,
    loadDailyNotes, readDailyNote, saveDailyNote,
    promoteMemories, runPromotionCheck, extractKeywords, init
  }
}