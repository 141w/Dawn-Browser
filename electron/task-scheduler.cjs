const { ipcMain, Notification } = require('electron')
const cron = require('node-cron')

class TaskScheduler {
  constructor() {
    this._tasks = new Map()
    this._cronJobs = new Map()
    this._queue = []
    this._running = false
    this._currentTask = null
  }

  addTask(task) {
    const id = task.id || 'sched_' + Date.now().toString(36)
    const entry = {
      id,
      name: task.name || 'Untitled task',
      goal: task.goal || '',
      prompt: task.prompt || task.goal || '',
      status: 'pending',
      cron: task.cron || null,
      priority: task.priority || 5,
      createdAt: Date.now(),
      lastRunAt: null,
      lastResult: null,
    }
    this._tasks.set(id, entry)
    this._queue.push(entry)
    this._queue.sort((a, b) => a.priority - b.priority)

    if (entry.cron && cron.validate(entry.cron)) {
      const job = cron.schedule(entry.cron, () => {
        this._runTask(id)
      })
      this._cronJobs.set(id, job)
    }

    this._processQueue()
    return entry
  }

  removeTask(id) {
    this._tasks.delete(id)
    this._queue = this._queue.filter(t => t.id !== id)
    const job = this._cronJobs.get(id)
    if (job) { job.stop(); this._cronJobs.delete(id) }
  }

  pauseTask(id) {
    const task = this._tasks.get(id)
    if (task) task.status = 'paused'
  }

  resumeTask(id) {
    const task = this._tasks.get(id)
    if (task && task.status === 'paused') {
      task.status = 'pending'
      this._processQueue()
    }
  }

  async _runTask(id) {
    const task = this._tasks.get(id)
    if (!task || task.status === 'running') return
    task.status = 'running'
    task.lastRunAt = Date.now()
    this._currentTask = id

    // Notify renderer
    this._broadcast('scheduler:task-updated', this.getTask(id))

    // The actual execution is delegated to the renderer via IPC event
    // The renderer picks up the prompt and runs it through the AI chat loop
    try {
      this._broadcast('scheduler:execute', { id: task.id, prompt: task.prompt, goal: task.goal })
    } catch {}

    // Note: status will be set to 'done' or 'failed' by markTaskDone/markTaskFailed
  }

  markTaskDone(id, result) {
    const task = this._tasks.get(id)
    if (!task) return
    task.status = 'done'
    task.lastResult = result || 'Completed'
    if (this._currentTask === id) this._currentTask = null
    this._broadcast('scheduler:task-updated', this.getTask(id))
    this._showNotification(task.name, 'Task completed')
    this._processQueue()
  }

  markTaskFailed(id, error) {
    const task = this._tasks.get(id)
    if (!task) return
    task.status = 'failed'
    task.lastResult = error || 'Failed'
    if (this._currentTask === id) this._currentTask = null
    this._broadcast('scheduler:task-updated', this.getTask(id))
    this._showNotification(task.name, 'Task failed: ' + (error || '').substring(0, 100))
    this._processQueue()
  }

  _processQueue() {
    if (this._running || this._currentTask) return
    const next = this._queue.find(t => t.status === 'pending')
    if (!next) return
    this._running = true
    this._runTask(next.id).finally(() => { this._running = false })
  }

  getTask(id) {
    return this._tasks.get(id) || null
  }

  listTasks() {
    return Array.from(this._tasks.values())
  }

  _broadcast(channel, data) {
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      if (win && !win.isDestroyed()) {
        try { win.webContents.send(channel, data) } catch {}
      }
    }
  }

  _showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: `Dawn: ${title}`, body, silent: false }).show()
      }
    } catch {}
  }

  stopAll() {
    for (const [, job] of this._cronJobs) { try { job.stop() } catch {} }
    this._cronJobs.clear()
  }
}

const taskScheduler = new TaskScheduler()

function registerTaskSchedulerIpc() {
  ipcMain.handle('scheduler:add-task', async (_event, task) => {
    return taskScheduler.addTask(task)
  })

  ipcMain.handle('scheduler:remove-task', async (_event, id) => {
    taskScheduler.removeTask(id)
    return { success: true }
  })

  ipcMain.handle('scheduler:pause-task', async (_event, id) => {
    taskScheduler.pauseTask(id)
    return { success: true }
  })

  ipcMain.handle('scheduler:resume-task', async (_event, id) => {
    taskScheduler.resumeTask(id)
    return { success: true }
  })

  ipcMain.handle('scheduler:mark-done', async (_event, id, result) => {
    taskScheduler.markTaskDone(id, result)
    return { success: true }
  })

  ipcMain.handle('scheduler:mark-failed', async (_event, id, error) => {
    taskScheduler.markTaskFailed(id, error)
    return { success: true }
  })

  ipcMain.handle('scheduler:list-tasks', async () => {
    return taskScheduler.listTasks()
  })

  ipcMain.handle('scheduler:get-task', async (_event, id) => {
    return taskScheduler.getTask(id)
  })
}

module.exports = { taskScheduler, registerTaskSchedulerIpc }
