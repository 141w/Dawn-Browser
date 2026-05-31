import { ref } from 'vue'

const activePlan = ref(null)
const planHistory = ref([])
const MAX_PLAN_HISTORY = 50

function createPlan(task) {
  const plan = {
    id: 'plan_' + Date.now().toString(36),
    task: task.slice(0, 200),
    steps: [],
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    currentStepIndex: -1,
    results: {}
  }
  activePlan.value = plan
  return plan
}

function updatePlan(steps) {
  if (!activePlan.value) return
  if (!Array.isArray(steps) || steps.length === 0) return

  const existingSteps = activePlan.value.steps
  const existingMap = new Map(existingSteps.map((s, i) => [s.step, { step: s, index: i }]))

  const mergedSteps = []
  const seenNew = new Set()

  for (const incoming of steps) {
    const key = incoming.step?.trim()
    if (!key || seenNew.has(key)) continue
    seenNew.add(key)

    const existing = existingMap.get(key)
    if (existing) {
      mergedSteps.push({ ...existing.step, status: existing.step.status || incoming.status || 'pending' })
    } else {
      mergedSteps.push({
        step: key,
        status: incoming.status || 'pending',
        createdAt: Date.now()
      })
    }
  }

  for (const oldStep of existingSteps) {
    if (!seenNew.has(oldStep.step)) {
      mergedSteps.push(oldStep)
    }
  }

  const inProgressCount = mergedSteps.filter(s => s.status === 'in_progress').length
  if (inProgressCount > 1) {
    let found = false
    for (const step of mergedSteps) {
      if (step.status === 'in_progress') {
        if (found) {
          step.status = 'pending'
        } else {
          found = true
        }
      }
    }
  }

  activePlan.value.steps = mergedSteps
  activePlan.value.updatedAt = Date.now()

  const firstInProgress = mergedSteps.findIndex(s => s.status === 'in_progress')
  activePlan.value.currentStepIndex = firstInProgress >= 0 ? firstInProgress : -1
}

function setStepStatus(stepIndex, status) {
  if (!activePlan.value || !activePlan.value.steps[stepIndex]) return
  activePlan.value.steps[stepIndex].status = status
  activePlan.value.steps[stepIndex].updatedAt = Date.now()
  activePlan.value.updatedAt = Date.now()

  if (status === 'in_progress') {
    for (let i = 0; i < activePlan.value.steps.length; i++) {
      if (i !== stepIndex && activePlan.value.steps[i].status === 'in_progress') {
        activePlan.value.steps[i].status = 'completed'
      }
    }
    activePlan.value.currentStepIndex = stepIndex
  }

  const allDone = activePlan.value.steps.every(s =>
    s.status === 'completed' || s.status === 'skipped'
  )
  if (allDone) {
    completePlan()
  }
}

function setStepResult(stepIndex, result) {
  if (!activePlan.value || !activePlan.value.steps[stepIndex]) return
  activePlan.value.results[stepIndex] = typeof result === 'string' ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500)
  activePlan.value.updatedAt = Date.now()
}

function completePlan() {
  if (!activePlan.value) return
  activePlan.value.status = 'completed'
  activePlan.value.completedAt = Date.now()
  planHistory.value.unshift({ ...activePlan.value })
  if (planHistory.value.length > MAX_PLAN_HISTORY) {
    planHistory.value = planHistory.value.slice(0, MAX_PLAN_HISTORY)
  }
  activePlan.value = null
}

function abortPlan() {
  if (!activePlan.value) return
  activePlan.value.status = 'aborted'
  activePlan.value.completedAt = Date.now()
  planHistory.value.unshift({ ...activePlan.value })
  if (planHistory.value.length > MAX_PLAN_HISTORY) {
    planHistory.value = planHistory.value.slice(0, MAX_PLAN_HISTORY)
  }
  activePlan.value = null
}

function getActivePlan() {
  return activePlan
}

function getPlanSummary() {
  if (!activePlan.value) return null
  const steps = activePlan.value.steps
  const completed = steps.filter(s => s.status === 'completed').length
  const total = steps.length
  return {
    task: activePlan.value.task,
    completed,
    total,
    currentStep: activePlan.value.currentStepIndex >= 0
      ? steps[activePlan.value.currentStepIndex]?.step : null,
    steps,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0
  }
}

