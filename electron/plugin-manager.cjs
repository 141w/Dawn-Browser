const { app, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins')

function ensureDir() {
  if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true })
}

function listPluginDirs() {
  ensureDir()
  try {
    return fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch { return [] }
}

function readManifest(pluginName) {
  const manifestPath = path.join(PLUGINS_DIR, pluginName, 'plugin.json')
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch { return null }
}

function readHookScript(pluginName, hookPath) {
  const fullPath = path.join(PLUGINS_DIR, pluginName, hookPath)
  try {
    return fs.readFileSync(fullPath, 'utf-8')
  } catch { return null }
}

function executeTool(pluginName, toolName, args) {
  const manifest = readManifest(pluginName)
  if (!manifest) return { error: 'Plugin not found: ' + pluginName }

  const toolDef = (manifest.tools || []).find(t => t.name === toolName)
  if (!toolDef) return { error: 'Tool not found: ' + toolName + ' in plugin ' + pluginName }

  // Check for tool script file
  const scriptPath = path.join(PLUGINS_DIR, pluginName, 'tools', toolName + '.js')
  if (fs.existsSync(scriptPath)) {
    try {
      const script = fs.readFileSync(scriptPath, 'utf-8')
      const fn = new Function('args', 'require', script)
      const result = fn(args, require)
      return { ok: true, result }
    } catch (e) {
      return { error: 'Tool execution error: ' + e.message }
    }
  }

  // If no script file, return the tool definition as metadata
  return { ok: true, result: { toolName, description: toolDef.description, args } }
}

function executeHook(pluginName, hookName, data) {
  const manifest = readManifest(pluginName)
  if (!manifest || !manifest.hooks || !manifest.hooks[hookName]) return null

  const hookPath = manifest.hooks[hookName]
  const script = readHookScript(pluginName, hookPath)
  if (!script) return null

  try {
    const fn = new Function('data', 'require', script)
    return fn(data, require)
  } catch (e) {
    console.warn('[PluginManager] Hook error:', pluginName, hookName, e.message)
    return null
  }
}

function installFromPath(sourceDir, pluginName) {
  ensureDir()
  const destDir = path.join(PLUGINS_DIR, pluginName || path.basename(sourceDir))
  if (!fs.existsSync(sourceDir)) return { error: 'Source not found' }
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true })

  // Copy directory
  fs.cpSync(sourceDir, destDir, { recursive: true })

  const manifest = readManifest(pluginName || path.basename(sourceDir))
  if (!manifest) {
    fs.rmSync(destDir, { recursive: true })
    return { error: 'Invalid plugin: no plugin.json found' }
  }

  return { success: true, name: manifest.name }
}

function uninstall(pluginName) {
  const dir = path.join(PLUGINS_DIR, pluginName)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true })
    return { success: true }
  }
  return { error: 'Plugin not found' }
}

function getPluginTools(pluginName) {
  const manifest = readManifest(pluginName)
  if (!manifest) return []
  return (manifest.tools || []).map(t => ({
    ...t,
    serverId: pluginName
  }))
}

function getAllPluginTools() {
  const dirs = listPluginDirs()
  const allTools = []
  for (const dir of dirs) {
    const tools = getPluginTools(dir)
    allTools.push(...tools)
  }
  return allTools
}

function registerPluginIpc() {
  ipcMain.handle('plugin:list-dirs', async () => listPluginDirs())
  ipcMain.handle('plugin:read-manifest', async (_e, name) => readManifest(name))
  ipcMain.handle('plugin:execute-tool', async (_e, pluginName, toolName, args) => executeTool(pluginName, toolName, args))
  ipcMain.handle('plugin:execute-hook', async (_e, pluginName, hookName, data) => executeHook(pluginName, hookName, data))
  ipcMain.handle('plugin:install-from-path', async (_e, sourceDir, name) => installFromPath(sourceDir, name))
  ipcMain.handle('plugin:uninstall', async (_e, name) => uninstall(name))
  ipcMain.handle('plugin:get-all-tools', async () => getAllPluginTools())
}

module.exports = { registerPluginIpc, listPluginDirs, readManifest, executeTool, executeHook, installFromPath, uninstall, getPluginTools, getAllPluginTools }