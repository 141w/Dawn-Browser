const { ipcMain } = require('electron')

let Client, StdioClientTransport
let _sdkLoaded = false

async function loadSdk() {
  if (_sdkLoaded) return _sdkLoaded
  try {
    const [sdk, stdio] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js')
    ])
    Client = sdk.Client
    StdioClientTransport = stdio.StdioClientTransport
    _sdkLoaded = true
    console.log('[MCP] SDK loaded')
  } catch (e) {
    console.error('[MCP] Failed to load SDK:', e.message)
    _sdkLoaded = false
  }
  return _sdkLoaded
}

class McpConnection {
  constructor(config) {
    this.id = config.id
    this.config = config
    this.client = null
    this.transport = null
    this.tools = []
    this.status = 'disconnected'
    this.error = null
  }

  async connect() {
    if (this.status === 'connected') return
    this.status = 'connecting'
    this.error = null

    if (!Client) {
      const ok = await loadSdk()
      if (!ok) { this.status = 'error'; this.error = 'MCP SDK not available'; return }
    }

    try {
      this.client = new Client(
        { name: 'dawn-browser', version: '1.0.0' },
        { capabilities: {} }
      )

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || [],
        env: this.config.env ? { ...process.env, ...this.config.env } : process.env,
        cwd: this.config.cwd || undefined,
        stderr: 'pipe'
      })

      if (this.transport.stderr) {
        this.transport.stderr.on('data', (chunk) => {
          console.error(`[MCP:${this.id} stderr]`, chunk.toString().trim())
        })
      }

      this.transport.onclose = () => {
        this.status = 'disconnected'
        this.tools = []
        console.log(`[MCP:${this.id}] Transport closed`)
      }

      this.transport.onerror = (err) => {
        this.status = 'error'
        this.error = err?.message || 'Transport error'
        console.error(`[MCP:${this.id}] Transport error:`, this.error)
      }

      await this.client.connect(this.transport)

      const { tools } = await this.client.listTools()
      this.tools = tools || []
      this.status = 'connected'
      console.log(`[MCP:${this.id}] Connected — ${this.tools.length} tools`)
    } catch (e) {
      this.status = 'error'
      this.error = e.message
      console.error(`[MCP:${this.id}] Connect failed:`, e.message)
      try { this.transport?.close?.() } catch {}
      this.client = null
      this.transport = null
    }
  }

  async callTool(toolName, args) {
    if (!this.client || this.status !== 'connected') {
      throw new Error(`MCP server "${this.id}" not connected`)
    }
    const result = await this.client.callTool({ name: toolName, arguments: args || {} })
    return result
  }

  async disconnect() {
    try {
      if (this.client) await this.client.close()
    } catch {}
    this.client = null
    this.transport = null
    this.tools = []
    this.status = 'disconnected'
  }
}

class McpManager {
  constructor() {
    this.connections = new Map()
    this._serverConfigs = []
  }

  setConfigs(configs) {
    this._serverConfigs = configs || []
  }

  getConfigs() {
    return this._serverConfigs
  }

  async startServer(config) {
    if (this.connections.has(config.id)) {
      await this.connections.get(config.id).disconnect()
    }
    const conn = new McpConnection(config)
    this.connections.set(config.id, conn)
    await conn.connect()
    return this.getServerStatus(config.id)
  }

  async stopServer(id) {
    const conn = this.connections.get(id)
    if (conn) {
      await conn.disconnect()
      this.connections.delete(id)
    }
  }

  async stopAll() {
    for (const [id] of this.connections) {
      await this.stopServer(id)
    }
  }

  async autoStart() {
    for (const config of this._serverConfigs) {
      if (config.enabled !== false) {
        try { await this.startServer(config) } catch (e) {
          console.error(`[MCP] Auto-start ${config.id} failed:`, e.message)
        }
      }
    }
  }

  getServerStatus(id) {
    const conn = this.connections.get(id)
    if (!conn) return { id, status: 'disconnected', tools: [], error: null }
    return {
      id: conn.id,
      status: conn.status,
      tools: conn.tools.map(t => ({
        name: `mcp_${conn.id}__${t.name}`,
        originalName: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
      })),
      error: conn.error
    }
  }

  getAllStatuses() {
    const result = {}
    for (const [id] of this.connections) {
      result[id] = this.getServerStatus(id)
    }
    return result
  }

  getAllTools() {
    const tools = []
    for (const [, conn] of this.connections) {
      if (conn.status !== 'connected') continue
      for (const t of conn.tools) {
        tools.push({
          name: `mcp_${conn.id}__${t.name}`,
          originalName: t.name,
          serverId: conn.id,
          description: t.description || '',
          inputSchema: t.inputSchema || { type: 'object', properties: {} }
        })
      }
    }
    return tools
  }

  async callTool(prefixedName, args) {
    const match = prefixedName.match(/^mcp_(.+?)__(.+)$/)
    if (!match) throw new Error(`Invalid MCP tool name: ${prefixedName}`)
    const [, serverId, toolName] = match
    const conn = this.connections.get(serverId)
    if (!conn || conn.status !== 'connected') {
      throw new Error(`MCP server "${serverId}" not connected`)
    }
    const result = await conn.callTool(toolName, args)
    if (result.isError) {
      const text = result.content?.find(c => c.type === 'text')?.text || 'MCP tool error'
      throw new Error(text)
    }
    const text = result.content?.map(c => {
      if (c.type === 'text') return c.text
      if (c.type === 'image') return `[Image: ${c.mimeType}]`
      if (c.type === 'resource') return `[Resource: ${c.resource?.uri || 'unknown'}]`
      return JSON.stringify(c)
    }).join('\n')
    return text || '(no output)'
  }
}

const mcpManager = new McpManager()

function registerMcpIpc() {
  ipcMain.handle('mcp:start-server', async (_event, config) => {
    return mcpManager.startServer(config)
  })

  ipcMain.handle('mcp:stop-server', async (_event, id) => {
    await mcpManager.stopServer(id)
    return { success: true }
  })

  ipcMain.handle('mcp:get-statuses', async () => {
    return mcpManager.getAllStatuses()
  })

  ipcMain.handle('mcp:get-tools', async () => {
    return mcpManager.getAllTools()
  })

  ipcMain.handle('mcp:call-tool', async (_event, name, args) => {
    try {
      const result = await mcpManager.callTool(name, args)
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('mcp:set-configs', async (_event, configs) => {
    mcpManager.setConfigs(configs)
    return { success: true }
  })

  ipcMain.handle('mcp:auto-start', async () => {
    await mcpManager.autoStart()
    return mcpManager.getAllStatuses()
  })
}

module.exports = { mcpManager, registerMcpIpc }
