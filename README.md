# Dawn

**AI 驱动的桌面浏览器** · Electron 31 + Vue 3 + Vite 6

Dawn 是一款以 AI 为核心的桌面浏览器。内建的 AI Agent 可以看、读、点击、填表，自主完成复杂的网页任务。设计风格温暖克制，灵感来源于清晨第一缕光。

---

## 功能概览

### AI Agent
- **浏览器工具系统**（17 个工具）：导航、读取页面、截图、点击、填表、滚动、执行脚本、搜索、打开本地文件等
- **Agent 模式**：一键切换，AI 可自主浏览网页完成任务
- **多模型支持**：OpenAI、Anthropic、DeepSeek、Google AI、通义千问、智谱、Moonshot、Ollama、LM Studio、自定义兼容接口
- **实时思考过程**：Agent 执行时展示思考状态、工具调用、执行结果
- **Stop / Skip 控制**：随时中断 Agent 或跳过当前工具
- **友好错误提示**：API 错误自动翻译为中文提示
- **对话持久化**：IndexedDB + localStorage 双写，重启不丢失

### 浏览器核心
- **多标签浏览**：Electron BrowserView 原生标签隔离
- **多窗口**：右键"在新窗口打开"创建完整 Dawn 窗口，独立标签栏/工具栏/AI侧栏，互不干扰
- **Ctrl+F 页面查找**：带匹配计数和上下导航
- **Ctrl+H 浏览历史**：日期分组、搜索、一键清除
- **Ctrl+Shift+T 恢复关闭标签**：最多记忆 32 个
- **页面缩放**：Ctrl+= / Ctrl+- / Ctrl+0，每标签独立
- **标签拖拽排序**：HTML5 拖放，蓝色插入指示
- **网站图标**：标签栏自动显示 favicon
- **地址栏右键菜单**：原生剪切/复制/粘贴/全选
- **右键上下文菜单**：前进/后退/刷新/复制/在新窗口打开

### 下载管理器
- 实时进度条、文件大小、下载状态
- 取消下载、打开已完成文件
- 工具栏按钮一键查看

### 书签系统
- 收藏网页和文件
- HTML 格式导入/导出
- 书签管理面板（编辑/删除/搜索）
- 侧栏书签快捷入口

### 标签组管理
- **AI 智能分组**：调用配置的 AI 模型分析标签页内容，自动生成中文分组名称
- **手动管理**：新建组、拖标签入组、右键重命名/删除
- 分组折叠展开、空组拖入提示

### 妙招 & 命令
- 输入 `/` 触发命令面板：摘要、翻译、修复代码、解释、语法检查、提取数据
- 自定义妙招模板，支持 `{page_content}` `{selection}` `{url}` 变量
- 输入 `@` 引用当前页面、截图、选中文本、打开的标签页

### 界面设计
- 暖奶油色设计系统（#f7f4ed）
- Windows 右上角标准窗口控件（缩小/最大化/关闭）
- macOS 左上角红黄绿圆点控件
- 平台自动识别
- 标签侧栏可折叠
- AI 侧栏宽度可拖拽

### 设置 & 隐私
- AI 模型配置（Provider / API Key / Model / Temperature）
- 搜索引擎切换（百度 / Google / Bing / DuckDuckGo）
- 新标签页模式（Dawn 首页 / 空白页 / 自定义网址）
- 退出时清除浏览数据
- 快捷键速查表
- 界面语言（中文 / English）

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+T` | 新建标签 |
| `Ctrl+W` | 关闭标签 |
| `Ctrl+Tab` | 切换下一个标签 |
| `Ctrl+Shift+T` | 恢复关闭的标签 |
| `Ctrl+L` | 聚焦地址栏 |
| `Ctrl+F` | 页面查找 |
| `Ctrl+H` | 浏览历史 |
| `Ctrl+R` / `F5` | 刷新 |
| `Ctrl+=` / `Ctrl+-` | 放大/缩小 |
| `Ctrl+0` | 重置缩放 |
| `Ctrl+Shift+A` | 切换 AI 侧栏 |

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────┐
│                  main.cjs (443行)                │
│  全局下载状态 · 窗口注册表 · IPC 路由 · App 生命周期  │
│         54 个 IPC handler → getDawnWindowByEvent │
└──────────────────────┬──────────────────────────┘
                       │ require
┌──────────────────────▼──────────────────────────┐
│             dawn-window.cjs (796行)              │
│              DawnWindow 类（per-window 实例）      │
│  BrowserWindow · tabs · BrowserView 回调          │
│  AI侧栏 · 面板浮层 · 缩放 · 查找 · 快捷键          │
└──────────────────────┬──────────────────────────┘
                       │ contextBridge
┌──────────────────────▼──────────────────────────┐
│              preload.js (125行)                  │
│     54 个 invoke 方法 · 33 个事件频道 · 白名单过滤    │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              Vue 3 渲染进程 (2921行组件 + 4619行composables)  │
│   App.vue · HomeAI · AiSidebar · ChatInput       │
│   TabSidebar · PanelOverlay · Settings · DocViewer│
└─────────────────────────────────────────────────┘
```

