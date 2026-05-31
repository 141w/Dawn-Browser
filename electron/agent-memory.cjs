const { ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')

let Database = null
let db = null

function getDbPath() {
  const userData = app.getPath('userData')
  return path.join(userData, 'agent-memory.db')
}

function getMemoryDir() {
  return path.join(app.getPath('userData'), 'memory')
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
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '',
      source_conv_id TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      type TEXT DEFAULT 'short-term',
      recall_count INTEGER DEFAULT 0,
      last_recalled_at INTEGER DEFAULT 0,
      query_hashes TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE TABLE IF NOT EXISTS recall_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      query TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      ts INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_recall_log_memory ON recall_log(memory_id);
    CREATE INDEX IF NOT EXISTS idx_recall_log_ts ON recall_log(ts);
  `)

  // Migration: add columns to existing memories table if missing
  try {
    const cols = db.prepare("PRAGMA table_info(memories)").all()
    const colNames = cols.map(c => c.name)
    if (!colNames.includes('type')) {
      db.exec("ALTER TABLE memories ADD COLUMN type TEXT DEFAULT 'short-term'")
    }
    if (!colNames.includes('recall_count')) {
      db.exec('ALTER TABLE memories ADD COLUMN recall_count INTEGER DEFAULT 0')
    }
    if (!colNames.includes('last_recalled_at')) {
      db.exec('ALTER TABLE memories ADD COLUMN last_recalled_at INTEGER DEFAULT 0')
    }
    if (!colNames.includes('query_hashes')) {
      db.exec("ALTER TABLE memories ADD COLUMN query_hashes TEXT DEFAULT '[]'")
    }
  } catch (e) {
    console.warn('[AgentMemory] Migration check:', e.message)
  }

  console.log('[AgentMemory] DB ready at', dbPath)
  return db
}

// ─── Task functions ───

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

// ─── Memory functions ───

function addMemory(content, tags, sourceConvId, type) {
  if (!db) return null
  const now = Date.now()
  const memType = type || 'short-term'
  // Enforce max: 100 short-term, 200 long-term
  if (memType === 'short-term') {
    const count = db.prepare("SELECT COUNT(*) as cnt FROM memories WHERE type = 'short-term'").get()
    if (count && count.cnt >= 100) {
      db.prepare("DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE type = 'short-term' ORDER BY created_at ASC LIMIT ?)").run(count.cnt - 99)
    }
  } else if (memType === 'long-term') {
    const count = db.prepare("SELECT COUNT(*) as cnt FROM memories WHERE type = 'long-term'").get()
    if (count && count.cnt >= 200) {
      db.prepare("DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE type = 'long-term' ORDER BY created_at ASC LIMIT ?)").run(count.cnt - 199)
    }
  }
  const result = db.prepare('INSERT INTO memories (content, tags, source_conv_id, created_at, type) VALUES (?, ?, ?, ?, ?)').run(content, tags || '', sourceConvId || '', now, memType)
  return { id: result.lastInsertRowid, content, tags, source_conv_id: sourceConvId, created_at: now, type: memType }
}

function listMemories(limit) {
  if (!db) return []
  return db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit || 100)
}

function listMemoriesByType(type, limit) {
  if (!db) return []
  return db.prepare('SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ?').all(type, limit || 100)
}

function deleteMemory(id) {
  if (!db) return false
  db.prepare('DELETE FROM recall_log WHERE memory_id = ?').run(id)
  db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  return true
}

function clearMemories() {
  if (!db) return false
  db.prepare('DELETE FROM recall_log').run()
  db.prepare('DELETE FROM memories').run()
  return true
}

// ─── Keyword Search ───

function extractKeywords(text) {
  if (!text) return []
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'this',
    'that', 'it', 'its', 'i', 'me', 'my', 'you', 'your', 'he', 'she',
    'we', 'they', 'what', 'when', 'how', 'who', 'which', 'and', 'or',
    'but', 'not', 'so', 'if', 'then', 'than', 'just', 'also', 'more',
    'some', 'any', 'all', 'very', 'here', 'there', 'now', 'then',
    'please', 'help', 'want', 'need', 'use', 'make', 'get', 'go', 'come',
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那',
    '就', '都', '和', '与', '或', '但', '不', '也', '还', '很', '着', '过',
    '把', '被', '让', '给', '从', '到', '对', '为', '会', '能', '可以', '要',
    '有', '没', '什么', '怎么', '吗', '呢', '吧', '啊'
  ])
  return text
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
    .slice(0, 15)
}

function searchMemories(keywords, limit = 20) {
  if (!db) return []
  if (!keywords || keywords.length === 0) return listMemories(limit)

  const allMems = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT 300').all()
  const scored = []
  const now = Date.now()

  for (const mem of allMems) {
    const content = (mem.content || '').toLowerCase()
    let matchCount = 0
    for (const kw of keywords) {
      if (content.includes(kw.toLowerCase())) matchCount++
    }
    if (matchCount > 0) {
      const typeBoost = mem.type === 'long-term' ? 1.0 : 0.6
      const ageHours = (now - mem.created_at) / 3600000
      const recencyBoost = Math.max(0, 1 - ageHours / (24 * 30))
      const score = (matchCount / keywords.length) * 0.6 + typeBoost * 0.2 + recencyBoost * 0.2
      scored.push({ ...mem, score: Math.round(score * 1000) / 1000 })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ─── Recall Tracking ───

function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return 'q' + Math.abs(hash).toString(36)
}

function recordRecall(memoryId, query, queryHash) {
  if (!db) return
  const now = Date.now()
  try {
    db.prepare('INSERT INTO recall_log (memory_id, query, query_hash, ts) VALUES (?, ?, ?, ?)').run(memoryId, query, queryHash, now)
    // Update memory recall stats
    const mem = db.prepare('SELECT query_hashes FROM memories WHERE id = ?').get(memoryId)
    if (mem) {
      let hashes = []
      try { hashes = JSON.parse(mem.query_hashes || '[]') } catch { hashes = [] }
      if (!hashes.includes(queryHash)) hashes.push(queryHash)
      // Keep only last 32 hashes
      if (hashes.length > 32) hashes = hashes.slice(-32)
      db.prepare('UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ?, query_hashes = ? WHERE id = ?').run(now, JSON.stringify(hashes), memoryId)
    }
  } catch (e) {
    console.warn('[AgentMemory] recordRecall error:', e.message)
  }
}

function getRecallStats(memoryId) {
  if (!db) return null
  const mem = db.prepare('SELECT recall_count, last_recalled_at, query_hashes FROM memories WHERE id = ?').get(memoryId)
  if (!mem) return null
  let queryHashes = []
  try { queryHashes = JSON.parse(mem.query_hashes || '[]') } catch { queryHashes = [] }
  return {
    recall_count: mem.recall_count,
    last_recalled_at: mem.last_recalled_at,
    unique_queries: new Set(queryHashes).size
  }
}

// ─── Promotion: short-term → long-term ───

function promoteMemories(cfg = {}) {
  if (!db) return { promoted: 0 }
  const {
    minRecallCount = 3,
    minUniqueQueries = 2,
    minScore = 0.5,
    maxAge = 7 * 24 * 3600000
  } = cfg

  const candidates = db.prepare(
    'SELECT * FROM memories WHERE type = ? AND recall_count >= ? AND last_recalled_at > ?'
  ).all('short-term', minRecallCount, Date.now() - maxAge)

  let promoted = 0
  const now = Date.now()

  for (const mem of candidates) {
    let queryHashes = []
    try { queryHashes = JSON.parse(mem.query_hashes || '[]') } catch { queryHashes = [] }
    const uniqueQueries = new Set(queryHashes).size
    if (uniqueQueries < minUniqueQueries) continue

    const frequencyScore = Math.min(mem.recall_count / 10, 1) * 0.35
    const diversityScore = Math.min(uniqueQueries / 5, 1) * 0.35
    const recencyScore = Math.max(0, 1 - (now - mem.last_recalled_at) / (30 * 24 * 3600000)) * 0.3
    const totalScore = frequencyScore + diversityScore + recencyScore

    if (totalScore >= minScore) {
      db.prepare("UPDATE memories SET type = 'long-term' WHERE id = ?").run(mem.id)
      promoted++
    }
  }

  return { promoted }
}

// ─── Daily Notes ───

function saveDailyNote(dateStr, title, entries) {
  const dir = getMemoryDir()
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const filePath = path.join(dir, `${dateStr}.md`)
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const entry = `\n## ${time} - ${title}\n${(entries || []).map(e => `- ${e}`).join('\n')}\n`

  try {
    if (fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, entry, 'utf-8')
    } else {
      fs.writeFileSync(filePath, `# ${dateStr}\n${entry}`, 'utf-8')
    }
    return true
  } catch (e) {
    console.warn('[AgentMemory] saveDailyNote error:', e.message)
    return false
  }
}

