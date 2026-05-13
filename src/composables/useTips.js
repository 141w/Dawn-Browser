import { ref } from 'vue'

const userTips = ref([])
const scriptHistory = ref([])

const BUILTIN_SCRIPTS = [
  {
    name: '批量下载图片',
    description: '下载当前页面所有可见图片',
    code: `(function() {
  const imgs = document.querySelectorAll('img[src]');
  let count = 0;
  imgs.forEach(img => {
    const a = document.createElement('a');
    a.href = img.src;
    a.download = img.src.split('/').pop() || 'image';
    a.click();
    count++;
  });
  return '下载了 ' + count + ' 张图片';
})()`
  },
  {
    name: '提取所有链接',
    description: '提取页面中所有链接地址',
    code: `(function() {
  const links = Array.from(document.querySelectorAll('a[href]'));
  return links.map(a => ({
    text: (a.textContent || '').trim().slice(0, 60),
    href: a.href
  })).filter(l => l.href && !l.href.startsWith('javascript:'));
})()`
  },
  {
    name: '深色阅读模式',
    description: '为当前页面添加深色背景',
    code: `(function() {
  if (document.getElementById('_dawn_dark_mode')) {
    document.getElementById('_dawn_dark_mode').remove();
    return '已恢复';
  }
  const s = document.createElement('style');
  s.id = '_dawn_dark_mode';
  s.textContent = 'body{background:#1a1a1a!important;color:#ddd!important}*{border-color:#333!important}';
  document.head.appendChild(s);
  return '已启用深色模式';
})()`
  },
  {
    name: '移除广告弹窗',
    description: '尝试移除页面中的常见广告弹窗',
    code: `(function() {
  const selectors = ['.modal', '.popup', '.overlay', '.ad', '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]', '[id*="popup"]', '[id*="modal"]'];
  let removed = 0;
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (el.offsetParent !== null) { el.remove(); removed++; }
    });
  });
  return '移除了 ' + removed + ' 个弹窗元素';
})()`
  }
]

function loadUserTips() {
  const saved = localStorage.getItem('dawn-user-tips')
  userTips.value = saved ? JSON.parse(saved) : []
}

function saveUserTips() {
  localStorage.setItem('dawn-user-tips', JSON.stringify(userTips.value))
}

function addTip(tip) {
  userTips.value.push({
    id: 'tip_' + Date.now().toString(36),
    name: tip.name.startsWith('/') ? tip.name : '/' + tip.name,
    description: tip.description || '',
    category: tip.category || 'custom',
    prompt: tip.prompt || '',
    variables: tip.variables || [],
    createdAt: Date.now(),
    usageCount: 0,
  })
  saveUserTips()
}

function updateTip(id, updates) {
  const idx = userTips.value.findIndex(t => t.id === id)
  if (idx >= 0) {
    userTips.value[idx] = { ...userTips.value[idx], ...updates }
    saveUserTips()
  }
}

function deleteTip(id) {
  userTips.value = userTips.value.filter(t => t.id !== id)
  saveUserTips()
}

function getTip(name) {
  return userTips.value.find(t => t.name === name)
}

function getAllTips() {
  return userTips.value
}

function recordUsage(id) {
  const tip = userTips.value.find(t => t.id === id)
  if (tip) { tip.usageCount++; saveUserTips() }
}

function getBuiltinScripts() {
  return BUILTIN_SCRIPTS
}

async function generateScript(description, aiSendFn) {
  const prompt = `Generate a JavaScript IIFE (Immediately Invoked Function Expression) to accomplish this task on a web page: "${description}"

Rules:
- The script must be a self-executing function: (function() { ... })()
- It runs in the browser context (has access to document, window, DOM APIs)
- Return a string describing what was done
- Use only vanilla JavaScript (no libraries)
- Keep it safe: no data exfiltration, no page redirects
- Handle errors gracefully with try/catch

Reply with ONLY the JavaScript code, no explanation, no markdown formatting.`

  const result = await aiSendFn(prompt)
  return result
}

function addScriptToHistory(description, code, result) {
  scriptHistory.value.unshift({
    id: 'scr_' + Date.now().toString(36),
    description,
    code,
    result,
    time: Date.now(),
  })
  if (scriptHistory.value.length > 50) scriptHistory.value = scriptHistory.value.slice(0, 50)
}

export function useTips() {
  loadUserTips()
  return {
    userTips,
    scriptHistory,
    BUILTIN_SCRIPTS,
    loadUserTips,
    saveUserTips,
    addTip,
    updateTip,
    deleteTip,
    getTip,
    getAllTips,
    recordUsage,
    getBuiltinScripts,
    generateScript,
    addScriptToHistory,
  }
}