### 多窗口设计

每个 Dawn 窗口是独立的 `DawnWindow` 实例，封装了全部 per-window 状态：

```
windows = Map<BrowserWindow.id, DawnWindow>

DawnWindow {
  win: BrowserWindow          // 原生窗口
  tabs: Map<id, {view, url, title, zoomLevel}>  // 标签集合
  activeTabId                 // 当前活跃标签
  closedTabs[]                // 恢复栈 (max 32)
  aiSidebarOpen / Width       // AI 侧栏状态
  tabSidebarOpen / Width      // 标签侧栏状态
  panelWindow / panelMode     // 面板浮层
}
```

所有 IPC handler 通过 `getDawnWindowByEvent(event)` 路由到正确的 DawnWindow 实例。BrowserView 的 12 个异步回调（did-navigate、page-title-updated、zoom-changed 等）通过 `const self = this` 闭包捕获所属实例，不再依赖全局变量。

### 文件结构

```
Dawn/
├── electron/
│   ├── main.cjs              # 主进程入口（IPC handler，窗口注册表）
│   ├── dawn-window.cjs       # DawnWindow 类（BrowserView/标签/侧栏/面板/缩放/查找/快捷键）
│   ├── dawn-store.cjs        # 跨窗口状态共享（键值存储 + 广播）
│   ├── mcp-manager.cjs       # MCP 协议客户端（连接外部工具服务器）
│   ├── script-runner.cjs     # 脚本执行器（bash/python/node，超时控制）
│   ├── agent-memory.cjs      # Agent 任务持久化（SQLite，任务/步骤记录）
│   ├── agent-sandbox.cjs     # Agent 脚本沙盒（隔离 BrowserWindow 执行）
│   ├── task-scheduler.cjs    # 定时任务调度器（Cron + 优先级队列）
│   └── preload.js            # contextBridge API 桥接（80+ 方法，33 个事件频道）
├── src/
│   ├── App.vue               # 浏览器主界面（工具栏/标签栏/侧栏/查找栏/窗口控件）
│   ├── HomeAI.vue            # AI 首页（对话/Agent 状态/工具展示）
│   ├── AiSidebar.vue         # AI 侧栏浏览模式
│   ├── ChatInput.vue         # 统一输入组件（@引用 / /命令 / Agent 切换）
│   ├── TabSidebar.vue        # 垂直标签侧栏（分组/书签/拖拽入组）
│   ├── PanelOverlay.vue      # BrowserWindow 浮层面板（历史/下载/妙招/书签）
│   ├── BrowserSettings.vue   # 设置页面
│   ├── DocumentViewer.vue    # 文档查看器（PDF/DOCX/XLSX）
│   ├── NewTab.vue            # 新标签页
│   ├── AiFloat.vue           # AI 浮窗
│   └── composables/
│       ├── useAiChat.js          # 核心对话逻辑（流式/缓存/持久化/Agent循环）
│       ├── useToolSystem.js      # 工具注册与权限系统（17 个工具 + MCP）
│       ├── useAiConfig.js        # AI 提供商配置（10 个，API Key 加密存储）
│       ├── useAgentLoop.js       # 任务规划与执行循环
│       ├── useContextManager.js  # Token 计数与上下文压缩（智能循环检测）
│       ├── useMemory.js          # IndexedDB v3 持久化（事务安全）
│       ├── useTabGroups.js       # 标签组管理（AI 分组 + 手动）
│       ├── useAgentMemory.js     # Agent 任务记忆（查看历史任务/步骤）
│       ├── useStore.js           # 跨窗口状态同步
│       ├── useTaskScheduler.js   # 定时任务管理
│       ├── useBookmarks.js       # 书签管理（文件夹/导入/导出）
│       ├── useBrowserTabs.js     # 浏览器标签状态桥接
│       ├── useHistory.js         # 浏览历史
│       ├── useDownloads.js       # 下载管理
│       ├── useSearchEngine.js    # 统一搜索引擎解析
│       ├── useErrorFormat.js     # 友好错误格式化
│       ├── useSlashCommands.js   # / 命令系统
│       ├── useContextRef.js      # @ 引用系统
│       ├── useI18n.js            # 国际化（zh/en）
│       ├── useTips.js            # 妙招模板
│       ├── useDocumentViewer.js  # 文档查看逻辑
│       ├── useMarkdown.js        # Markdown 渲染
│       ├── useProactiveAI.js     # 主动 AI 建议
│       ├── usePluginSystem.js    # 插件系统
│       ├── useSkillSystem.js     # 技能系统
│       └── useAutonomousBrowser.js # 自主浏览
├── index.html                 # 主窗口入口
├── settings.html              # 设置页入口
├── panel-overlay.html         # 浮层面板入口
├── newtab.html                # 新标签页入口
└── package.json
```

