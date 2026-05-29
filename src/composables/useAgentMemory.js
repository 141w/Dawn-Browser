import { ref } from 'vue'

const tasks = ref([])
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

async function init() {
  if (_initialized) return
  _initialized = true
  await ensureDb()
  await loadTasks()
}

export function useAgentMemory() {
  init()
  return {
    tasks, ensureDb, loadTasks, createTask, addStep,
    updateTaskStatus, getTask, deleteTask, init
  }
}