function getDailyNotes(days = 7) {
  const dir = getMemoryDir()
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const files = []
  try {
    const allFiles = fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, days)
    for (const f of allFiles) {
      const dateStr = f.replace('.md', '')
      const stat = fs.statSync(path.join(dir, f))
      files.push({ date: dateStr, filename: f, size: stat.size, mtime: stat.mtimeMs })
    }
  } catch {}
  return files
}

function readDailyNote(dateStr) {
  const filePath = path.join(getMemoryDir(), `${dateStr}.md`)
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── Close ───

function closeDb() {
  if (db) { try { db.close() } catch {} db = null }
}

// ─── IPC Registration ───

function registerAgentMemoryIpc() {
  ipcMain.handle('agent-memory:ensure', async () => {
    const d = await ensureDb()
    return !!d
  })

  // Tasks
  ipcMain.handle('agent-memory:create-task', async (_e, id, goal) => createTask(id, goal))
  ipcMain.handle('agent-memory:add-step', async (_e, taskId, tool, input, output) => addStep(taskId, tool, input, output))
  ipcMain.handle('agent-memory:update-task', async (_e, taskId, status) => { updateTaskStatus(taskId, status); return { success: true } })
  ipcMain.handle('agent-memory:get-task', async (_e, taskId) => { const t = getTask(taskId); if (t) t.steps = getTaskSteps(taskId); return t })
  ipcMain.handle('agent-memory:list-tasks', async (_e, status, limit) => listTasks(status, limit))
  ipcMain.handle('agent-memory:delete-task', async (_e, taskId) => { deleteTask(taskId); return { success: true } })

  // Memories (basic CRUD)
  ipcMain.handle('agent-memory:add-memory', async (_e, content, tags, sourceConvId, type) => addMemory(content, tags, sourceConvId, type))
  ipcMain.handle('agent-memory:list-memories', async (_e, limit) => listMemories(limit))
  ipcMain.handle('agent-memory:list-memories-by-type', async (_e, type, limit) => listMemoriesByType(type, limit))
  ipcMain.handle('agent-memory:delete-memory', async (_e, id) => { deleteMemory(id); return { success: true } })
  ipcMain.handle('agent-memory:clear-memories', async () => { clearMemories(); return { success: true } })

  // Search
  ipcMain.handle('agent-memory:search-memories', async (_e, keywords, limit) => searchMemories(keywords, limit))
  ipcMain.handle('agent-memory:extract-keywords', async (_e, text) => extractKeywords(text))

  // Recall tracking
  ipcMain.handle('agent-memory:record-recall', async (_e, memoryId, query, queryHash) => { recordRecall(memoryId, query, queryHash); return { success: true } })
  ipcMain.handle('agent-memory:get-recall-stats', async (_e, memoryId) => getRecallStats(memoryId))

  // Promotion
  ipcMain.handle('agent-memory:promote-memories', async (_e, cfg) => promoteMemories(cfg))

  // Daily notes
  ipcMain.handle('agent-memory:save-daily-note', async (_e, dateStr, title, entries) => saveDailyNote(dateStr, title, entries))
  ipcMain.handle('agent-memory:get-daily-notes', async (_e, days) => getDailyNotes(days))
  ipcMain.handle('agent-memory:read-daily-note', async (_e, dateStr) => readDailyNote(dateStr))
}

module.exports = {
  ensureDb, createTask, addStep, updateTaskStatus, getTask, getTaskSteps, listTasks, deleteTask,
  addMemory, listMemories, listMemoriesByType, deleteMemory, clearMemories,
  searchMemories, extractKeywords, simpleHash, recordRecall, getRecallStats,
  promoteMemories, saveDailyNote, getDailyNotes, readDailyNote,
  closeDb, registerAgentMemoryIpc
}