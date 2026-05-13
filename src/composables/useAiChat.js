import { ref, computed, toRaw } from 'vue'
import { useAiConfig } from './useAiConfig'
import { useToolSystem } from './useToolSystem'
import { useAgentLoop } from './useAgentLoop'
import { useContextManager } from './useContextManager'
import { useAutonomousBrowser } from './useAutonomousBrowser'
import { loadConversationsFromDB, saveConversationsToDB } from './useMemory'
import { useSkillSystem } from './useSkillSystem'

const conversations = ref([])
const activeConvId = ref(null)
const isStreaming = ref(false)
const streamError = ref(null)
const pendingToolCalls = ref([])
const toolConfirmRequired = ref(null)
const agentState = ref('idle')
let abortController = null
let toolCallHistory = []
let _loadPromise = null
let _saveQueue = Promise.resolve()

function enqueueSave(fn) {
  _saveQueue = _saveQueue.then(fn).catch(() => {})
  return _saveQueue
}

async function loadConversations() {
  if (_loadPromise) return _loadPromise
  _loadPromise = (async () => {
    try {
      const dbConvs = await loadConversationsFromDB()
      if (dbConvs.length > 0) {
        // Merge: keep any convs already created (e.g. by createConversation) on top
        const existingIds = new Set(conversations.value.map(c => c.id))
        const newFromDb = dbConvs.filter(c => !existingIds.has(c.id))
        conversations.value = [...conversations.value, ...newFromDb]
        if (!activeConvId.value && conversations.value.length > 0) {
          activeConvId.value = conversations.value[0].id
        }
      }
    } catch {}
    // Migrate from old localStorage if DB is empty
    if (conversations.value.length === 0) {
      const saved = localStorage.getItem('dawn-ai-conversations')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.length > 0) {
            conversations.value = parsed
            if (!activeConvId.value) activeConvId.value = parsed[0].id
          }
          localStorage.removeItem('dawn-ai-conversations')
        } catch {}
      }
    }
  })()
  return _loadPromise
}

function sanitizeForStorage(conv) {
  // Strip Vue reactivity with toRaw, then deep clone via JSON to guarantee plain objects
  try {
    const raw = toRaw(conv)
    const plain = JSON.parse(JSON.stringify(raw))
    return {
      id: plain.id, title: plain.title, createdAt: plain.createdAt,
      messages: (plain.messages || []).map(m => ({
        role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content || '').slice(0, 2000),
        images: undefined,
        slashCmd: m.slashCmd || undefined,
        slashPrompt: m.slashPrompt || undefined,
        toolCalls: m.toolCalls ? m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) })) : undefined,
        name: m.name, toolCallId: m.toolCallId,
      }))
    }
  } catch {
    return { id: conv.id, title: conv.title, createdAt: conv.createdAt, messages: [] }
  }
}

function saveConversations() {
  return enqueueSave(async () => {
    try {
      const clean = conversations.value.map(sanitizeForStorage)
      await saveConversationsToDB(clean)
    } catch {
      try { localStorage.setItem('dawn-ai-conversations', JSON.stringify(conversations.value)) } catch {}
    }
  })
}

function createConversation() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const conv = { id, title: 'New Chat', messages: [], createdAt: Date.now() }
  conversations.value.unshift(conv)
  activeConvId.value = id
  return id
}

function deleteConversation(id) {
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (activeConvId.value === id) {
    activeConvId.value = conversations.value.length > 0 ? conversations.value[0].id : null
  }
  saveConversations()
}

function getActiveConversation() {
  return computed(() => conversations.value.find(c => c.id === activeConvId.value))
}

function updateTitle(convId) {
  const conv = conversations.value.find(c => c.id === convId)
  if (conv && conv.messages.length > 0) {
    const firstUserMsg = conv.messages.find(m => m.role === 'user')
    if (firstUserMsg) {
      conv.title = firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')
    }
  }
}

