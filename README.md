# Dawn

**AI-powered Desktop Browser** -- Electron 31 + Vue 3 + Vite 6

Dawn is an AI-native desktop browser. Its built-in AI Agent can read, click, fill forms, and autonomously complete complex web tasks. Warm, restrained design inspired by the first light of dawn.

---

## Features

### AI Agent
- **18 browser tools**: navigate, read page, screenshot, click, fill forms, scroll, execute scripts, search, open local files
- **Agent mode**: one-click toggle, AI autonomously browses web pages to complete tasks
- **Multi-model support**: OpenAI, Anthropic, DeepSeek, Google AI, Qwen, Zhipu, Moonshot, Ollama, LM Studio, custom OpenAI-compatible endpoints
- **Model failover**: auto-switch to fallback models when primary fails, configurable chain
- **Sub-agent delegation**: main agent can delegate sub-tasks to focused sub-agents with independent context
- **Real-time thinking**: shows reasoning state, tool calls, execution results
- **Stop / Skip**: interrupt Agent or skip current tool at any time
- **Friendly error messages**: API errors auto-translated to user-friendly tips

### Cross-Conversation Memory
- **Active Memory injection**: before each reply, searches relevant memories from past conversations and injects into system prompt
- **Memory Flush**: on conversation switch/close, auto-extracts key preferences using heuristic patterns + LLM
- **Short-term -> Long-term promotion**: memories recalled by multiple different queries auto-promote to long-term
- **Daily Notes**: conversation summaries saved to `memory/YYYY-MM-DD.md` (human-readable Markdown)
- **Keyword search**: memories searched by relevance, type weight, and time decay

### Conversation Compaction
- **LLM-based summarization**: when approaching token limit, old messages compressed into structured summary via LLM
- **Context overflow retry**: API context-overflow errors trigger auto-compaction and retry
- **Memory Flush before compaction**: important info saved to memory before messages are compressed

### Voice
- **Text-to-Speech**: click speaker button on any AI reply to hear it read aloud (browser SpeechSynthesis)
- **Voice Input**: microphone button on input bar, speech-to-text via Web Speech API
- **Auto-read option**: can auto-read AI replies (configurable in settings)
- **Language-aware**: auto-detects Chinese/English and selects appropriate voice

### Multimodal Output
- **Code syntax highlighting**: 20+ languages via highlight.js (Python, JS, TS, Go, Rust, Java, C/C++, SQL, etc.)
- **Mermaid diagrams**: flowcharts, sequence diagrams, Gantt charts rendered inline
- **Markdown tables**: properly structured with headers and borders
- **XSS protection**: built-in sanitizer strips script tags and event handlers

### Conversation Export
- **Export as Markdown**: download conversation as .md file
- **Export as HTML**: download conversation as formatted .html
- **Context menu**: right-click any conversation in the list to export
- **Auto-naming**: files named after conversation title

### Plugin SDK
- **External plugins**: drop plugin folders into `<userData>/plugins/` to extend AI capabilities
- **Plugin manifest**: `plugin.json` with tools, hooks, system prompt
- **Tool registration**: plugin tools auto-register into Agent tool list
- **Hook system**: `onMessage`, `onPageLoad`, `beforeToolCall` hooks
- **Install/Uninstall**: from local path or folder

### Browser Core
- **Multi-tab browsing**: Electron BrowserView native tab isolation
- **Multi-window**: right-click "Open in new window" creates full Dawn window
- **Ctrl+F page find**: match count and prev/next navigation
- **Ctrl+H browsing history**: date grouping, search, one-click clear
- **Ctrl+Shift+T restore closed tab**: remembers last 32
- **Page zoom**: Ctrl+= / Ctrl+- / Ctrl+0, per-tab independent
- **Tab drag reorder**: HTML5 drag and drop
- **Favicons**: tab bar shows site icons
- **Context-aware right-click menu**: dynamic based on selection (text/link/image/blank), with AI translate/explain/summarize

### Download Manager
- Real-time progress bar, file size, download status
- Cancel download, open completed files
- Toolbar button for quick view

### Bookmark System
- Bookmark pages and files
- HTML format import/export
- Bookmark manager panel (edit/delete/search)
- Sidebar bookmark quick access

### Tab Group Management
- **AI Smart Grouping**: uses configured AI model to analyze tab content, auto-generate Chinese group names
- **Manual management**: new group, drag tabs, rename/delete
- Group collapse/expand

### Skill System
- One-click install skills from GitHub repos or ZIP files
- 3 built-in skills: browser automation, markdown editing, skill creator
- Skill install / uninstall / enable / disable / reorder
- Skill Prompt auto-injected into AI context
- YAML multi-line description support

