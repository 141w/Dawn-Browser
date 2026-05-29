import { ref } from 'vue'

const tasks = ref([])
let _onExecuteCb = null
let _onUpdateCb = null
let _initialized = false

function _handleExecute(_event, data) {
  if (_onExecuteCb) _onExecuteCb(data)
}

function _handleUpdate(_event, task) {
  const idx = tasks.value.findIndex(t => t.id === task.id)
  if (idx >= 0) {
    tasks.value[idx] = task
  } else {
    tasks.value.push(task)
  }
  if (_onUpdateCb) _onUpdateCb(task)
}

async function addTask(task) {
  if (!window.electronAPI?.schedulerAddTask) return null
  const result = await window.electronAPI.schedulerAddTask(task)
  await refresh()
  return result
}

async function removeTask(id) {
  if (!window.electronAPI?.schedulerRemoveTask) return
  await window.electronAPI.schedulerRemoveTask(id)
  await refresh()
}

async function pauseTask(id) {
  if (!window.electronAPI?.schedulerPauseTask) return
  await window.electronAPI.schedulerPauseTask(id)
  await refresh()
}

async function resumeTask(id) {
  if (!window.electronAPI?.schedulerResumeTask) return
  await window.electronAPI.schedulerResumeTask(id)
  await refresh()
}

async function markDone(id, result) {
  if (!window.electronAPI?.schedulerMarkDone) return
  await window.electronAPI.schedulerMarkDone(id, result)
  await refresh()
}

async function markFailed(id, error) {
  if (!window.electronAPI?.schedulerMarkFailed) return
  await window.electronAPI.schedulerMarkFailed(id, error)
  await refresh()
}

async function refresh() {
  if (!window.electronAPI?.schedulerListTasks) return
  try {
    tasks.value = await window.electronAPI.schedulerListTasks()
  } catch {}
}

function onExecute(cb) {
  _onExecuteCb = cb
}

function onUpdate(cb) {
  _onUpdateCb = cb
}

export function useTaskScheduler() {
  if (!_initialized) {
    _initialized = true
    if (window.electronAPI?.on) {
      window.electronAPI.on('scheduler:execute', _handleExecute)
      window.electronAPI.on('scheduler:task-updated', _handleUpdate)
    }
    refresh()
  }

  return {
    tasks, addTask, removeTask, pauseTask, resumeTask,
    markDone, markFailed, refresh, onExecute, onUpdate
  }
}
