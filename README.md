# Dawn

A **desktop browser** powered by **Electron 31 + Vue 3 + Vite** with an **AI Agent** that can see, interact with, and navigate web pages autonomously.

## Features

### Browser
- Multi-tab browsing with BrowserView
- Navigation (forward, back, refresh)
- Keyboard shortcuts (Ctrl+T new tab, Ctrl+W close tab, Ctrl+Tab switch, Ctrl+L address bar)
- New tab page with search and shortcuts
- Lovable-inspired design system (cream `#f7f4ed`, Camera Plain Variable font)

### AI Agent (Dawn AI)
- **Page Perception** — Read page content (title, headings, links, body text), take screenshots for vision-capable models
- **Page Operations** — Click elements, fill forms, select dropdowns, scroll, hover, wait for elements
- **Autonomous Browsing** — AI navigates the web, searches, extracts information across multiple pages
- **Task Planning** — Complex tasks broken into ordered steps with progress tracking
- **Tool System** — 14 built-in tools with permission levels (safe/confirm/deny)
- **Multi-Provider** — OpenAI, Anthropic, Google AI, DeepSeek, Moonshot, Zhipu, Qwen, Ollama, LM Studio + custom
- **Streaming** — Real-time streaming responses with Markdown rendering
- **Screenshots** — Send screenshots to Claude/GPT-4o/Gemini for visual analysis

### Slash Commands
Type `/` to open the command palette:
- `/summarize` — Summarize current page
- `/translate [lang]` — Translate page or selection
- `/fix` — Analyze code and suggest fixes
- `/explain` — Explain code or content
- `/grammar` — Check grammar
- `/refine` — Improve writing style
- `/todo` — Extract action items
- `/extract [type]` — Extract data (emails, phones, links)
- `/clear` — Clear conversation
- `/help` — Show all commands

### Plugins
6 built-in plugins:
- **Academic Assistant** — Paper extraction, citation formatting
- **Code Helper** — Bug analysis, refactoring suggestions
- **Reading Mode** — Clean article extraction
- **Shopping Compare** — Product extraction
- **Email Helper** — Drafting and reply assistance
- **Social Helper** — Content generation and analysis

### Data & Security
- IndexedDB persistence for conversations and bookmarks
- API key encryption via Electron safeStorage
- Domain whitelist for autonomous browsing
- Tool permission system with per-tool user overrides

---

## Architecture

```
Dawn/
├── src/
│   ├── AiSidebar.vue              # AI sidebar with chat, plan panel, settings
│   ├── App.vue                    # Main browser UI (tabs, toolbar, address bar)
│   ├── NewTab.vue                 # New tab page
│   ├── main.js / newtab-main.js   # Vue entry points
│   └── composables/
│       ├── useAiChat.js           # AI chat with agent loop, streaming, tool execution
│       ├── useAiConfig.js         # Provider configuration (10 providers)
│       ├── useToolSystem.js       # Tool registry with permission system (14 tools)
│       ├── useAgentLoop.js        # Task planning, plan execution panel
│       ├── useContextManager.js   # Context window management, compaction, loop detection
│       ├── useAutonomousBrowser.js # Domain whitelist, browse trail
│       ├── useSlashCommands.js    # 10 slash commands with keyboard navigation
│       ├── useMarkdown.js         # Full Markdown renderer with code highlighting
│       ├── useMemory.js           # IndexedDB persistence layer
│       ├── usePluginSystem.js     # Plugin loader and lifecycle
│       └── useProactiveAI.js      # Page hints, smart bookmarks, anomaly detection
├── electron/
│   ├── main.cjs                   # Electron main process (BrowserView, IPC, safeStorage)
│   └── preload.js                 # Context-isolated API bridge
├── TODO.md                        # Evolution roadmap
├── DESIGN.md                      # Design system documentation
└── package.json
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Install
```bash
npm install
```

### Development
```bash
npm run electron:dev
```

### Production Build
```bash
npm run build
npm run electron
```

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tabs |
| `Ctrl+L` | Focus address bar |
| `Ctrl+R` / `F5` | Refresh |
| `Ctrl+Shift+A` | Toggle AI sidebar |

---

## AI Agent Usage

### Basic Chat
Click the AI icon in the toolbar to open the sidebar, then type a message.

### Page Analysis
Click the paperclip icon to attach current page content, or the image icon to send a screenshot.

### Autonomous Tasks
Ask Dawn to perform multi-step tasks:
> "Research the top 3 JavaScript frameworks, compare their GitHub stars and recent releases, then summarize."

The Agent will plan steps, browse autonomously, and report results.

### Tool Permissions
In Settings → Tools, you can set each tool to:
- **Safe** — Execute without confirmation
- **Confirm** — Ask before each execution
- **Deny** — Block the tool entirely

---

## Supported AI Providers

| Provider | Models | Format |
|----------|--------|--------|
| OpenAI | gpt-4o, gpt-4o-mini, o1, o3-mini | openai |
| Anthropic | claude-sonnet-4, claude-opus-4, haiku | anthropic |
| Google AI | gemini-2.5-pro, gemini-2.0-flash | google |
| DeepSeek | deepseek-chat, deepseek-reasoner | openai |
| Moonshot | moonshot-v1-8k/32k/128k | openai |
| 智谱 AI | glm-4-plus/flash/air/long | openai |
| 通义千问 | qwen-max/plus/turbo/long | openai |
| Ollama | llama3, qwen2, mistral (local) | openai |
| LM Studio | Any loaded model (local) | openai |
| Custom | OpenAI-compatible endpoints | openai |

---

## Design System

Follows a Lovable-inspired design with warm cream tones:
- Background: `#f7f4ed` (warm cream)
- Text: `#1c1c1c` (charcoal)
- Typography: Camera Plain Variable at weights 400/600
- Borders: `#eceae4` for passive, `rgba(28,28,28,0.4)` for interactive
- See `DESIGN.md` for full design specification

---

## License

MIT