### 代码规模

| 模块 | 文件数 | 代码行数 |
|------|--------|----------|
| Electron 主进程 | 3 | 1,364 |
| Vue 组件 | 8 | 2,921 |
| Composables | 26 | 5,237 |
| **合计** | **34** | **8,904** |

---

## 开发

### 环境要求
- Node.js 18+
- npm

### 安装
```bash
npm install
```

### 开发模式
```bash
npm run electron:dev
```
同时启动 Vite 开发服务器和 Electron。

### 生产构建
```bash
npm run build          # 构建前端
npm run electron       # 启动 Electron（生产模式）
npm run pack:win       # 打包 Windows .exe
```

---

## AI Agent 使用指南

### Agent 模式
点击输入框左下角 **Chat/Agent** 切换按钮进入 Agent 模式。在此模式下，AI 自动获得浏览器工具权限。

### 基础对话
Dawn 首页即是 AI 对话界面。直接输入问题即可。

### 浏览时使用 AI
浏览网页时，点击工具栏 AI 图标打开侧栏。使用 `@` 引用页面内容或截图发送给 AI。

### 自主任务
Agent 模式下可以执行多步任务：
> "打开京东搜索机械键盘，对比前三名的价格和评分"

Agent 会自动规划步骤、浏览网页、收集信息并汇报结果。

### 工具权限
设置 → AI 面板 → Tools 标签页可配置每个工具的权限：
- **Safe（安全）**：直接执行
- **Confirm（确认）**：每次询问
- **Deny（拒绝）**：禁止使用

---

## 支持的 AI 提供商

| 提供商 | 模型示例 |
|--------|----------|
| OpenAI | gpt-4o, gpt-4o-mini, o3-mini |
| Anthropic | claude-sonnet-4, claude-3.5-sonnet |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Google AI | gemini-2.5-pro, gemini-2.0-flash |
| 通义千问 | qwen-max, qwen-plus |
| 智谱 AI | glm-4-plus, glm-4-flash |
| Moonshot | moonshot-v1-8k/32k/128k |
| Ollama | llama3, qwen2（本地） |
| LM Studio | 自定义模型（本地） |
| 自定义 | OpenAI 兼容接口 |

---

## 已知限制

- **DeepSeek Reasoner**：该模型使用 `reasoning_content` 字段传递思考过程，需正确回传否则 API 返回 400。已做兼容处理。
- **BrowserView 覆盖 DOM**：Electron 的 BrowserView 作为原生 OS 层级始终位于窗口 DOM 之上。面板浮层（历史/下载/书签/妙招）通过独立 BrowserWindow 实现。
- **多窗口下载**：下载状态为全局共享，所有窗口同步显示下载进度。
- **macOS 适配**：窗口控件样式已做平台识别，但未在 macOS 上实际测试。

---

## 近期改进

### 安全与稳定性
- **API Key 加密存储**：使用 Electron safeStorage 加密，DevTools 中不可见
- **IndexedDB 事务安全**：对话保存改为单次事务，崩溃不会丢数据
- **__dawnAPI 原子注入**：工具执行不再有竞态条件

### Agent 体验
- **Agent 模式仅手动触发**：不再因关键词自动进入 Agent 模式，节省 token
- **循环检测增强**：同工具 3 次即警告，多工具快速交替也会检测
- **上下文压缩改进**：保留最近工具调用和用户话题，长对话不再"失忆"

### 对话管理
- **自动命名**：对话标题取自首条消息，剥离命令前缀和引用标记
- **切换标签不丢对话**：回到新标签页继续之前的对话，不再创建空对话

### 性能
- **导航延迟降低**：Agent 导航后等待从 1.2s 降至 0.3s
- **Gemini 工具调用修复**：ID 不再碰撞，多工具调用顺序正确

---

## 许可证

MIT License · Author: ww
