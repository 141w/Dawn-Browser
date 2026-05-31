import { ref } from 'vue'
import { t } from './useI18n'
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
  if (!name || !name.trim()) return { error: t('tool.error.emptyName') }
  const tool = getTool(name)
  if (!tool) return { error: t('tool.error.unknown') + ': ' + name }
  const perm = resolvePermission(name, tool.permission)
  if (perm === 'deny') return { error: t('tool.error.disabled') + ': ' + name }
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
     e.g. "window.__dawnAPI.click('#btn')"
     Always re-inject __dawnAPI before each call to prevent page tampering. */
  async function callOnPage(code) {
    const e = requireEA()
    // Force re-inject __dawnAPI to ensure integrity (page may have overridden it)
    // __dawnAPI injection handled atomically by executeOnPage
    const res = await e.executeOnPage(
      `(function(){ try { if(!window.__dawnAPI||!window.__dawnAPI.click){return{error:'__dawnAPI corrupted — page may have overridden it'}}var __r = ${code}; return __r; } catch(__e) { return { error: __e.message }; } })()`
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
      '在浏览器标签页中打开指定网站 URL。当用户要求打开/访问/前往某个网址时使用此工具（例如"打开百度"、"去 GitHub"）。导航后使用 read_current_page 获取页面内容。搜索查询请使用 web_search，而非此工具。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要打开的网站 URL，例如 https://www.baidu.com 或 https://github.com' }
      },
      required: ['url']
    },
    execute: async (args) => {
      if (!args.url || typeof args.url !== 'string') throw new Error('Missing required parameter: url')
      const e = requireEA()
      // Check if currently on newtab BEFORE navigation
      let wasOnNewtab = false
      try {
        const meta = await e.getPageMetadata()
        wasOnNewtab = !meta || !meta.url || meta.url === 'dawn://newtab' || meta.url === ''
      } catch {}
      const result = await e.navigateTo(args.url)
      if (!result || !result.ok) {
        throw new Error(result?.error || 'Navigation failed — no active browser tab')
      }
      // Auto-open AI sidebar only when navigating FROM newtab page
      if (wasOnNewtab) {
        try { e.showAiFloat() } catch {}
      }
      // loadURL already awaits did-finish-load; small buffer for SPA hydration
      await new Promise(r => setTimeout(r, 300))
      return result
    }
  })
  registerTool({
    name: 'web_search',
    description:
      '使用搜索引擎搜索网页并在新标签页中打开结果。用于信息查询，例如"最新AI新闻"、"2025年最佳笔记本"。打开指定网站请使用 navigate_to。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
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
      '读取当前页面内容：标题、描述、正文（最多8000字符）、标题列表（30个）和链接列表（50个）。导航后使用此工具了解页面内容。',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      const content = await e.getPageContent()
      if (!content) throw new Error('No page content — navigate to a URL first')
      // Return clean summary instead of raw HTML
      const bodyText = (content.bodyText || '').slice(0, 6000)
      const headings = (content.headings || []).slice(0, 20).map(h => '#'.repeat(h.level) + ' ' + h.text)
      const links = (content.links || []).slice(0, 30).map(l => '[' + (l.text || '').slice(0,40) + '](' + l.href + ')')
      return { title: content.title || '', url: content.url || '', description: (content.description || '').slice(0, 200), bodyText, headings, links }
    }
  })

  registerTool({
    name: 'get_page_dom',
    description:
      '获取当前页面的可交互元素：表单（含字段标签、名称和CSS选择器）和按钮。点击或填写前使用此工具发现正确的选择器。',
    permission: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const e = requireEA()
      return await e.getPageDomSnapshot()
    }
  })

  registerTool({
    name: 'get_page_html',
    description: '获取当前页面的完整 HTML 源码（截断至50000字符）。',
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
    description: '获取用户在页面上当前选中的文本。',
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
      '截取当前页面的屏幕截图。返回 base64 PNG 数据 URL。用于向用户展示你看到的内容。',
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
      '通过 CSS 选择器点击页面上的元素。使用前请先用 get_page_dom 查找可用的选择器。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS 选择器，例如 "#submit"、".btn-primary"、"button[name=\\"search\\"]"'
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
      '在页面上的文本输入框中填写内容。使用前请先用 get_page_dom 查找输入框选择器。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '输入框的 CSS 选择器' },
        value: { type: 'string', description: '要输入的文本' }
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
    description: '通过 CSS 选择器选择下拉框中的选项。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '<select> 元素的 CSS 选择器' },
        value: { type: 'string', description: '要选择的选项值' }
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
    description: '按指定像素数向上或向下滚动页面。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up'], description: '滚动方向' },
        amount: { type: 'number', description: '滚动像素数（默认300）' }
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
    description: '将鼠标悬停在元素上（触发 mouseenter / mouseover 事件）。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' }
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
      '等待匹配 CSS 选择器的元素出现，最长等待指定毫秒数。在导航或点击触发页面更新后使用。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '要等待的 CSS 选择器' },
        timeout: { type: 'number', description: '最长等待时间（毫秒，默认5000）' }
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
      '在沙箱环境中执行 JavaScript，可读取页面数据。脚本通过 __pageData 访问：url、title、selection、bodyText、bodyHtml。不能直接操作页面——操作页面请使用 click_element、fill_input 等工具。返回值会被清洗（仅基本类型，最大10KB）。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: '要执行的 JavaScript 代码。通过 __pageData 对象访问页面数据。' }
      },
      required: ['script']
    },
    execute: async (args) => {
      if (!args.script || typeof args.script !== 'string') throw new Error('Missing required parameter: script')
      const e = requireEA()
      const res = await e.executeScriptSandbox(args.script)
      if (!res) throw new Error('Sandbox execution failed')
      if (!res.ok) throw new Error(res.error || 'Sandbox error')
      return { result: res.result }
    }
  })

  // ── file & data ──────────────────────────────────────────

  registerTool({
    name: 'read_local_file',
    description:
      '打开系统文件选择器，让用户选择本地文档进行读取。返回文件名、类型、大小和 base64 编码数据预览。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        fileTypes: {
          type: 'array',
          items: { type: 'string' },
          description: '文件扩展名过滤，例如 ["pdf","docx","txt","png"]'
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
      '下载远程 URL（或 file:// 资源）并返回 base64 编码的文件数据。',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要下载的 URL' }
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

  // ── script execution ──────────────────────────────────

  registerTool({
    name: 'run_script',
    description:
      '在本地运行脚本（bash、python 或 node）并返回标准输出/错误输出。用于数据处理、文件操作、运行命令行工具。每次执行需要用户确认。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['bash', 'python', 'node'], description: '脚本语言：bash、python 或 node' },
        code: { type: 'string', description: '要执行的脚本代码' },
        timeout: { type: 'number', description: '最长执行时间（毫秒，默认30000，最大120000）' }
      },
      required: ['language', 'code']
    },
    execute: async (args) => {
      if (!args.language || !args.code) throw new Error('缺少必要参数：language 和 code')
      if (!window.electronAPI?.runScript) throw new Error('脚本运行器不可用')
      const timeout = Math.min(args.timeout || 30000, 120000)
      const result = await window.electronAPI.runScript(args.language, args.code, timeout)
      if (!result) throw new Error('脚本执行未返回结果，可能是 IPC 通信失败')
      // Return full result instead of throwing — allow the agent to see stderr and continue
      return {
        exitCode: result.exitCode,
        stdout: (result.stdout || '').substring(0, 8000),
        stderr: (result.stderr || '').substring(0, 4000),
        ok: result.ok
      }
    }
  })
}


  // -- Sub-Agent (delegate_task) --

  registerTool({
    name: 'delegate_task',
    description:
      'Delegate a specific sub-task to a sub-agent. The sub-agent has its own conversation context and limited tool set. Use for: research tasks, code analysis, document reading, multi-step searches. Returns a summary when done.',
    permission: 'safe',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Detailed description of the sub-task' },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tool whitelist for sub-agent (empty = read-only tools: navigate_to, web_search, read_current_page, get_page_dom, capture_screenshot)'
        },
        maxRounds: { type: 'number', description: 'Max execution rounds (default 5)' }
      },
      required: ['task']
    },
    execute: async (args) => {
      if (!args.task) throw new Error('Missing task description')
      const allowedTools = args.tools && args.tools.length > 0
        ? args.tools
        : ['navigate_to', 'web_search', 'read_current_page', 'get_page_dom', 'capture_screenshot', 'get_page_html']
      const maxRounds = Math.min(args.maxRounds || 5, 8)
      return await window.__dawnSubAgent(args.task, allowedTools, maxRounds)
    }
  })

