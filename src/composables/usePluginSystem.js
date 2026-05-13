import { ref } from 'vue'
import { registerTool } from './useToolSystem'

const plugins = ref([])
const pluginErrors = ref([])

const DEFAULT_PLUGIN_DIR = 'plugins'

function getPluginDir() {
  return DEFAULT_PLUGIN_DIR
}

async function scanBuiltinPlugins() {
  // All builtin plugins removed — will be re-added with unified rules
  const builtinPlugins = []
  const _disabled = [
    {
      name: 'academic-assistant',
      title: 'Academic Assistant',
      version: '1.0.0',
      description: 'Paper abstract extraction, translation, and citation formatting',
      permissions: ['page-read'],
      tools: [
        {
          name: 'extract_paper_info',
          description: 'Extract paper title, authors, abstract, and citation from the current academic page',
          parameters: { type: 'object', properties: {}, required: [] },
          permission: 'safe',
          execute: async () => {
            const content = await window.electronAPI?.getPageContent()
            if (!content) return 'No page content available.'
            return {
              requestExtraction: true,
              type: 'paper',
              text: content.bodyText?.substring(0, 5000) || '',
              title: content.title,
              url: content.url
            }
          }
        },
        {
          name: 'format_citation',
          description: 'Format the current paper citation in a specific style (APA, MLA, Chicago, etc.)',
          parameters: {
            type: 'object',
            properties: { style: { type: 'string', description: 'Citation style: apa, mla, chicago, ieee, harvard' } },
            required: ['style']
          },
          permission: 'safe',
          execute: async (args) => {
            const content = await window.electronAPI?.getPageContent()
            if (!content) return 'No page content available.'
            return {
              requestFormatting: true,
              type: 'citation',
              style: args.style,
              text: content.bodyText?.substring(0, 3000) || '',
              title: content.title,
              url: content.url
            }
          }
        }
      ],
      systemPrompt: 'You have access to academic tools. When the user asks about papers, publications, or citations, use the extract_paper_info and format_citation tools to help them.'
    },
    {
      name: 'code-helper',
      title: 'Code Helper',
      version: '1.0.0',
      description: 'Code explanation, bug analysis, and refactoring suggestions for GitHub/StackOverflow pages',
      permissions: ['page-read'],
      tools: [
        {
          name: 'analyze_code',
          description: 'Analyze code on the current page for bugs, improvements, and patterns',
          parameters: {
            type: 'object',
            properties: { focus: { type: 'string', description: 'Analysis focus: bugs, performance, style, security, all' } },
            required: []
          },
          permission: 'safe',
          execute: async (args) => {
            const content = await window.electronAPI?.getPageContent()
            const selection = await window.electronAPI?.getPageSelection()
            const code = selection || content?.bodyText?.substring(0, 4000) || ''
            if (!code) return 'No code content available.'
            return {
              requestAnalysis: true,
              type: 'code',
              focus: args?.focus || 'all',
              code: code
            }
          }
        }
      ],
      systemPrompt: 'You have access to code analysis tools. When the user asks about code, use the analyze_code tool to examine the current page content.'
    },
    {
      name: 'reading-mode',
      title: 'Reading Mode',
      version: '1.0.0',
      description: 'Extract page main content, removing ads and navigation for clean reading',
      permissions: ['page-read'],
      tools: [
        {
          name: 'extract_article',
          description: 'Extract the main article content from the current page, removing navigation, ads, and sidebars',
          parameters: { type: 'object', properties: {}, required: [] },
          permission: 'safe',
          execute: async () => {
            const content = await window.electronAPI?.getPageContent()
            if (!content) return 'No page content available.'
            return {
              requestExtraction: true,
              type: 'article',
              text: content.bodyText,
              title: content.title,
              url: content.url
            }
          }
        }
      ],
      systemPrompt: 'You can extract the main content from web pages for clean reading. Use the extract_article tool when users want to read page content without distractions.'
    },
    {
      name: 'shopping-compare',
      title: 'Shopping Compare',
      version: '1.0.0',
      description: 'Extract product information from shopping pages and suggest price comparisons',
      permissions: ['page-read'],
      tools: [
        {
          name: 'extract_product',
          description: 'Extract product details (name, price, specs, rating) from the current shopping page',
          parameters: { type: 'object', properties: {}, required: [] },
          permission: 'safe',
          execute: async () => {
            const content = await window.electronAPI?.getPageContent()
            if (!content) return 'No page content available.'
            return {
              requestExtraction: true,
              type: 'product',
              text: content.bodyText?.substring(0, 3000) || '',
              title: content.title,
              url: content.url
            }
          }
        }
      ],
      systemPrompt: 'You can extract product information from shopping pages. When the user is browsing a product, use extract_product to help them compare and evaluate.'
    },
    {
      name: 'email-helper',
      title: 'Email Helper',
      version: '1.0.0',
      description: 'Email drafting, reply suggestions, and summarization for webmail pages',
      permissions: ['page-read'],
      tools: [
        {
          name: 'draft_email',
          description: 'Help draft an email based on context from the current email page',
          parameters: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Draft type: reply, forward, new' },
              tone: { type: 'string', description: 'Tone: formal, casual, friendly, professional' }
            },
            required: ['type']
          },
          permission: 'safe',
          execute: async (args) => {
            const content = await window.electronAPI?.getPageContent()
            if (!content) return 'No email content available.'
            return {
              requestDraft: true,
              type: 'email',
              draftType: args.type,
              tone: args.tone || 'professional',
              context: content.bodyText?.substring(0, 2000) || '',
              title: content.title
            }
          }
        }
      ],
      systemPrompt: 'You can help with email drafting. When the user is on a webmail page (Gmail, Outlook, etc.), use the draft_email tool to assist.'
    },
    {
      name: 'social-helper',
      title: 'Social Helper',
      version: '1.0.0',
      description: 'Content generation, translation, and trend analysis for social media pages',
      permissions: ['page-read'],
      tools: [
        {
          name: 'analyze_social',
          description: 'Analyze social media content on the current page',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action: generate_reply, translate, analyze_sentiment, summarize_thread' }
            },
            required: ['action']
          },
          permission: 'safe',
          execute: async (args) => {
            const content = await window.electronAPI?.getPageContent()
            const selection = await window.electronAPI?.getPageSelection()
            const text = selection || content?.bodyText?.substring(0, 2000) || ''
            if (!text) return 'No content to analyze.'
            return {
              requestAnalysis: true,
              type: 'social',
              action: args.action,
              text: text,
              title: content?.title,
              url: content?.url
            }
          }
        }
      ],
      systemPrompt: 'You can help with social media content. When the user is on Twitter, Weibo, or other social platforms, use analyze_social to help them engage.'
    }
  ]

  for (const plugin of builtinPlugins) {
    try {
      const existing = plugins.value.find(p => p.name === plugin.name)
      if (existing) continue

      const pluginInstance = {
        ...plugin,
        enabled: true,
        builtin: true,
        tools: plugin.tools || []
      }

      plugins.value.push(pluginInstance)

      for (const tool of plugin.tools) {
        registerTool(tool)
      }
    } catch (e) {
      pluginErrors.value.push({ plugin: plugin.name, error: e.message })
      console.error(`[PluginSystem] Failed to load plugin ${plugin.name}:`, e)
    }
  }
}

function isPluginEnabled(name) {
  const plugin = plugins.value.find(p => p.name === name)
  return plugin ? plugin.enabled : false
}

function getPlugin(name) {
  return plugins.value.find(p => p.name === name)
}

function setPluginEnabled(name, enabled) {
  const plugin = plugins.value.find(p => p.name === name)
  if (plugin) {
    plugin.enabled = enabled
    const saved = JSON.parse(localStorage.getItem('dawn-plugin-states') || '{}')
    saved[name] = enabled
    localStorage.setItem('dawn-plugin-states', JSON.stringify(saved))
  }
}

function loadPluginStates() {
  const saved = JSON.parse(localStorage.getItem('dawn-plugin-states') || '{}')
  for (const plugin of plugins.value) {
    if (saved[plugin.name] !== undefined) {
      plugin.enabled = saved[plugin.name]
    }
  }
}

function getAllPlugins() {
  return plugins.value
}

export function usePluginSystem() {
  scanBuiltinPlugins().then(() => loadPluginStates())

  return {
    plugins,
    pluginErrors,
    isPluginEnabled,
    getPlugin,
    setPluginEnabled,
    getAllPlugins,
    scanBuiltinPlugins
  }
}
