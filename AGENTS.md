# AGENTS.md — Dawn Browser

## Project Overview

Dawn is an Electron 31 + Vue 3 + Vite 6 AI-powered desktop browser. It features an integrated AI assistant (chat/agent mode), browser automation, skill/plugin system, and multi-tab browsing.

## Tech Stack

- **Runtime**: Electron 31 (Chromium)
- **Frontend**: Vue 3 (Composition API, `<script setup>`)
- **Build**: Vite 6, electron-builder
- **Language**: JavaScript (ES Modules in src/, CommonJS in electron/)
- **State**: Vue `ref()`/`computed()` singletons in composables (no Pinia/Vuex)

## Project Structure

```
electron/           # Main process (Node.js, CommonJS .cjs)
  main.cjs          # Entry point, IPC handlers
  dawn-window.cjs   # BrowserWindow + WebContentsView tab management
  preload.cjs       # contextBridge API (electronAPI)
  skill-manager.cjs # Skill install/uninstall (GitHub, ZIP)
  mcp-manager.cjs   # MCP server management
  agent-memory.cjs  # IndexedDB-based agent memory
  agent-sandbox.cjs # Sandboxed script execution
  dawn-store.cjs    # Persistent key-value store
src/                # Renderer process (ES Modules, Vue 3)
  composables/      # Shared state & logic (useXxx.js pattern)
  *.vue             # UI components
  main.js           # Main window entry
  newtab-main.js    # New tab entry
  ai-float-main.js  # AI float entry
  settings-main.js  # Settings page entry
  theme.css         # CSS variables for light/dark themes
skills/             # Bundled skills (SKILL.md + assets)
```

## Key Architecture Patterns

### Composables as Singletons
All `src/composables/useXxx.js` files export functions that reference module-level `ref()` singletons. Multiple components importing the same composable share the same reactive state. This is intentional — do not refactor to create new instances.

### File Extensions
- `electron/*.cjs` — CommonJS (Electron main process)
- `src/**/*.js` — ES Modules (Vite renderer)
- Never mix: do not use `require()` in `src/` or `import` in `electron/*.cjs`

### No BOM Characters
All source files MUST be UTF-8 without BOM. BOM characters (EF BB BF) break Vite's module transformation, causing `Failed to resolve module specifier` errors and white screens.

### Theme System
- CSS variables defined in `src/theme.css` (`:root` for light, `[data-theme="dark"]` for dark)
- All components must use `var(--color-xxx)` instead of hardcoded hex colors
- Theme applied via `applyThemeFromStorage()` before Vue mounts

### i18n
- All user-facing strings must use `t('key')` from `src/composables/useI18n.js`
- Keys defined in `zh` and `en` objects inside that file
- No hardcoded Chinese/English strings in components

## Common Pitfalls

1. **Port conflict**: Vite uses port 1420 (strictPort). Kill existing processes before restarting.
2. **Electron cache**: Cache permission errors are harmless (cosmetic).
3. **importMapPlugin**: Removed — Vite 6 handles bare specifier resolution natively.
4. **File locks**: `vite.config.js` gets locked by the dev server. Stop the server before editing.

## Build & Run

```bash
npm run dev           # Start Vite dev server only
npm run electron:dev  # Start Vite + Electron concurrently
npm run build         # Build for production
npm run pack:win      # Build + package for Windows
```

## Git Workflow

- Branch prefix: `codex/` (for Codex-created branches)
- Commit messages: concise, imperative mood
- Do not commit `node_modules/`, `dist/`, `_cleanup/`, or temp files

## Relay Push (Sandbox Environment)

If running inside a sandbox with restricted network:

```powershell
# Local git ops (sandbox-safe)
git add .
git commit -m "message"

# Push via relay daemon (must be running in external terminal)
F:\git-relay\git-relay-send.ps1 -Action push -Repo "F:\AAA-pro\Dawn" -Message "commit message"

# If relay fails, user must run manually:
git push -u origin main
```

Relay daemon: `F:\git-relay\git-relay-daemon.ps1`
Queue path: `F:\git-relay\queue\pending\`