import { ref } from 'vue'
import { useAiConfig } from './useAiConfig'

const toolPermissions = ref(null)
const toolRegistry = new Map()

function loadPermissions() {
  if (toolPermissions.value) return
  const saved = localStorage.getItem('dawn-tool-permissions')
  toolPermissions.value = saved ? JSON.parse(saved) : {}
}

function savePermissions() {
  localStorage.setItem('dawn-tool-permissions', JSON.stringify(toolPermissions.value))
}

function getPermission(toolName) {
  loadPermissions()
  return toolPermissions.value[toolName] || null
}

function setPermission(toolName, level) {
  loadPermissions()
  toolPermissions.value[toolName] = level
  savePermissions()
}

function resolvePermission(toolName, defaultLevel) {
  const override = getPermission(toolName)
  if (override) return override
  return defaultLevel
}

function registerTool(tool) {
  if (!tool.name || !tool.description) {
    console.error('[ToolSystem] Invalid tool:', tool)
    return
  }
  toolRegistry.set(tool.name, { ...tool, permission: tool.permission || 'safe' })
}

function getTool(name) {
  return toolRegistry.get(name)
}

function getRegisteredTools() {
  return Array.from(toolRegistry.values())
}

function getEnabledTools() {
  return getRegisteredTools().filter(t => resolvePermission(t.name, t.permission) !== 'deny')
}

function getToolsForProvider(format) {
  const tools = getEnabledTools()
  if (format === 'anthropic') {
    return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters || { type: 'object', properties: {}, required: [] } }))
  }
  if (format === 'google') {
    return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {}, required: [] } }))
  }
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {}, required: [] } } }))
}

async function executeTool(name, args) {
  const tool = getTool(name)
  if (!tool) return { error: `Unknown tool: ${name}` }
  const perm = resolvePermission(name, tool.permission)
  if (perm === 'deny') return { error: `Tool "${name}" is disabled.` }
  if (perm === 'confirm') return { confirmRequired: true, toolName: name, toolArgs: args }
  try { const result = await tool.execute(args || {}); return { result } }
  catch (e) { return { error: e.message } }
}

// All tools removed — will be re-added with unified rules
function registerBrowserTools() {}

export function useToolSystem() {
  loadPermissions()
  registerBrowserTools()
  return {
    toolPermissions, getPermission, setPermission, resolvePermission,
    registerTool, getTool, getRegisteredTools, getEnabledTools,
    getToolsForProvider, executeTool, loadPermissions, savePermissions
  }
}