### Interface Design
- Warm cream color system (#f7f4ed)
- Windows: standard window controls (minimize/maximize/close)
- macOS: red/yellow/green dot controls
- Platform auto-detection
- Tab sidebar collapsible
- AI sidebar width draggable
- **Dark/Light theme**: CSS variable system, all components adapted

### Settings & Privacy
- AI model configuration (Provider / API Key / Model / Temperature)
- **Fallback models**: auto-switch when primary model fails
- **Voice settings**: speed, auto-read, voice selection
- **Memory management**: view/edit/delete memories, daily notes, manual promotion
- **Plugin management**: enable/disable external plugins
- **Context menu AI customization**: add/delete/reorder custom Prompt templates
- Search engine switching
- New tab mode
- Exit data clearing
- Keyboard shortcut reference
- Interface language (Chinese / English)

---

## Architecture

```
src/
  composables/           # Vue composables (core logic)
    useAiChat.js         # AI conversation, streaming, failover, compaction
    useAiConfig.js       # Provider/model/config management, failover chain
    useAgentLoop.js      # Agent plan system, sub-agent engine
    useAgentMemory.js    # Cross-conversation memory, search, flush, promotion
    useContextManager.js # Token estimation, compaction, overflow detection
    useContextRef.js     # Page context reference (@)
    useDownloads.js      # Download management
    useHistory.js        # Browsing history (IndexedDB)
    useI18n.js           # Chinese/English translations
    useMarkdown.js       # Markdown rendering with mermaid + highlight.js
    useMemory.js         # IndexedDB storage (conversations/config/bookmarks)
    usePluginSystem.js   # External plugin loading and management
    useSkillSystem.js    # Skill loading and execution
    useTabGroups.js      # Tab grouping
    useToolSystem.js     # Tool registration, permissions, delegate_task
    useVoice.js          # TTS + STT (SpeechSynthesis + Web Speech API)
    useBookmarks.js      # Bookmark CRUD
    useStore.js          # Key-value store
    useTaskScheduler.js  # Scheduled tasks
    useTips.js           # Onboarding tips
    useProactiveAI.js    # Proactive AI analysis
    useSearchEngine.js   # Search engine integration
    useSlashCommands.js  # Slash command system
    useAutonomousBrowser.js # Navigation trail tracking
    useErrorFormat.js    # Error message formatting
  *.vue                  # Vue components (App, AiSidebar, HomeAI, ChatInput, etc.)

electron/
  main.cjs               # Electron main process entry
  dawn-window.cjs         # BrowserView management, context menu, IPC
  preload.cjs             # IPC bridge (electronAPI)
  agent-memory.cjs        # SQLite memory (tasks/steps/memories/recall_log)
  plugin-manager.cjs      # Plugin directory management, tool/hook execution
  skill-manager.cjs       # Skill install/uninstall (GitHub/ZIP)
  mcp-manager.cjs         # MCP server management
  dawn-store.cjs          # Key-value store (main process)
  script-runner.cjs       # Script execution (bash/python/node)
  task-scheduler.cjs      # Cron-like task scheduler
  agent-sandbox.cjs       # Sandboxed JS execution
```

---

## Development

```bash
npm install
npm run electron:dev    # Start dev server + Electron
```

### Build

```bash
npm run build           # Build frontend
npm run electron        # Start Electron (production)
npm run pack:win        # Package Windows .exe
```

---

## Supported AI Providers

| Provider | Example Models |
|----------|---------------|
| OpenAI | gpt-4o, gpt-4o-mini, o3-mini |
| Anthropic | claude-sonnet-4, claude-3.5-sonnet |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Google AI | gemini-2.5-pro, gemini-2.0-flash |
| Qwen | qwen-max, qwen-plus |
| Zhipu AI | glm-4-plus, glm-4-flash |
| Moonshot | moonshot-v1-8k/32k/128k |
| Ollama | llama3, qwen2 (local) |
| LM Studio | custom models (local) |
| Custom | OpenAI-compatible endpoints |

---

## Known Limitations

- **DeepSeek Reasoner**: uses `reasoning_content` field for thinking process, must be passed back correctly
- **BrowserView DOM overlay**: Electron BrowserView is always above window DOM; panel overlays (history/downloads/bookmarks) use separate BrowserWindow
- **Multi-window downloads**: download state is globally shared
- **macOS**: window controls styled for platform detection, but not tested on actual macOS

---

## License

MIT License -- Author: ww