async function sendMessage(content, pageContext = null, images = null, slashCmd = null, displayContent = null) {
  try {
  if (!content.trim()) {
    console.warn('[Dawn] sendMessage skipped: empty content')
    return
  }
  if (isStreaming.value) {
    console.error('[Dawn] sendMessage BLOCKED: isStreaming is still true — auto-resetting to recover')
    isStreaming.value = false
    agentState.value = 'idle'
    if (abortController) { abortController.abort(); abortController = null }
  }

  const { config, getEffectiveModel, getEffectiveBaseUrl, getApiFormat } = useAiConfig()
  const { getToolsForProvider, executeTool, resolvePermission } = useToolSystem()
  const { createPlan, getPlanToolDefinition } = useAgentLoop()
  const { updateContextStats, shouldCompact, compactHistory, detectToolLoop, getToolLoopConfig } = useContextManager()
  const { addToTrail } = useAutonomousBrowser()

  if (!activeConvId.value) createConversation()
  const conv = conversations.value.find(c => c.id === activeConvId.value)
  if (!conv) return

  let userContent = content.trim()
  if (pageContext) {
    const ctx = `\n\n[Page Context]\nTitle: ${pageContext.title}\nURL: ${pageContext.url}`
    userContent += ctx
  }

  // Only enter agent mode for explicit multi-step / browsing requests
  const isComplex = /搜索|对比|分析并|找到.*所有|每个|多个|全部|research|compare.*and|find.*all|analyze.*each|open.*and.*read|go to|visit.*and|browse.*and/i.test(userContent)

  if (isComplex) {
    createPlan(userContent)
  }

  // Determine what's displayed vs what's sent to the AI
  const uiContent = (displayContent !== null && displayContent !== undefined) ? displayContent : userContent
  const msg = { role: 'user', content: uiContent }
  if (images && images.length > 0) msg.images = images
  if (slashCmd) {
    msg.slashCmd = slashCmd
    msg.slashPrompt = userContent  // The full prompt, hidden from UI but sent to AI
  }
  conv.messages.push(msg)
  updateTitle(conv.id)

  isStreaming.value = true
  agentState.value = 'thinking'
  streamError.value = null
  pendingToolCalls.value = []
  toolCallHistory = []
  abortController = new AbortController()

  const format = getApiFormat()
  const baseUrl = getEffectiveBaseUrl()
  const model = getEffectiveModel()
  const apiKey = config.value.apiKey

  const { formatSkillsForPrompt, skills } = useSkillSystem()

  const baseSystemPrompt = config.value.systemPrompt || 'You are a helpful assistant.'
  const skillsPrompt = formatSkillsForPrompt(skills.value)
  const systemPrompt = baseSystemPrompt + skillsPrompt

  const agentSystemPrompt = isComplex ? `You are a browser agent. You have tools to read pages, navigate, click, fill forms, and more. When the user gives you a task:

1. Use read_current_page to understand the current page context
2. Plan your steps with update_plan for complex tasks
3. Execute tools one at a time, verifying each result
4. When done, provide a clear summary of what you accomplished

IMPORTANT:
- Only use tools when necessary for the task
- Read pages before clicking or filling
- If a tool fails, try an alternative approach
- Always report results clearly, don't just keep calling tools` : systemPrompt

  const allTools = isComplex ? getToolsForProvider(format) : []

  const planTool = getPlanToolDefinition()
  if (isComplex) {
    if (format === 'anthropic') {
      allTools.push({ name: planTool.name, description: planTool.description, input_schema: planTool.parameters })
    } else if (format === 'google') {
      allTools.push({ name: planTool.name, description: planTool.description, parameters: planTool.parameters })
    } else {
      allTools.push({ type: 'function', function: { name: planTool.name, description: planTool.description, parameters: planTool.parameters } })
    }
  }

  try {
    await runAgentLoop(conv, format, baseUrl, apiKey, model, agentSystemPrompt, allTools, config.value, executeTool, resolvePermission, format, updateContextStats, shouldCompact, compactHistory, detectToolLoop, getToolLoopConfig)
  } catch (e) {
    if (e.name !== 'AbortError') {
      streamError.value = e.message
    }
  } finally {
    isStreaming.value = false
    agentState.value = 'idle'
    abortController = null
    await saveConversations()
  }
  } catch (e) {
    console.error('[Dawn] sendMessage error:', e.message, e.stack)
    streamError.value = e.message
    isStreaming.value = false
    agentState.value = 'idle'
    abortController = null
  }
}

