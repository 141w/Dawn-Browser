import { ref } from 'vue'

const contextLimits = {
  maxTokens: 128000,
  warnAt: 0.75,
  compactAt: 0.85,
  hardLimitAt: 0.95
}

const contextStats = ref({
  estimatedTokens: 0,
  messageCount: 0,
  toolCallCount: 0,
  turnCount: 0,
  percentUsed: 0,
  needsCompaction: false,
  needsWarning: false
})

const SYSTEM_MSG_OVERHEAD = 200
const AVG_MSG_OVERHEAD = 50

function estimateTokens(messages) {
  let total = SYSTEM_MSG_OVERHEAD
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

function estimateMessageTokens(msg) {
  let tokens = AVG_MSG_OVERHEAD
  if (msg.content) {
    if (typeof msg.content === 'string') {
      tokens += Math.ceil(msg.content.length / 3.5)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') tokens += Math.ceil((block.text?.length || 0) / 3.5)
        if (block.type === 'image') tokens += 500
        if (block.type === 'tool_use') tokens += Math.ceil(JSON.stringify(block.input || {}).length / 3)
        if (block.type === 'tool_result') tokens += Math.ceil((block.content?.length || 0) / 3.5)
      }
    }
  }
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += 50 + Math.ceil(JSON.stringify(tc.arguments || {}).length / 3)
    }
  }
  return tokens
}

function updateContextStats(messages) {
  const estimatedTokens = estimateTokens(messages)
  const toolCalls = messages.filter(m => m.role === 'assistant' && m.toolCalls?.length > 0)
    .reduce((sum, m) => sum + (m.toolCalls?.length || 0), 0)
  const userMsgs = messages.filter(m => m.role === 'user').length
  const percent = contextLimits.maxTokens > 0 ? estimatedTokens / contextLimits.maxTokens : 0
  const stats = {
    estimatedTokens,
    messageCount: messages.length,
    toolCallCount: toolCalls,
    turnCount: userMsgs,
    percentUsed: Math.round(percent * 100),
    needsCompaction: percent >= contextLimits.compactAt,
    needsWarning: percent >= contextLimits.warnAt
  }
  contextStats.value = stats
  return stats
}

function shouldCompact(messages) {
  const stats = updateContextStats(messages)
  return stats.needsCompaction
}

// Detect context overflow errors from API responses
function isContextOverflowError(e) {
  const msg = (e.message || '').toLowerCase()
  return msg.includes('context_length_exceeded') ||
    msg.includes('maximum context length') ||
    msg.includes('too many tokens') ||
    msg.includes('request_too_large') ||
    msg.includes('input exceeds') ||
    msg.includes('context length') && msg.includes('exceed') ||
    msg.includes('prompt is too long') ||
    msg.includes('413')
}

// Simple fallback compaction (no LLM)
function compactHistorySimple(messages, targetPercent = 0.5) {
  if (messages.length <= 6) return messages
  const targetTokens = Math.floor(contextLimits.maxTokens * targetPercent)
  const estimated = estimateTokens(messages)
  if (estimated <= targetTokens) return messages

  const keepStart = messages[0]?.role === 'system' ? 1 : 0
  const firstUserIdx = messages.findIndex((m, i) => i >= keepStart && m.role === 'user')
  const keepEnd = Math.max(firstUserIdx + 1, messages.length - 6)
  const dropped = messages.slice(keepStart, keepEnd)
  const toolsUsed = [...new Set(dropped.filter(m => m.role === 'tool').map(m => m.name).filter(Boolean))]
  const userMsgs = dropped.filter(m => m.role === 'user')
  const lastDroppedUser = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content?.slice(0, 200) : ''

  let summaryText = '[Context compacted to save tokens.] '
  if (toolsUsed.length > 0) summaryText += `Tools used: ${toolsUsed.join(', ')}. `
  if (lastDroppedUser) summaryText += `Last topic: ${lastDroppedUser.slice(0, 150)}`

  const summaryMsg = { role: 'user', content: summaryText }
  return [
    ...messages.slice(0, keepStart + (firstUserIdx >= keepStart ? 1 : 0)),
    summaryMsg,
    ...messages.slice(keepEnd)
  ]
}

