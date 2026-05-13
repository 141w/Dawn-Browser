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
  const assistantMsgs = messages.filter(m => m.role === 'assistant').length
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

function compactHistory(messages, targetPercent = 0.5) {
  if (messages.length <= 4) return messages

  const targetTokens = Math.floor(contextLimits.maxTokens * targetPercent)
  const estimated = estimateTokens(messages)

  if (estimated <= targetTokens) return messages

  const summaryPrompt = `[Previous conversation summary - context compacted to save token space. Key points retained below.]`

  const compacted = [...messages]

  let keepStart = 0
  let keepEnd = messages.length - 1

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system' || i < 2) {
      keepStart = i + 1
      continue
    }
    break
  }

  for (let i = messages.length - 1; i > keepStart; i--) {
    if (messages[i].role === 'user' || messages[i].role === 'assistant') {
      keepEnd = i
      break
    }
  }

  const toRemove = [{
    role: 'user',
    content: summaryPrompt
  }]

  const remaining = [
    ...compacted.slice(0, keepStart),
    ...toRemove,
    ...compacted.slice(keepEnd)
  ]

  return remaining
}

function setContextLimit(tokens) {
  if (tokens > 0) contextLimits.maxTokens = tokens
}

function getContextLimits() {
  return { ...contextLimits }
}

function getToolLoopConfig() {
  return {
    maxRounds: 10,
    warningThreshold: 5,
    criticalThreshold: 8,
    circuitBreakerThreshold: 12,
    historySize: 20
  }
}

function detectToolLoop(toolCallHistory) {
  if (toolCallHistory.length < 3) return null

  const recent = toolCallHistory.slice(-10)
  const counts = {}
  for (const call of recent) {
    counts[call.name] = (counts[call.name] || 0) + 1
  }

  for (const [name, count] of Object.entries(counts)) {
    if (count >= 5) {
      return {
        level: count >= 8 ? 'critical' : 'warning',
        tool: name,
        count,
        message: `Tool "${name}" called ${count} times in recent history - possible loop detected`
      }
    }
  }

  const pairs = recent.slice(-4)
  if (pairs.length >= 4) {
    const names = pairs.map(p => p.name).join(',')
    const pattern1 = pairs.slice(0, 2).map(p => p.name).join(',')
    const pattern2 = pairs.slice(2, 4).map(p => p.name).join(',')
    if (pattern1 === pattern2) {
      return {
        level: 'warning',
        tool: pattern1,
        count: 2,
        message: `Ping-pong pattern detected: ${pattern1} repeated`
      }
    }
  }

  return null
}

export function useContextManager() {
  return {
    contextStats,
    contextLimits,
    estimateTokens,
    updateContextStats,
    shouldCompact,
    compactHistory,
    setContextLimit,
    getContextLimits,
    getToolLoopConfig,
    detectToolLoop
  }
}