async function runAgentLoop(conv, format, baseUrl, apiKey, model, systemPrompt, tools, cfg, executeTool, resolvePermission, providerFormat, updateCtx, shouldCompactFn, compactHistoryFn, detectLoop, getLoopCfg) {
  const loopCfg = getLoopCfg()
  const MAX_TOOL_ROUNDS = loopCfg.maxRounds

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (abortController?.signal.aborted) break

    const loopResult = detectLoop(toolCallHistory)
    if (loopResult) {
      if (loopResult.level === 'critical') {
        conv.messages.push({ role: 'assistant', content: `I've detected I may be stuck in a loop (${loopResult.message}). Let me reconsider my approach.`, toolCalls: [] })
        break
      } else if (loopResult.level === 'warning') {
        conv.messages.push({ role: 'assistant', content: `I notice I've been calling "${loopResult.tool}" repeatedly. Let me adjust my strategy.`, toolCalls: [] })
      }
    }

    const allMessages = conv.messages
    updateCtx(allMessages)

    if (shouldCompactFn(allMessages)) {
      conv.messages = compactHistoryFn(allMessages)
    }

    const apiMessages = buildApiMessages(conv, systemPrompt, format)
    const assistantMsg = { role: 'assistant', content: '', toolCalls: [] }
    conv.messages.push(assistantMsg)

    let toolCalls = []

    agentState.value = toolCallHistory.length > 0 ? 'executing' : 'thinking'

    if (round === 0 && toolCallHistory.length === 0) {
      const cacheKey = getCacheKey(cfg.provider, model, conv.messages.slice(0, -1))
      const cached = getCachedResponse(cacheKey)
      if (cached && cached.content) {
        assistantMsg.content = cached.content
        assistantMsg.toolCalls = cached.toolCalls || []
        agentState.value = 'idle'
        break
      }
    }

    if (format === 'anthropic') {
      toolCalls = await streamAnthropic(baseUrl, apiKey, model, apiMessages, cfg, assistantMsg, tools, abortController.signal)
    } else if (format === 'google') {
      toolCalls = await streamGoogle(baseUrl, apiKey, model, apiMessages, cfg, assistantMsg, tools, abortController.signal)
    } else {
      toolCalls = await streamOpenAI(baseUrl, apiKey, model, apiMessages, cfg, assistantMsg, tools, abortController.signal)
    }

    if (toolCalls.length === 0) {
      agentState.value = 'idle'
      const cacheKey = getCacheKey(cfg.provider, model, conv.messages.filter(m => m.role === 'user'))
      if (cacheKey && assistantMsg.content) {
        cacheResponse(cacheKey, assistantMsg.content, null)
      }
      break
    }

    assistantMsg.toolCalls = toolCalls
    pendingToolCalls.value = toolCalls

    for (const tc of toolCalls) {
      let args = tc.arguments
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { args = {} }
      }
      if (!args) args = {}

      toolCallHistory.push({ name: tc.name, args: typeof args === 'string' ? args.slice(0, 100) : JSON.stringify(args).slice(0, 100), time: Date.now() })
      if (toolCallHistory.length > loopCfg.historySize) {
        toolCallHistory = toolCallHistory.slice(-loopCfg.historySize)
      }

      if (tc.name === 'update_plan') {
        const { updatePlan } = useAgentLoop()
        const steps = args?.plan || []
        if (Array.isArray(steps) && steps.length > 0) {
          updatePlan(steps)
        }
      }

      if (tc.name === 'autonomous_navigate' || tc.name === 'visit_page' || tc.name === 'navigate_to') {
        const { addToTrail } = useAutonomousBrowser()
        addToTrail({ action: tc.name, url: args?.url || '', args })
      }

      const execResult = await executeTool(tc.name, args)

      if (execResult.confirmRequired) {
        toolConfirmRequired.value = {
          toolCallId: tc.id,
          toolName: tc.name,
          toolArgs: args,
          resolve: null
        }
        const confirmed = await new Promise((resolve) => {
          toolConfirmRequired.value.resolve = resolve
        })
        if (!confirmed) {
          conv.messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: `Tool "${tc.name}" was denied.` })
          toolConfirmRequired.value = null
          continue
        }
        toolConfirmRequired.value = null
        const reResult = await executeTool(tc.name, args)
        execResult.result = reResult.result
        execResult.error = reResult.error
      }

      const toolContent = execResult.error
        || (typeof execResult.result === 'object' && (execResult.result.type === 'image' || execResult.result.requestSummary)
            ? execResult.result.content || JSON.stringify(execResult.result)
            : String(execResult.result || ''))

      conv.messages.push({
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        content: toolContent
      })
    }

    pendingToolCalls.value = []
  }
}

