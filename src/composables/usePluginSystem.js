import { ref } from 'vue'
import { registerTool } from './useToolSystem'

const plugins = ref([])
const pluginErrors = ref([])
let _externalLoaded = false

// ─── Plugin State ───

function loadPluginState(name) {
  try {
    const saved = JSON.parse(localStorage.getItem('dawn-plugin-states') || '{}')
    return saved[name] !== undefined ? saved[name] : true
  } catch { return true }
}

function savePluginState(name, enabled) {
  const saved = JSON.parse(localStorage.getItem('dawn-plugin-states') || '{}')
  saved[name] = enabled
  localStorage.setItem('dawn-plugin-states', JSON.stringify(saved))
}

// ─── External Plugin Loading ───

async function loadExternalPlugins() {
  if (_externalLoaded) return
  _externalLoaded = true

  if (typeof window === 'undefined' || !window.electronAPI?.pluginListDirs) return

  try {
    const dirs = await window.electronAPI.pluginListDirs()
    for (const dir of dirs) {
      try {
        const manifest = await window.electronAPI.pluginReadManifest(dir)
        if (!manifest) continue

        const existing = plugins.value.find(p => p.name === (manifest.name || dir))
        if (existing) continue

        const enabled = loadPluginState(manifest.name || dir)
        const plugin = {
          name: manifest.name || dir,
          title: manifest.name || dir,
          version: manifest.version || '1.0.0',
          description: manifest.description || '',
          author: manifest.author || '',
          enabled,
          builtin: false,
          dir,
          tools: (manifest.tools || []).map(toolDef => ({
            name: toolDef.name,
            description: (manifest.name || dir) + ': ' + (toolDef.description || ''),
            permission: toolDef.permission || 'confirm',
            parameters: toolDef.parameters || { type: 'object', properties: {} },
            execute: async (args) => {
              const result = await window.electronAPI.pluginExecuteTool(dir, toolDef.name, args)
              if (result.error) throw new Error(result.error)
              return result.result
            }
          })),
          hooks: manifest.hooks || {},
          systemPrompt: manifest.systemPrompt || ''
        }

        plugins.value.push(plugin)

        if (enabled) {
          for (const tool of plugin.tools) {
            registerTool(tool)
          }
        }
      } catch (e) {
        pluginErrors.value.push({ plugin: dir, error: e.message })
      }
    }
  } catch (e) {
    console.warn('[PluginSystem] Failed to load external plugins:', e.message)
  }
}

// ─── Plugin Management ───

function isPluginEnabled(name) {
  const plugin = plugins.value.find(p => p.name === name)
  return plugin ? plugin.enabled : false
}

function getPlugin(name) {
  return plugins.value.find(p => p.name === name)
}

function setPluginEnabled(name, enabled) {
  const plugin = plugins.value.find(p => p.name === name)
  if (!plugin) return
  plugin.enabled = enabled
  savePluginState(name, enabled)

  // Register/unregister tools
  if (enabled) {
    for (const tool of plugin.tools) {
      registerTool(tool)
    }
  }
  // Note: unregistering tools is not supported by current toolRegistry
  // Tools stay registered but plugin can be checked via isPluginEnabled
}

function getAllPlugins() {
  return plugins.value
}

async function uninstallPlugin(name) {
  if (typeof window !== 'undefined' && window.electronAPI?.pluginUninstall) {
    const result = await window.electronAPI.pluginUninstall(name)
    if (result.success) {
      plugins.value = plugins.value.filter(p => p.name !== name)
      savePluginState(name, false)
      return true
    }
    return false
  }
  return false
}

async function installFromPath(sourceDir, name) {
  if (typeof window !== 'undefined' && window.electronAPI?.pluginInstallFromPath) {
    const result = await window.electronAPI.pluginInstallFromPath(sourceDir, name)
    if (result.success) {
      _externalLoaded = false
      await loadExternalPlugins()
    }
    return result
  }
  return { error: 'Plugin install not available' }
}

export function usePluginSystem() {
  loadExternalPlugins()

  return {
    plugins, pluginErrors,
    isPluginEnabled, getPlugin, setPluginEnabled, getAllPlugins,
    uninstallPlugin, installFromPath, loadExternalPlugins
  }
}