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