function buildApiMessages(conv, systemPrompt, format) {
  const msgs = [{ role: 'system', content: systemPrompt }]

  for (const m of conv.messages) {
    if (m.role === 'user') {
      // Combine slash prompt (hidden from UI) with visible content for the AI
      const effectiveContent = m.slashPrompt
        ? (m.slashPrompt + (m.content ? '\n\n' + m.content : ''))
        : m.content
      if (m.images && m.images.length > 0 && format === 'anthropic') {
        const contentBlocks = [{ type: 'text', text: effectiveContent }]
        for (const img of m.images) {
          if (img.startsWith('data:image/')) {
            const mediaType = img.match(/^data:(image\/\w+);/)?.[1] || 'image/png'
            const base64 = img.split(',')[1]
            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 }
            })
          }
        }
        msgs.push({ role: 'user', content: contentBlocks })
      } else if (m.images && m.images.length > 0 && format === 'openai') {
        const contentBlocks = [{ type: 'text', text: effectiveContent }]
        for (const img of m.images) {
          contentBlocks.push({ type: 'image_url', image_url: { url: img } })
        }
        msgs.push({ role: 'user', content: contentBlocks })
      } else {
        msgs.push({ role: 'user', content: effectiveContent })
      }
    } else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        if (format === 'openai') {
          msgs.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
              }
            }))
          })
        } else if (format === 'anthropic') {
          const contentBlocks = []
          if (m.content) contentBlocks.push({ type: 'text', text: m.content })
          for (const tc of m.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : (tc.arguments || {})
            })
          }
          msgs.push({ role: 'assistant', content: contentBlocks })
        }
      } else if (m.content) {
        if (format === 'anthropic') {
          msgs.push({ role: 'assistant', content: [{ type: 'text', text: m.content }] })
        } else {
          msgs.push({ role: 'assistant', content: m.content })
        }
      }
    } else if (m.role === 'tool') {
      if (format === 'openai') {
        msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
      } else if (format === 'anthropic') {
        msgs.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
        })
      }
    }
  }

  return msgs
}

async function streamOpenAI(baseUrl, apiKey, model, messages, cfg, assistantMsg, tools, signal) {
  let url = baseUrl.replace(/\/+$/, '')
  if (!url.endsWith('/chat/completions')) url += '/chat/completions'
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body = {
    model, messages, stream: true,
    temperature: cfg.temperature || 0.7,
    max_tokens: cfg.maxTokens || 4096,
    tools: tools.length > 0 ? tools : undefined
  }

  console.log('[Dawn] API request:', url, 'model:', model)
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!response.ok) {
    const err = await response.text()
    console.error('[Dawn] API error:', response.status, url, err)
    throw new Error(`API error (${response.status}): ${err}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCallsMap = {}

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue
      try {
        const json = JSON.parse(trimmed.slice(6))
        const choice = json.choices?.[0]
        if (!choice) continue

        if (choice.delta?.content) assistantMsg.content += choice.delta.content
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const id = tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            if (!toolCallsMap[id]) toolCallsMap[id] = { id, name: tc.function?.name || '', arguments: '' }
            if (tc.function?.name) toolCallsMap[id].name = tc.function.name
            if (tc.function?.arguments) toolCallsMap[id].arguments += tc.function.arguments
          }
        }
        if (choice.finish_reason === 'tool_calls') break
      } catch {}
    }
  }

  return Object.values(toolCallsMap)
}

async function streamAnthropic(baseUrl, apiKey, model, messages, cfg, assistantMsg, tools, signal) {
  let url = baseUrl.replace(/\/+$/, '')
  if (!url.endsWith('/messages')) url += '/messages'
  const systemMsg = messages.find(m => m.role === 'system')
  const chatMessages = messages.filter(m => m.role !== 'system')

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  }

  const body = {
    model, messages: chatMessages, stream: true,
    max_tokens: cfg.maxTokens || 4096,
    temperature: cfg.temperature || 0.7
  }
  if (systemMsg) body.system = systemMsg.content
  if (tools.length > 0) body.tools = tools

  console.log('[Dawn] API request (Anthropic):', url, 'model:', model)
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!response.ok) {
    const err = await response.text()
    console.error('[Dawn] API error (Anthropic):', response.status, url, err)
    throw new Error(`API error (${response.status}): ${err}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const accumulatedToolCalls = []
  let currentToolUse = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      try {
        const json = JSON.parse(trimmed.slice(6))

        if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
          currentToolUse = { id: json.content_block.id, name: json.content_block.name, arguments: '' }
        }
        if (json.type === 'content_block_delta') {
          if (json.delta?.type === 'text_delta' && json.delta?.text) {
            assistantMsg.content += json.delta.text
          }
          if (json.delta?.type === 'input_json_delta' && json.delta?.partial_json && currentToolUse) {
            currentToolUse.arguments += json.delta.partial_json
          }
        }
        if (json.type === 'content_block_stop' && currentToolUse) {
          try { currentToolUse.arguments = JSON.parse(currentToolUse.arguments) } catch {}
          accumulatedToolCalls.push(currentToolUse)
          currentToolUse = null
        }
      } catch {}
    }
  }

  return accumulatedToolCalls
}

