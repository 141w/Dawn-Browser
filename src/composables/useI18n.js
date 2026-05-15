import { ref, computed, watch } from 'vue'
import { useAiConfig } from './useAiConfig'

const { config } = useAiConfig()

// Ensure lang field exists on config
if (!config.value.lang) {
  config.value.lang = 'zh'
}

const currentLang = computed(() => config.value.lang || 'zh')

const messages = {
  zh: {
    // App / toolbar
    'search.placeholder': '搜索或输入网址...',
    'window.title': 'Dawn',

    // AiSidebar
    'ai.title': 'Dawn AI',
    'ai.welcome': 'Dawn AI 助手',
    'ai.welcome.hint': '提问、分析页面，或输入 / 使用命令',
    'ai.newChat': '新建对话',
    'ai.settings': '设置',
    'ai.export': '导出',
    'ai.panel': '面板',
    'ai.hidePanel': '隐藏面板',
    'ai.placeholder': '输入消息... (输入 / 使用命令)',
    'ai.stop': '停止',
    'ai.attachPage': '附加页面内容',
    'ai.screenshot': '截图发送',
    'ai.regenerate': '重新生成',
    'ai.edit': '编辑消息',
    'ai.branch': '从此处分支',
    'ai.compare': '显示对照',
    'ai.cancel': '取消',
    'ai.saveSend': '保存并发送',
    'ai.pageBar': '当前页面',
    'ai.readPage': '读取页面内容',

    // AiSidebar settings
    'settings.model': '模型',
    'settings.tools': '工具',
    'settings.forms': '表单',
    'settings.provider': '提供商',
    'settings.modelLabel': '模型',
    'settings.apiKey': 'API Key',
    'settings.baseUrl': 'Base URL',
    'settings.temperature': 'Temperature',
    'settings.maxTokens': '最大 Token 数',
    'settings.systemPrompt': '系统提示词',
    'settings.customModel': '自定义模型...',
    'settings.add': '添加',
    'settings.toolsDesc': '配置 AI 可使用的工具及权限级别。',
    'settings.formsDesc': '保存常用表单模板，快速填充。',
    'settings.templateName': '模板名称（如 地址、联系方式）...',
    'settings.saveTemplate': '保存当前表单',
    'settings.noTemplates': '暂无模板。浏览到有表单的页面后，点击"保存当前表单"。',
    'settings.fields': '个字段',
    'settings.fill': '填充',

    // Permissions
    'perm.default': '默认',
    'perm.safe': '安全',
    'perm.confirm': '确认',
    'perm.deny': '拒绝',

    // Conversation
    'conv.empty': '暂无对话',
    'conv.delete': '删除',

    // Tool confirm
    'tool.allow': '允许',
    'tool.deny': '拒绝',
    'tool.confirm': '是否允许 AI 使用',
    'tool.executing': '执行中...',

    // Plan
    'plan.badge': '计划',
    'plan.steps': '步骤',

    // Export
    'export.md': '导出 Markdown',
    'export.translation': '导出翻译',

    // Translation
    'translation.title': '翻译结果',
    'translation.original': '原文',
    'translation.translated': '译文',
    'translation.close': '关闭',

    // Summary panel
    'summary.title': '页面摘要',
    'summary.structure': '页面结构',
    'summary.content': '内容',
    'summary.empty': '暂无页面内容。在聊天中点击"附加页面内容"读取当前页面。',
    'summary.close': '关闭',

    // Message actions
    'msg.edit': '编辑消息',
    'msg.regenerate': '重新生成回复',
    'msg.branch': '从此处分叉对话',

    // Slash commands
    'slash.empty': '无匹配命令',

    // Context
    'context.tokens': 'tokens',

    // BrowserSettings
    'bs.general': '常规',
    'bs.ai': 'AI',
    'bs.about': '关于',
    'bs.newTabMode': '新标签页',
    'bs.newTabMode.dawn': 'Dawn 首页',
    'bs.newTabMode.blank': '空白页',
    'bs.newTabMode.custom': '自定义网址',
    'bs.customUrl': '自定义网址',
    'bs.searchEngine': '搜索引擎',
    'bs.downloadPath': '下载路径',
    'bs.clearOnExit': '退出时清除浏览数据',
    'bs.lang': '界面语言',
    'bs.lang.zh': '中文',
    'bs.lang.en': 'English',
    'bs.aiSection': 'AI 助手',
    'bs.aiSectionDesc': 'AI 助手设置位于侧边栏面板中。',
    'bs.openAi': '打开 AI 面板 (Ctrl+Shift+A)',
    'bs.aboutTitle': 'Dawn',
    'bs.aboutVersion': '版本 0.1.0',
    'bs.aboutDesc': '基于 Electron 和 Vue 的 AI 驱动浏览器。',
    'bs.aboutRuntime': '运行环境',
    'bs.aboutRuntimeVal': 'Electron 31 + Vue 3.5',
    'bs.aboutProviders': 'AI 提供商',
    'bs.aboutProvidersVal': 'OpenAI, Anthropic, Google, DeepSeek, Ollama 等',
    'bs.aboutFeatures': '功能',
    'bs.aboutFeaturesVal': 'AI 对话、页面分析、翻译、自动填表、Agent 循环',
    'bs.title': '设置',

    // NewTab
    'newtab.greeting.midnight': '夜深了',
    'newtab.greeting.morning': '早上好',
    'newtab.greeting.noon': '中午好',
    'newtab.greeting.afternoon': '下午好',
    'newtab.greeting.evening': '晚上好',
    'newtab.search': '搜索或输入网址...',
    'newtab.sun': '周日',
    'newtab.mon': '周一',
    'newtab.tue': '周二',
    'newtab.wed': '周三',
    'newtab.thu': '周四',
    'newtab.fri': '周五',
    'newtab.sat': '周六',

    // AiFloat
    'aifloat.title': 'Dawn AI',

    // Error
    'error.api': 'API 错误',
    'error.stream': '流式传输错误',
  },

  en: {
    // App / toolbar
    'search.placeholder': 'Search or enter URL...',
    'window.title': 'Dawn',

    // AiSidebar
    'ai.title': 'Dawn AI',
    'ai.welcome': 'Dawn AI Assistant',
    'ai.welcome.hint': 'Ask questions, analyze pages, or type / for commands',
    'ai.newChat': 'New chat',
    'ai.settings': 'Settings',
    'ai.export': 'Export',
    'ai.panel': 'Panel',
    'ai.hidePanel': 'Hide panel',
    'ai.placeholder': 'Message Dawn... (type / for commands)',
    'ai.stop': 'Stop',
    'ai.attachPage': 'Attach page content',
    'ai.screenshot': 'Send with screenshot',
    'ai.regenerate': 'Regenerate response',
    'ai.edit': 'Edit message',
    'ai.branch': 'Branch from here',
    'ai.compare': 'Show comparison',
    'ai.cancel': 'Cancel',
    'ai.saveSend': 'Save & Send',
    'ai.pageBar': 'Current Page',
    'ai.readPage': 'Read page content',

    // AiSidebar settings
    'settings.model': 'Model',
    'settings.tools': 'Tools',
    'settings.forms': 'Forms',
    'settings.provider': 'Provider',
    'settings.modelLabel': 'Model',
    'settings.apiKey': 'API Key',
    'settings.baseUrl': 'Base URL',
    'settings.temperature': 'Temperature',
    'settings.maxTokens': 'Max Tokens',
    'settings.systemPrompt': 'System Prompt',
    'settings.customModel': 'Custom model...',
    'settings.add': 'Add',
    'settings.toolsDesc': 'Configure which tools the AI can use and their permission levels.',
    'settings.formsDesc': 'Save and reuse form field templates for quick filling.',
    'settings.templateName': 'Template name (e.g. Address, Contact)...',
    'settings.saveTemplate': 'Save Current Form',
    'settings.noTemplates': 'No saved templates. Fill a form on a page, then click "Save Current Form".',
    'settings.fields': 'fields',
    'settings.fill': 'Fill',

    // Permissions
    'perm.default': 'Default',
    'perm.safe': 'Safe',
    'perm.confirm': 'Confirm',
    'perm.deny': 'Deny',

    // Conversation
    'conv.empty': 'No conversations yet',
    'conv.delete': 'Delete',

    // Tool confirm
    'tool.allow': 'Allow',
    'tool.deny': 'Deny',
    'tool.confirm': 'Allow AI to use',
    'tool.executing': 'executing...',

    // Plan
    'plan.badge': 'Plan',
    'plan.steps': 'steps',

    // Export
    'export.md': 'Export Markdown',
    'export.translation': 'Export Translation',

    // Translation
    'translation.title': 'Translation',
    'translation.original': 'Original',
    'translation.translated': 'Translated',
    'translation.close': 'Close',

    // Summary panel
    'summary.title': 'Page Summary',
    'summary.structure': 'Structure',
    'summary.content': 'Content',
    'summary.empty': 'No page content available. Click "Attach page content" in the chat to read the current page.',
    'summary.close': 'Close',

    // Message actions
    'msg.edit': 'Edit message',
    'msg.regenerate': 'Regenerate response',
    'msg.branch': 'Branch conversation',

    // Slash commands
    'slash.empty': 'No matching commands',

    // Context
    'context.tokens': 'tokens',

    // BrowserSettings
    'bs.general': 'General',
    'bs.ai': 'AI',
    'bs.about': 'About',
    'bs.newTabMode': 'New Tab Page',
    'bs.newTabMode.dawn': 'Dawn Home',
    'bs.newTabMode.blank': 'Blank Page',
    'bs.newTabMode.custom': 'Custom URL',
    'bs.customUrl': 'Custom URL',
    'bs.searchEngine': 'Search Engine',
    'bs.downloadPath': 'Download Path',
    'bs.clearOnExit': 'Clear browsing data on exit',
    'bs.lang': 'Language',
    'bs.lang.zh': '中文',
    'bs.lang.en': 'English',
    'bs.aiSection': 'AI Assistant',
    'bs.aiSectionDesc': 'AI configuration is available in the AI assistant sidebar.',
    'bs.openAi': 'Open AI Panel (Ctrl+Shift+A)',
    'bs.aboutTitle': 'Dawn',
    'bs.aboutVersion': 'Version 0.1.0',
    'bs.aboutDesc': 'An AI-powered browser built with Electron and Vue.',
    'bs.aboutRuntime': 'Runtime',
    'bs.aboutRuntimeVal': 'Electron 31 + Vue 3.5',
    'bs.aboutProviders': 'AI Providers',
    'bs.aboutProvidersVal': 'OpenAI, Anthropic, Google, DeepSeek, Ollama + more',
    'bs.aboutFeatures': 'Features',
    'bs.aboutFeaturesVal': 'AI chat, page analysis, translation, auto-fill, agent loop',
    'bs.title': 'Settings',

    // NewTab
    'newtab.greeting.midnight': 'Good night',
    'newtab.greeting.morning': 'Good morning',
    'newtab.greeting.noon': 'Good afternoon',
    'newtab.greeting.afternoon': 'Good afternoon',
    'newtab.greeting.evening': 'Good evening',
    'newtab.search': 'Search or enter URL...',
    'newtab.sun': 'Sun',
    'newtab.mon': 'Mon',
    'newtab.tue': 'Tue',
    'newtab.wed': 'Wed',
    'newtab.thu': 'Thu',
    'newtab.fri': 'Fri',
    'newtab.sat': 'Sat',

    // AiFloat
    'aifloat.title': 'Dawn AI',

    // Error
    'error.api': 'API error',
    'error.stream': 'Stream error',
  }
}

export function t(key) {
  const lang = currentLang.value
  return messages[lang]?.[key] || messages.en[key] || key
}

export function useI18n() {
  return { t, currentLang, messages }
}
