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
  if (messages.length <= 6) return messages

  const targetTokens = Math.floor(contextLimits.maxTokens * targetPercent)
  const estimated = estimateTokens(messages)

  if (estimated <= targetTokens) return messages

  const compacted = [...messages]

  // Keep: system msg (index 0), first user msg, last 6 messages
  const keepStart = compacted[0]?.role === 'system' ? 1 : 0
  const firstUserIdx = compacted.findIndex((m, i) => i >= keepStart && m.role === 'user')
  const keepEnd = Math.max(firstUserIdx + 1, compacted.length - 6)

  // Extract summary from dropped middle section
  const dropped = compacted.slice(keepStart, keepEnd)
  const toolsUsed = [...new Set(dropped.filter(m => m.role === 'tool').map(m => m.name).filter(Boolean))]
  const userMsgs = dropped.filter(m => m.role === 'user')
  const lastDroppedUser = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content?.slice(0, 200) : ''

  let summaryText = '[Context compacted to save tokens.] '
  if (toolsUsed.length > 0) summaryText += `Tools used: ${toolsUsed.join(', ')}. `
  if (lastDroppedUser) summaryText += `Last topic: ${lastDroppedUser.slice(0, 150)}`

  const summaryMsg = { role: 'user', content: summaryText }

  // Build: system + first user + summary + last 6 messages
  const result = [
    ...compacted.slice(0, keepStart + (firstUserIdx >= keepStart ? 1 : 0)),
    summaryMsg,
    ...compacted.slice(keepEnd)
  ]

  return result
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

  // Same tool 3+ times in last 5 calls (tighter window)
  const last5 = recent.slice(-5)
  const last5Counts = {}
  for (const call of last5) {
    last5Counts[call.name] = (last5Counts[call.name] || 0) + 1
  }
  for (const [name, count] of Object.entries(last5Counts)) {
    if (count >= 3) {
      return {
        level: 'warning',
        tool: name,
        count,
        message: `Tool "${name}" called ${count} times in last 5 calls - likely stuck in a loop`
      }
    }
  }

  // 3+ distinct tools called in rapid succession (likely alternating loop)
  if (recent.length >= 6) {
    const last6 = recent.slice(-6)
    const uniqueTools = new Set(last6.map(c => c.name))
    if (uniqueTools.size >= 3) {
      const allRecent = last6.every(c => Date.now() - c.time < 10000)
      if (allRecent) {
        return {
          level: 'warning',
          tool: [...uniqueTools].join(', '),
          count: last6.length,
          message: `${last6.length} rapid tool calls across ${uniqueTools.size} different tools - possible multi-tool loop`
        }
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