async function streamGoogle(baseUrl, apiKey, model, messages, cfg, assistantMsg, tools, signal) {
  const url = `${baseUrl.replace(/\/+$/, '')}/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`

  const contents = messages
    .filter(m => m.role !== 'system' && m.role !== 'tool')
    .map(m => {
      if (m.role === 'assistant' && m.toolCalls?.length > 0) {
        const parts = []
        if (m.content) parts.push({ text: m.content })
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : (tc.arguments || {})
            }
          })
        }
        return { role: 'model', parts }
      }
      if (m.role === 'tool') {
        return {
          role: 'function',
          parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }]
        }
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }
    })

  const systemInstruction = messages.find(m => m.role === 'system')
  const body = {
    contents,
    generationConfig: { temperature: cfg.temperature || 0.7, maxOutputTokens: cfg.maxTokens || 4096 },
    tools: [{ functionDeclarations: tools }]
  }
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction.content }] }

  console.log('[Dawn] API request (Google):', url, 'model:', model)
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal
  })
  if (!response.ok) {
    const err = await response.text()
    console.error('[Dawn] API error (Google):', response.status, url, err)
    throw new Error(`API error (${response.status}): ${err}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCalls = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      try {
        const json = JSON.parse(trimmed.slice(6))
        const parts = json.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
          if (part.text) assistantMsg.content += part.text
          if (part.functionCall) {
            toolCalls.push({
              id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args || {}
            })
          }
        }
      } catch {}
    }
  }

  return toolCalls
}

function stopStreaming() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  isStreaming.value = false
}

function confirmToolCall(approved) {
  if (toolConfirmRequired.value?.resolve) {
    toolConfirmRequired.value.resolve(approved)
  }
}

function editMessage(convId, msgIndex, newContent) {
  const conv = conversations.value.find(c => c.id === convId)
  if (!conv || !newContent.trim()) return
  const msg = conv.messages[msgIndex]
  if (!msg || msg.role !== 'user') return
  msg.content = newContent.trim()
  conv.messages = conv.messages.slice(0, msgIndex + 1)
  saveConversations()
}

function regenerateResponse(convId) {
  const conv = conversations.value.find(c => c.id === convId)
  if (!conv || conv.messages.length < 1) return
  let lastUserIdx = -1
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].role === 'user') { lastUserIdx = i; break }
  }
  if (lastUserIdx === -1) return
  const lastUserMsg = conv.messages[lastUserIdx]
  conv.messages = conv.messages.slice(0, lastUserIdx + 1)
  saveConversations()
  const content = lastUserMsg.content
  const images = lastUserMsg.images || null
  lastUserMsg.images = undefined
  sendMessage(content, null, images)
}

function branchConversation(convId, fromMsgIndex) {
  const conv = conversations.value.find(c => c.id === convId)
  if (!conv) return null
  const newId = createConversation()
  const newConv = conversations.value.find(c => c.id === newId)
  if (newConv) {
    newConv.messages = conv.messages.slice(0, fromMsgIndex + 1).map(m => JSON.parse(JSON.stringify(m)))
    newConv.title = conv.title + ' (fork)'
    activeConvId.value = newId
    saveConversations()
  }
  return newId
}

function exportAsMarkdown(convId) {
  const conv = conversations.value.find(c => c.id === convId)
  if (!conv) return ''
  const date = new Date(conv.createdAt).toLocaleString()
  let md = `# ${conv.title}\n\n_${date}_\n\n---\n\n`
  for (const msg of conv.messages) {
    if (msg.role === 'user') {
      md += `**You:**\n${msg.content}\n\n`
      if (msg.images && msg.images.length > 0) {
        md += `> _(${msg.images.length} screenshot(s) attached)_\n\n`
      }
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        md += `**Assistant** _(used tools: ${msg.toolCalls.map(tc => tc.name).join(', ')})_:\n`
      } else {
        md += `**Assistant:**\n`
      }
      if (msg.content) md += `${msg.content}\n\n`
    } else if (msg.role === 'tool') {
      md += `> _Tool \`${msg.name}\`: ${msg.content?.substring(0, 200)}_\n\n`
    }
  }
  md += `\n---\n_Exported from Dawn AI_`
  return md
}

