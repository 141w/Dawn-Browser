const { ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')

let Database = null
let db = null

function getDbPath() {
  const userData = app.getPath('userData')
  return path.join(userData, 'agent-memory.db')
}

async function ensureDb() {
  if (db) return db
  try {
    Database = require('better-sqlite3')
  } catch (e) {
    console.error('[AgentMemory] better-sqlite3 not available:', e.message)
    return null
  }
  const dbPath = getDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      input TEXT,
      output TEXT,
      ts INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `)
  console.log('[AgentMemory] DB ready at', dbPath)
  return db
}

function createTask(id, goal) {
  if (!db) return null
  const now = Date.now()
  db.prepare('INSERT INTO tasks (id, goal, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, goal, 'running', now, now)
  return { id, goal, status: 'running', created_at: now, updated_at: now }
}

function addStep(taskId, tool, input, output) {
  if (!db) return null
  const now = Date.now()
  const result = db.prepare('INSERT INTO steps (task_id, tool, input, output, ts) VALUES (?, ?, ?, ?, ?)').run(taskId, tool, typeof input === 'string' ? input : JSON.stringify(input), typeof output === 'string' ? output : JSON.stringify(output), now)
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId)
  return { id: result.lastInsertRowid, task_id: taskId, tool, input, output, ts: now }
}

function updateTaskStatus(taskId, status) {
  if (!db) return
  const now = Date.now()
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, now, taskId)
}

function getTask(taskId) {
  if (!db) return null
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
}

function getTaskSteps(taskId) {
  if (!db) return []
  return db.prepare('SELECT * FROM steps WHERE task_id = ? ORDER BY ts ASC').all(taskId)
}

function listTasks(status, limit = 50) {
  if (!db) return []
  if (status) {
    return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC LIMIT ?').all(status, limit)
  }
  return db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?').all(limit)
}

function deleteTask(taskId) {
  if (!db) return
  db.prepare('DELETE FROM steps WHERE task_id = ?').run(taskId)
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
}

function closeDb() {
  if (db) { try { db.close() } catch {} db = null }
}

function registerAgentMemoryIpc() {
  ipcMain.handle('agent-memory:ensure', async () => {
    const d = await ensureDb()
    return !!d
  })

  ipcMain.handle('agent-memory:create-task', async (_event, id, goal) => {
    return createTask(id, goal)
  })

  ipcMain.handle('agent-memory:add-step', async (_event, taskId, tool, input, output) => {
    return addStep(taskId, tool, input, output)
  })

  ipcMain.handle('agent-memory:update-task', async (_event, taskId, status) => {
    updateTaskStatus(taskId, status)
    return { success: true }
  })

  ipcMain.handle('agent-memory:get-task', async (_event, taskId) => {
    const task = getTask(taskId)
    if (task) task.steps = getTaskSteps(taskId)
    return task
  })

  ipcMain.handle('agent-memory:list-tasks', async (_event, status, limit) => {
    return listTasks(status, limit)
  })

  ipcMain.handle('agent-memory:delete-task', async (_event, taskId) => {
    deleteTask(taskId)
    return { success: true }
  })
}

module.exports = { ensureDb, createTask, addStep, updateTaskStatus, getTask, getTaskSteps, listTasks, deleteTask, closeDb, registerAgentMemoryIpc }
