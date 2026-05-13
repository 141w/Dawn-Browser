import { ref, watch } from 'vue'

let _watcherSet = false

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
    apiKeyRequired: true,
    format: 'openai'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    apiKeyRequired: true,
    format: 'anthropic'
  },
  {
    id: 'google',
    name: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro-preview-05-06', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    apiKeyRequired: true,
    format: 'google'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    apiKeyRequired: true,
    format: 'openai'
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiKeyRequired: true,
    format: 'openai'
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-4-long'],
    apiKeyRequired: true,
    format: 'openai'
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    apiKeyRequired: true,
    format: 'openai'
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3', 'qwen2', 'gemma2', 'mistral', 'codellama', 'deepseek-coder-v2'],
    apiKeyRequired: false,
    format: 'openai'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    baseUrl: 'http://localhost:1234/v1',
    models: [],
    apiKeyRequired: false,
    format: 'openai'
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI Compatible)',
    baseUrl: '',
    models: [],
    apiKeyRequired: true,
    format: 'openai'
  }
]

const config = ref(null)

function loadConfig() {
  if (config.value) return config
  const saved = localStorage.getItem('dawn-ai-config')
  const defaults = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: '',
    baseUrl: '',
    customModel: '',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: 'You are a helpful assistant.',
    newTabMode: 'dawn',
    newTabUrl: '',
    searchEngine: 'google',
    downloadPath: '',
    clearOnExit: false
  }
  config.value = saved ? { ...defaults, ...JSON.parse(saved) } : defaults
  return config
}

function saveConfig() {
  if (!config.value) return
  localStorage.setItem('dawn-ai-config', JSON.stringify(config.value))
}

function getProvider() {
  const c = config.value
  if (!c) return PROVIDERS[0]
  return PROVIDERS.find(p => p.id === c.provider) || PROVIDERS[0]
}

function getEffectiveModel() {
  const c = config.value
  if (!c) return 'gpt-4o-mini'
  return c.customModel || c.model || 'gpt-4o-mini'
}

function getEffectiveBaseUrl() {
  const c = config.value
  if (!c) return PROVIDERS[0].baseUrl
  const provider = getProvider()
  return c.baseUrl || provider.baseUrl
}

function getApiFormat() {
  return getProvider().format
}

export function useAiConfig() {
  loadConfig()

  if (!_watcherSet) {
    _watcherSet = true
    watch(config, saveConfig, { deep: true })
  }

  return {
    config,
    providers: PROVIDERS,
    getProvider,
    getEffectiveModel,
    getEffectiveBaseUrl,
    getApiFormat,
    loadConfig,
    saveConfig
  }
}