function exportAsHtml(convId) {
  const md = exportAsMarkdown(convId)
  if (!md) return ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Dawn AI Export</title>
<style>
  body { max-width:720px; margin:40px auto; font:15px/1.6 system-ui,sans-serif; color:#1c1c1c; background:#f7f4ed; padding:0 24px; }
  h1 { font-size:22px; border-bottom:1px solid #eceae4; padding-bottom:8px; }
  blockquote { border-left:3px solid #eceae4; margin:0; padding-left:12px; color:#5f5f5d; }
  code { background:rgba(28,28,28,0.05); padding:2px 5px; border-radius:3px; font-size:13px; }
  pre { background:rgba(28,28,28,0.05); padding:12px; border-radius:8px; overflow-x:auto; }
  hr { border:none; border-top:1px solid #eceae4; margin:24px 0; }
  strong { color:#1c1c1c; }
</style></head>
<body>${md.replace(/\n/g, '<br>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>').replace(/`([^`]+)`/g, '<code>$1</code>')}</body></html>`
}

const responseCache = new Map()
const CACHE_MAX = 200

function getCacheKey(provider, model, messages) {
  const lastUserIdx = messages.reduce((idx, m, i) => m.role === 'user' ? i : idx, -1)
  if (lastUserIdx < 0) return null
  let key = provider + '|' + model + '|' + messages[lastUserIdx].content?.slice(0, 200)
  for (let i = lastUserIdx - 1; i >= 0 && i >= lastUserIdx - 3; i--) {
    if (messages[i].role === 'assistant') {
      key += '|' + (messages[i].content || '').slice(0, 100)
      break
    }
  }
  return key
}

function cacheResponse(key, content, toolCalls) {
  if (!key || !content) return
  responseCache.set(key, { content, toolCalls, time: Date.now() })
  if (responseCache.size > CACHE_MAX) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].time - b[1].time)[0]
    if (oldest) responseCache.delete(oldest[0])
  }
}

function getCachedResponse(key) {
  if (!key) return null
  const entry = responseCache.get(key)
  if (entry && Date.now() - entry.time < 600000) return entry
  if (entry) responseCache.delete(key)
  return null
}

export function useAiChat() {
  loadConversations()

  return {
    conversations,
    activeConvId,
    isStreaming,
    streamError,
    pendingToolCalls,
    toolConfirmRequired,
    agentState,
    getActiveConversation,
    createConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    saveConversations,
    confirmToolCall,
    editMessage,
    regenerateResponse,
    branchConversation,
    exportAsMarkdown,
    exportAsHtml,
    getCacheKey,
    cacheResponse,
    getCachedResponse,
    responseCache
  }
}
