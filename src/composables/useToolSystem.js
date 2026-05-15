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
  if (!name || !name.trim()) return { error: 'Empty tool name — the model may have malformed the function call. Try a different model (GPT-4o, DeepSeek, Claude).' }
  const tool = getTool(name)
  if (!tool) return { error: `Unknown tool: ${name}` }
  const perm = resolvePermission(name, tool.permission)
  if (perm === 'deny') return { error: `Tool "${name}" is disabled.` }
  if (perm === 'confirm') return { confirmRequired: true, toolName: name, toolArgs: args }
  try { const result = await tool.execute(args || {}); return { result } }
  catch (e) { return { error: e.message } }
}

let _toolsRegistered = false

function registerBrowserTools() {
  if (_toolsRegistered) return
  _toolsRegistered = true

  // ── helpers ──────────────────────────────────────────────

  function ea() {
    return typeof window !== 'undefined' ? window.electronAPI : null
  }

  function requireEA() {
    const e = ea()
    if (!e) throw new Error('Not running in Dawn browser environment')
    return e
  }

  /* Inject __dawnAPI into the active page, then execute a call against it.
     The code parameter should be a JS expression that uses window.__dawnAPI,
     e.g. "window.__dawnAPI.click('#btn')"  */
  async function callOnPage(code) {
    const e = requireEA()
    await e.injectContentScript()
    const res = await e.executeOnPage(
      `(function(){ try { var __r = ${code}; return __r; } catch(__e) { return { error: __e.message }; } })()`
    )
    if (!res) throw new Error('Page execution failed — no active page?')
    if (res.error) throw new Error(res.error)
    const val = res.result
    if (val && typeof val === 'object' && val.error) throw new Error(val.error)
    return val
  }

  // ── navigation ──────────────────────────────────────────

  registerTool({
    name: 'navigate_to',
    description:
      'Open a specific website URL in the browser tab. Use this when the user asks to open/visit/go to a specific web address (e.g. "open baidu.com", "go to github.com"). After navigating, use read_current_page to get the page content. Do NOT use this for search queries — use web_search for that.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The website URL to open, e.g. https://www.baidu.com or https://github.com' }
      },
      required: ['url']
    },
    execute: async (args) => {
      if (!args.url || typeof args.url !== 'string') throw new Error('Missing required parameter: url')
      const e = requireEA()
      const result = await e.navigateTo(args.url)
      if (!result || !result.ok) {
        throw new Error(result?.error || 'Navigation failed — no active browser tab')
      }
      // Auto-open AI sidebar so the conversation stays visible while browsing
      try { e.showAiFloat() } catch {}
      // Let the page start loading before the AI tries to read it
      await new Promise(r => setTimeout(r, 1200))
      return result
    }
  })

  registerTool({
    name: 'web_search',
    description:
      'Search the web with a search engine (Google) and open results in a new tab. Use this for information queries like "latest AI news" or "best laptops 2025". Do NOT use this to open a specific website URL — use navigate_to for that.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' }
      },
      required: ['query']
    },
    execute: async (args) => {
      if (!args.query || typeof args.query !== 'string') throw new Error('Missing required parameter: query')
      const e = requireEA()
      const { config } = useAiConfig()
      const engine = config?.value?.searchEngine || 'baidu'
      const searchUrls = {
        baidu: 'https://www.baidu.com/s?wd=',
        bing: 'https://www.bing.com/search?q=',
        google: 'https://www.google.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q='
      }
      const base = searchUrls[engine] || searchUrls.baidu
      const url = base + encodeURIComponent(args.query)
      await e.createTab(url)
      return { opened: true, url, engine }
    }
  })

  // ── page reading ────────────────────────────────────────

  registerTool({
    name: 'read_current_page',
    description:
      'Read the current page content: title, description, body text (8k chars), headings (30), and links (50). Use after navigate_to to understand what is on the page.',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      const content = await e.getPageContent()
      if (!content) throw new Error('No page content — navigate to a URL first')
      return content
    }
  })

  registerTool({
    name: 'get_page_dom',
    description:
      'Get interactive elements from the current page: forms (with field labels, names, and CSS selectors) and buttons. Use this before clicking or filling to discover the right selectors.',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      return await e.getPageDomSnapshot()
    }
  })

  registerTool({
    name: 'get_page_html',
    description: 'Get the full HTML source of the current page (truncated to 50000 chars).',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      const html = await e.getPageHtml()
      return (html || '').substring(0, 50000)
    }
  })

  registerTool({
    name: 'get_page_selection',
    description: 'Get the text currently selected by the user on the page.',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      const text = await e.getPageSelection()
      return { selectedText: text || '(nothing selected)' }
    }
  })

  // ── screenshot ───────────────────────────────────────────

  registerTool({
    name: 'capture_screenshot',
    description:
      'Take a screenshot of the current page. Returns a base64 PNG data URL. Use to show the user what you are seeing.',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      const dataUrl = await e.capturePage()
      if (!dataUrl) throw new Error('Screenshot failed — no active page')
      return { type: 'image', content: '[Screenshot of current page]', dataUrl }
    }
  })

  // ── page interaction (via __dawnAPI) ─────────────────────

  registerTool({
    name: 'click_element',
    description:
      'Click an element on the page by CSS selector. Use get_page_dom first to find available selectors.',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector, e.g. "#submit", ".btn-primary", "button[name=\\"search\\"]"'
        }
      },
      required: ['selector']
    },
    execute: async (args) => {
      if (!args.selector || typeof args.selector !== 'string') throw new Error('Missing required parameter: selector')
      return callOnPage('window.__dawnAPI.click(' + JSON.stringify(args.selector) + ')')
    }
  })

  registerTool({
    name: 'fill_input',
    description:
      'Fill a text input field on the page. Use get_page_dom first to find the input selector.',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input element' },
        value: { type: 'string', description: 'Text to type into the input' }
      },
      required: ['selector', 'value']
    },
    execute: async (args) => {
      if (!args.selector || typeof args.selector !== 'string') throw new Error('Missing required parameter: selector')
      if (args.value === undefined || args.value === null) throw new Error('Missing required parameter: value')
      return callOnPage(
        'window.__dawnAPI.fill(' +
          JSON.stringify(args.selector) +
          ', ' +
          JSON.stringify(args.value) +
          ')'
      )
    }
  })

  registerTool({
    name: 'select_dropdown',
    description: 'Select an option in a <select> dropdown by CSS selector.',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the <select> element' },
        value: { type: 'string', description: 'Option value to select' }
      },
      required: ['selector', 'value']
    },
    execute: async (args) => {
      if (!args.selector || typeof args.selector !== 'string') throw new Error('Missing required parameter: selector')
      if (args.value === undefined || args.value === null) throw new Error('Missing required parameter: value')
      return callOnPage(
        'window.__dawnAPI.select(' +
          JSON.stringify(args.selector) +
          ', ' +
          JSON.stringify(args.value) +
          ')'
      )
    }
  })

  registerTool({
    name: 'scroll_page',
    description: 'Scroll the page up or down by a number of pixels.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default 300)' }
      },
      required: ['direction']
    },
    execute: async (args) =>
      callOnPage(
        'window.__dawnAPI.scroll(' +
          JSON.stringify(args.direction) +
          ', ' +
          (args.amount || 300) +
          ')'
      )
  })

  registerTool({
    name: 'hover_element',
    description: 'Hover the mouse over an element (fires mouseenter / mouseover).',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' }
      },
      required: ['selector']
    },
    execute: async (args) => {
      if (!args.selector || typeof args.selector !== 'string') throw new Error('Missing required parameter: selector')
      return callOnPage('window.__dawnAPI.hover(' + JSON.stringify(args.selector) + ')')
    }
  })

  registerTool({
    name: 'wait_for_element',
    description:
      'Wait up to N ms for an element matching a CSS selector to appear. Use after navigation or after clicking something that triggers a page update.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Max wait in ms (default 5000)' }
      },
      required: ['selector']
    },
    execute: async (args) => {
      if (!args.selector || typeof args.selector !== 'string') throw new Error('Missing required parameter: selector')
      return callOnPage(
        'window.__dawnAPI.wait(' +
          JSON.stringify(args.selector) +
          ', ' +
          (args.timeout || 5000) +
          ')'
      )
    }
  })

  // ── scripting ────────────────────────────────────────────

  registerTool({
    name: 'execute_script',
    description:
      'Execute arbitrary JavaScript on the current page and return the result. Use sparingly — prefer the specialised tools when possible.',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to run' }
      },
      required: ['script']
    },
    execute: async (args) => {
      if (!args.script || typeof args.script !== 'string') throw new Error('Missing required parameter: script')
      const e = requireEA()
      const res = await e.executeOnPage(args.script)
      if (!res) throw new Error('Script execution failed')
      if (res.error) throw new Error(res.error)
      return { result: res.result }
    }
  })

  // ── file & data ──────────────────────────────────────────

  registerTool({
    name: 'read_local_file',
    description:
      'Open a system file-picker so the user can select a local document to read. Returns file name, type, size, and a preview of the base64-encoded data.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        fileTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to filter, e.g. ["pdf","docx","txt","png"]'
        }
      },
      required: []
    },
    execute: async (args) => {
      const e = requireEA()
      const file = await e.openFileDialog(
        args.fileTypes && args.fileTypes.length > 0
          ? [{ name: 'Documents', extensions: args.fileTypes }]
          : null
      )
      if (!file) return { cancelled: true }
      return {
        fileName: file.fileName,
        filePath: file.filePath,
        ext: file.ext,
        size: file.size,
        dataLength: file.data ? file.data.length : 0
      }
    }
  })

  registerTool({
    name: 'download_content',
    description:
      'Download a remote URL (or file:// resource) and return base64-encoded file data.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to download' }
      },
      required: ['url']
    },
    execute: async (args) => {
      if (!args.url || typeof args.url !== 'string') throw new Error('Missing required parameter: url')
      const e = requireEA()
      const data = await e.downloadUrl(args.url)
      if (!data) throw new Error('Download returned no data')
      if (data.error) throw new Error(data.error)
      return {
        fileName: data.fileName,
        ext: data.ext,
        size: data.size,
        dataPreview: data.data ? data.data.substring(0, 200) + '…' : null
      }
    }
  })
}

export function useToolSystem() {
  loadPermissions()
  registerBrowserTools()
  return {
    toolPermissions, getPermission, setPermission, resolvePermission,
    registerTool, getTool, getRegisteredTools, getEnabledTools,
    getToolsForProvider, executeTool, loadPermissions, savePermissions
  }
}