let _mcpToolsLoaded = false

async function syncMcpTools() {
  if (typeof window === 'undefined' || !window.electronAPI?.mcpGetTools) return
  try {
    const mcpTools = await window.electronAPI.mcpGetTools()
    if (!Array.isArray(mcpTools)) return
    // Remove stale MCP tool registrations
    for (const key of Array.from(toolRegistry.keys())) {
      if (key.startsWith('mcp_')) toolRegistry.delete(key)
    }
    // Register current MCP tools
    for (const t of mcpTools) {
      registerTool({
        name: t.name,
        description: `[MCP:${t.serverId}] ${t.description}`,
        permission: 'confirm',
        parameters: t.inputSchema || { type: 'object', properties: {} },
        execute: async (args) => {
          if (!window.electronAPI?.mcpCallTool) throw new Error('MCP not available')
          const res = await window.electronAPI.mcpCallTool(t.name, args)
          if (!res || !res.ok) throw new Error(res?.error || 'MCP tool execution failed')
          return res.result
        }
      })
    }
    _mcpToolsLoaded = true
  } catch (e) {
    console.error('[ToolSystem] MCP sync failed:', e.message)
  }
}

export function useToolSystem() {
  loadPermissions()
  registerBrowserTools()
  // Sync MCP tools on first use
  if (!_mcpToolsLoaded) syncMcpTools()
  return {
    toolPermissions, getPermission, setPermission, resolvePermission,
    registerTool, getTool, getRegisteredTools, getEnabledTools,
    getToolsForProvider, executeTool, loadPermissions, savePermissions,
    syncMcpTools
  }
}