function getPlanToolDefinition() {
  return {
    name: 'update_plan',
    description: 'Update the execution plan. Break complex tasks into ordered steps. Exactly one step may be in_progress at a time. Mark steps as completed when done.',
    parameters: {
      type: 'object',
      properties: {
        explanation: { type: 'string', description: 'Brief note about plan changes' },
        plan: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: 'Short plan step description' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'skipped'] }
            },
            required: ['step', 'status']
          },
          minItems: 1
        }
      },
      required: ['plan']
    }
  }
}



// Sub-Agent Engine
// Provides spawnSubAgent() which creates a mini agent loop with limited tools
let _subAgentDepth = 0
const MAX_SUB_AGENT_DEPTH = 1

async function spawnSubAgent(task, allowedTools, maxRounds, streamFn, cfg) {
  if (_subAgentDepth >= MAX_SUB_AGENT_DEPTH) {
    return { error: 'Sub-agent recursion limit reached', summary: '' }
  }
  _subAgentDepth++

  try {
    const { useToolSystem } = await import('./useToolSystem')
    const { getTool, executeTool } = useToolSystem()

    // Build sub-agent system prompt
    const systemPrompt = 'You are a focused sub-agent. Complete the assigned task efficiently using the available tools. When done, provide a clear and concise summary of your findings. Do not ask questions - just execute and report.'

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ]

    let totalToolCalls = 0

    for (let round = 0; round < maxRounds; round++) {
      const assistantMsg = { role: 'assistant', content: '', toolCalls: [] }
      messages.push(assistantMsg)

      // Build API messages
      const apiMessages = [{ role: 'system', content: systemPrompt }]
      for (const m of messages.slice(1)) {
        if (m.role === 'user') {
          apiMessages.push({ role: 'user', content: m.content })
        } else if (m.role === 'assistant') {
          if (m.toolCalls && m.toolCalls.length > 0) {
            apiMessages.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) } })) })
          } else if (m.content) {
            apiMessages.push({ role: 'assistant', content: m.content })
          }
        } else if (m.role === 'tool') {
          apiMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
        }
      }

      // Prepare tools for sub-agent
      const subTools = allowedTools.map(name => {
        const tool = getTool(name)
        if (!tool) return null
        return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters || { type: 'object', properties: {} } } }
      }).filter(Boolean)

      // Call streaming
      const baseUrl = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const url = baseUrl + '/chat/completions'
      const headers = { 'Content-Type': 'application/json' }
      if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model || 'gpt-4o-mini',
          messages: apiMessages,
          tools: subTools.length > 0 ? subTools : undefined,
          temperature: 0.3,
          max_tokens: 2048
        })
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error('Sub-agent API error: ' + response.status + ' ' + err.substring(0, 200))
      }

      const data = await response.json()
      const choice = data.choices?.[0]
      if (!choice) break

      assistantMsg.content = choice.message?.content || ''

      const toolCalls = choice.message?.tool_calls || []
      if (toolCalls.length === 0) break

      assistantMsg.toolCalls = toolCalls.map(tc => ({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments }))

      // Execute tool calls
      for (const tc of toolCalls) {
        let args = {}
        try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
        const result = await executeTool(tc.function?.name, args)
        const raw = result.error || (typeof result.result === 'object' ? JSON.stringify(result.result) : String(result.result ?? ''))
        messages.push({ role: 'tool', toolCallId: tc.id, name: tc.function?.name, content: raw.substring(0, 3000) })
        totalToolCalls++
      }
    }

    // Extract final summary
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
    const summary = lastAssistant?.content || 'Sub-agent completed with no output.'

    return {
      summary: summary.substring(0, 2000),
      toolCallsCount: totalToolCalls,
      roundsUsed: Math.min(maxRounds, messages.filter(m => m.role === 'assistant').length)
    }
  } catch (e) {
    return { error: e.message, summary: 'Sub-agent failed: ' + e.message }
  } finally {
    _subAgentDepth--
  }
}

// Expose to window for tool system access
if (typeof window !== 'undefined') {
  window.__dawnSubAgent = (task, tools, maxRounds) => {
    // Import config dynamically to avoid circular deps
    const cfg = JSON.parse(localStorage.getItem('dawn-ai-config') || '{}')
    return spawnSubAgent(task, tools, maxRounds, null, cfg)
  }
}

export function useAgentLoop() {
  return {
    activePlan,
    planHistory,
    createPlan,
    updatePlan,
    setStepStatus,
    setStepResult,
    completePlan,
    abortPlan,
    getActivePlan,
    getPlanSummary,
    getPlanToolDefinition
  }
}