// LLM-based summarization compaction
async function summarizeAndCompact(messages, aiConfig) {
  if (messages.length <= 6) return messages

  const keepStart = messages[0]?.role === 'system' ? 1 : 0
  const firstUserIdx = messages.findIndex((m, i) => i >= keepStart && m.role === 'user')
  const keepEnd = Math.max(firstUserIdx + 1, messages.length - 6)

  const oldMessages = messages.slice(keepStart, keepEnd)
  const recentMessages = messages.slice(keepEnd)

  // Try LLM summarization
  let summaryText = ''
  try {
    summaryText = await callLLMForSummary(oldMessages, aiConfig)
  } catch (e) {
    console.warn('[ContextManager] LLM summarization failed, using simple compaction:', e.message)
    return compactHistorySimple(messages)
  }

  const summaryMsg = { role: 'user', content: `[Compacted conversation summary]\n${summaryText}` }
  const prefix = messages[0]?.role === 'system' ? [messages[0]] : []

  return [...prefix, summaryMsg, ...recentMessages]
}

async function callLLMForSummary(messages, aiConfig) {
  if (!aiConfig || !aiConfig.apiKey) throw new Error('No API config')

  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant'
      const content = typeof m.content === 'string' ? m.content : ''
      let line = `${role}: ${content.substring(0, 300)}`
      if (m.toolCalls?.length > 0) {
        line += ` [used tools: ${m.toolCalls.map(tc => tc.name).join(', ')}]`
      }
      return line
    })
    .join('\n')
    .substring(0, 4000)

  const prompt = `Compress the following conversation into a structured summary. Preserve:
1. User key requirements and preferences
2. Important decisions made
3. Unfinished tasks
4. Key tool call results (omit details)

Output format:
## Conversation Summary
- [key point 1]
- [key point 2]
...

## Unfinished Tasks
- [task 1] (or "None")

## User Preferences Noted
- [preference 1] (or "None")

Conversation:
${conversationText}`

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
      max_tokens: 800
    })
  })

  if (!response.ok) throw new Error(`API error ${response.status}`)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || '[Summary generation failed]'
}

function setContextLimit(tokens) {
  if (tokens > 0) contextLimits.maxTokens = tokens
}

function getContextLimits() {
  return { ...contextLimits }
}

function getToolLoopConfig() {
  return {
    maxRounds: 8,
    warningThreshold: 3,
    criticalThreshold: 5,
    circuitBreakerThreshold: 8,
    historySize: 20
  }
}

function detectToolLoop(toolCallHistory) {
  if (toolCallHistory.length < 3) return null
  const recent = toolCallHistory.slice(-10)
  const counts = {}
  for (const call of recent) { counts[call.name] = (counts[call.name] || 0) + 1 }
  for (const [name, count] of Object.entries(counts)) {
    if (count >= 5) return { level: count >= 8 ? 'critical' : 'warning', tool: name, count, message: `Tool "${name}" called ${count} times - possible loop` }
  }
  const pairs = recent.slice(-4)
  if (pairs.length >= 4) {
    const p1 = pairs.slice(0, 2).map(p => p.name).join(',')
    const p2 = pairs.slice(2, 4).map(p => p.name).join(',')
    if (p1 === p2) return { level: 'warning', tool: p1, count: 2, message: `Ping-pong pattern: ${p1}` }
  }
  const last5 = recent.slice(-5)
  const l5c = {}
  for (const c of last5) { l5c[c.name] = (l5c[c.name] || 0) + 1 }
  for (const [name, count] of Object.entries(l5c)) {
    if (count >= 3) return { level: 'warning', tool: name, count, message: `Tool "${name}" called ${count} times in last 5` }
  }
  return null
}

export function useContextManager() {
  return {
    contextStats, contextLimits, estimateTokens, updateContextStats,
    shouldCompact, compactHistory: compactHistorySimple, summarizeAndCompact,
    isContextOverflowError, setContextLimit, getContextLimits,
    getToolLoopConfig, detectToolLoop
  }
}