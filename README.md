# Dawn

**AI 驱动的桌面浏览器** · Electron 31 + Vue 3 + Vite

Dawn 是一款以 AI 为核心的桌面浏览器。它不仅仅是浏览网页的工具——内建的 AI Agent 可以看、读、点击、填表，自主完成复杂的网页任务。设计风格温暖克制，灵感来源于清晨第一缕光。

---

## 功能概览

### 🧠 AI Agent
- **浏览器工具系统**（16 个工具）：导航、读取页面、截图、点击、填表、滚动、执行脚本、搜索、打开本地文件
- **Agent 模式**：一键切换，AI 可自主浏览网页完成任务
- **多模型支持**：OpenAI、Anthropic、DeepSeek、Google AI、通义千问、智谱、Moonshot、Ollama、LM Studio、自定义兼容接口
- **实时思考过程**：Agent 执行时展示思考状态、工具调用、执行结果
- **Stop / Skip 控制**：随时中断 Agent 或跳过当前工具
- **友好错误提示**：API 错误自动翻译为中文提示
- **对话持久化**：IndexedDB + localStorage 双写，重启不丢失

### 🌐 浏览器核心
- **多标签浏览**：Electron BrowserView 原生标签隔离
- **Ctrl+F 页面查找**：带匹配计数和上下导航
- **Ctrl+H 浏览历史**：日期分组、搜索、一键清除
- **Ctrl+Shift+T 恢复关闭标签**：最多记忆 32 个
- **页面缩放**：Ctrl+= / Ctrl+- / Ctrl+0，每标签独立
- **标签拖拽排序**：HTML5 拖放，蓝色插入指示
- **网站图标**：标签栏自动显示 favicon
- **地址栏右键菜单**：原生剪切/复制/粘贴/全选
- **右键上下文菜单**：前进/后退/刷新/复制/在新窗口打开

### 📥 下载管理器
- 实时进度条、文件大小、下载状态
- 取消下载、打开已完成文件
- 工具栏按钮一键查看

### ⭐ 书签系统
- 收藏网页和文件
- HTML 格式导入/导出
- 书签管理面板（编辑/删除/搜索）
- 侧栏书签快捷入口

### 📑 标签组管理
- **AI 智能分组**：调用配置的 AI 模型分析标签页内容，自动生成中文分组名称
- **手动管理**：新建组、拖标签入组、右键重命名/删除
- 分组折叠展开、空组拖入提示

### ⚡ 妙招 & 命令
- 输入 `/` 触发命令面板：摘要、翻译、修复代码、解释、语法检查、提取数据
- 自定义妙招模板，支持 `{page_content}` `{selection}` `{url}` 变量
- 输入 `@` 引用当前页面、截图、选中文本、打开的标签页

### 🎨 界面设计
- 暖奶油色设计系统（#f7f4ed）
- Windows 右上角标准窗口控件（缩小/最大化/关闭）
- macOS 左上角红黄绿圆点控件
- 平台自动识别
- 标签侧栏可折叠
- AI 侧栏宽度可拖拽

### 🔒 设置 & 隐私
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

```
Dawn/
├── electron/
│   ├── main.cjs              # Electron 主进程（29 个 IPC handler）
│   ├── preload.js            # contextBridge API 桥接（36 个方法）
│   └── dawn-window.js        # 多窗口类（实验性）
├── src/
│   ├── App.vue               # 浏览器主界面（工具栏/标签栏/侧栏）
│   ├── HomeAI.vue            # AI 首页（对话/Agent 状态/工具展示）
│   ├── AiSidebar.vue         # AI 侧栏浏览模式
│   ├── ChatInput.vue         # 统一输入组件（@引用 / /命令 / Agent 切换）
│   ├── TabSidebar.vue        # 垂直标签侧栏（分组/书签/拖拽入组）
│   ├── PanelOverlay.vue      # BrowserWindow 浮层面板（历史/下载/妙招/书签）
│   ├── BrowserSettings.vue   # 设置页面
│   ├── DocumentViewer.vue    # 文档查看器（PDF/DOCX/XLSX）
│   └── composables/
│       ├── useAiChat.js      # 核心对话逻辑（流式/缓存/持久化）
│       ├── useAiConfig.js    # AI 提供商配置（10 个）
│       ├── useAgentLoop.js   # 任务规划与执行循环
│       ├── useToolSystem.js  # 工具注册与权限系统（16 个工具）
│       ├── useContextManager.js # Token 计数与上下文压缩
│       ├── useMemory.js       # IndexedDB 持久化
│       ├── useBrowserTabs.js  # 浏览器标签状态
│       ├── useTabGroups.js    # 标签组管理（AI 分组 + 手动）
│       ├── useBookmarks.js    # 书签管理（文件夹/导入/导出）
│       ├── useHistory.js      # 浏览历史
│       ├── useDownloads.js    # 下载管理
│       ├── useSearchEngine.js # 统一搜索引擎解析
│       ├── useErrorFormat.js  # 友好错误格式化
│       ├── useSlashCommands.js # / 命令系统
│       ├── useContextRef.js   # @ 引用系统
│       └── useI18n.js         # 国际化（zh/en）
├── index.html                 # 主窗口入口
├── settings.html              # 设置页入口
├── panel-overlay.html         # 浮层面板入口
└── package.json
```

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

## 许可证

MIT License · Author: ww
