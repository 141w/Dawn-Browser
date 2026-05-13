import { ref } from 'vue'
import { useSkillSystem } from './useSkillSystem'

const { skills, buildSkillCommandSpecs } = useSkillSystem()
const skillCommands = buildSkillCommandSpecs(skills.value)

const SLASH_COMMANDS = [
  {
    name: '/summarize',
    description: 'Summarize the current page content',
    category: 'page',
    execute: async (context) => {
      const content = await window.electronAPI?.getPageContent()
      if (!content) return { error: 'No page content available.' }
      return {
        type: 'prompt',
        message: `Please summarize the following page content in a concise way:\n\nTitle: ${content.title}\nURL: ${content.url}\n\n${content.bodyText?.substring(0, 5000) || ''}`
      }
    }
  },
  {
    name: '/translate',
    description: 'Translate page content or selection',
    category: 'page',
    args: { name: 'lang', optional: true, description: 'Target language (e.g., en, zh, ja, fr)' },
    execute: async (context, args) => {
      const content = await window.electronAPI?.getPageContent()
      const selection = await window.electronAPI?.getPageSelection()
      const text = selection || content?.bodyText?.substring(0, 3000) || ''
      const targetLang = args?.lang || 'zh'
      if (!text) return { error: 'No content to translate.' }
      return {
        type: 'prompt',
        message: `Please translate the following text to ${targetLang}. Only reply with the translation:\n\n${text}`
      }
    }
  },
  {
    name: '/fix',
    description: 'Analyze current page code and suggest fixes',
    category: 'dev',
    execute: async (context) => {
      const html = await window.electronAPI?.getPageHtml()
      const url = (await window.electronAPI?.getPageMetadata())?.url || ''
      const isCode = /github\.com|gitlab\.com|stackoverflow\.com|npmjs\.com/.test(url)
      return {
        type: 'prompt',
        message: isCode
          ? `Analyze the code on this page (${url}) and suggest improvements or fix issues.`
          : `Analyze the current page structure and suggest any improvements or issues:\n\n${html?.substring(0, 3000) || ''}`
      }
    }
  },
  {
    name: '/explain',
    description: 'Explain the code or content on the current page',
    category: 'dev',
    execute: async (context) => {
      const selection = await window.electronAPI?.getPageSelection()
      const content = await window.electronAPI?.getPageContent()
      if (selection) {
        return { type: 'prompt', message: `Please explain the following code/text:\n\n${selection}` }
      }
      return {
        type: 'prompt',
        message: `Please explain what this page is about:\n\nTitle: ${content?.title}\nURL: ${content?.url}\n\n${content?.bodyText?.substring(0, 3000) || ''}`
      }
    }
  },
  {
    name: '/grammar',
    description: 'Check grammar of selected text or page content',
    category: 'writing',
    execute: async (context) => {
      const selection = await window.electronAPI?.getPageSelection()
      const content = await window.electronAPI?.getPageContent()
      const text = selection || content?.bodyText?.substring(0, 2000) || ''
      if (!text) return { error: 'No text to check.' }
      return {
        type: 'prompt',
        message: `Please check the grammar and suggest corrections for the following text:\n\n${text}`
      }
    }
  },
  {
    name: '/refine',
    description: 'Improve writing style of selected text',
    category: 'writing',
    execute: async (context) => {
      const selection = await window.electronAPI?.getPageSelection()
      if (!selection) return { error: 'Please select some text first.' }
      return {
        type: 'prompt',
        message: `Please refine and improve the writing style of the following text while preserving its meaning:\n\n${selection}`
      }
    }
  },
  {
    name: '/todo',
    description: 'Extract action items from the current page',
    category: 'productivity',
    execute: async (context) => {
      const content = await window.electronAPI?.getPageContent()
      if (!content) return { error: 'No page content available.' }
      return {
        type: 'prompt',
        message: `Extract all action items, tasks, and to-dos mentioned on this page:\n\nTitle: ${content.title}\nURL: ${content.url}\n\n${content.bodyText?.substring(0, 4000) || ''}`
      }
    }
  },
  {
    name: '/extract',
    description: 'Extract specific data from the current page',
    category: 'data',
    args: { name: 'type', optional: true, description: 'What to extract (emails, phone, links, dates, prices, etc.)' },
    execute: async (context, args) => {
      const content = await window.electronAPI?.getPageContent()
      if (!content) return { error: 'No page content available.' }
      const extractType = args?.type || 'key information'
      return {
        type: 'prompt',
        message: `Extract all ${extractType} from this page content. Format as a structured list:\n\nTitle: ${content.title}\nURL: ${content.url}\n\n${content.bodyText?.substring(0, 5000) || ''}`
      }
    }
  },
  {
    name: '/help',
    description: 'Show available commands and tools',
    category: 'system',
    execute: async () => {
      return { type: 'help' }
    }
  },
  {
    name: '/clear',
    description: 'Clear the current conversation',
    category: 'system',
    execute: async () => {
      return { type: 'clear' }
    }
  },
  ...skillCommands
]

export function useSlashCommands() {
  const showCommands = ref(false)
  const filterText = ref('')
  const selectedIndex = ref(0)

  function getFilteredCommands(text) {
    if (!text) return SLASH_COMMANDS
    const lower = text.toLowerCase()
    return SLASH_COMMANDS.filter(c =>
      c.name.toLowerCase().includes(lower) || c.description.toLowerCase().includes(lower)
    )
  }

  function matchCommand(input) {
    const trimmed = input.trim()
    if (!trimmed.startsWith('/')) return null
    const spaceIndex = trimmed.indexOf(' ')
    const cmdName = spaceIndex > 0 ? trimmed.substring(0, spaceIndex) : trimmed
    const cmd = SLASH_COMMANDS.find(c => c.name === cmdName)
    if (!cmd) return null
    const rest = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1).trim() : ''
    return { command: cmd, rest }
  }

  function getAllCommands() {
    return SLASH_COMMANDS
  }

  function getCommandsByCategory() {
    const cats = {}
    for (const cmd of SLASH_COMMANDS) {
      if (!cats[cmd.category]) cats[cmd.category] = []
      cats[cmd.category].push(cmd)
    }
    return cats
  }

  return {
    showCommands,
    filterText,
    selectedIndex,
    getFilteredCommands,
    matchCommand,
    getAllCommands,
    getCommandsByCategory
  }
}
