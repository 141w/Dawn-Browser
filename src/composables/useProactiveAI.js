import { ref } from 'vue'

const pageHints = ref([])
const smartBookmarks = ref([])
const anomalyAlerts = ref([])
const dailyBrief = ref(null)

const PHISHING_PATTERNS = [
  { pattern: /login.*account.*verify/i, risk: 'medium', hint: 'Possible phishing page detected - verify sender identity' },
  { pattern: /urgent.*action.*required/i, risk: 'medium', hint: 'Urgency language detected - exercise caution' },
  { pattern: /congratulations.*winner/i, risk: 'high', hint: 'Prize/winner scam likelihood high' },
  { pattern: /http:(?!\/\/)/i, risk: 'low', hint: 'Page uses HTTP (not HTTPS) - data may not be encrypted' }
]

const FORM_DETECTION_PATTERNS = [
  { pattern: /sign.*(in|up)|log.*in|register/i, hint: 'Login form detected - would you like auto-fill?', action: 'auto-fill' },
  { pattern: /checkout|payment|billing|shipping/i, hint: 'Checkout form detected - would you like assistance?', action: 'auto-fill' },
  { pattern: /subscribe|newsletter|email/i, hint: 'Subscription form detected', action: 'fill' }
]

const LANGUAGE_PATTERNS = [
  { pattern: /[\u4e00-\u9fff]/, hint: 'Chinese content detected - translate available', action: 'translate' },
  { pattern: /[\u3040-\u309f\u30a0-\u30ff]/, hint: 'Japanese content detected - translate available', action: 'translate' },
  { pattern: /[\uac00-\ud7af]/, hint: 'Korean content detected - translate available', action: 'translate' },
  { pattern: /[äöüß]/, hint: 'German content detected - translate available', action: 'translate' }
]

const PRODUCT_PATTERNS = [
  { pattern: /price.*\$|¥\d+|€\d+|£\d+|RMB.*\d+/i, hint: 'Product pricing detected - compare prices?', action: 'compare' }
]

function analyzePage(pageContent) {
  if (!pageContent) return

  const hints = []
  const text = (pageContent.title || '') + ' ' + (pageContent.bodyText || '').substring(0, 3000)

  for (const rule of PHISHING_PATTERNS) {
    if (rule.pattern.test(text)) {
      hints.push({ type: 'security', level: rule.risk, message: rule.hint, action: 'warn' })
      if (rule.risk === 'high') {
        anomalyAlerts.value.unshift({
          type: 'phishing',
          url: pageContent.url,
          message: rule.hint,
          time: Date.now()
        })
        if (anomalyAlerts.value.length > 20) anomalyAlerts.value = anomalyAlerts.value.slice(0, 20)
      }
    }
  }

  for (const rule of FORM_DETECTION_PATTERNS) {
    if (rule.pattern.test(text)) {
      hints.push({ type: 'form', message: rule.hint, action: rule.action })
    }
  }

  for (const rule of LANGUAGE_PATTERNS) {
    if (rule.pattern.test(text)) {
      hints.push({ type: 'language', message: rule.hint, action: rule.action })
    }
  }

  for (const rule of PRODUCT_PATTERNS) {
    if (rule.pattern.test(text)) {
      hints.push({ type: 'shopping', message: rule.hint, action: rule.action })
    }
  }

  pageHints.value = hints
  return hints
}

function addSmartBookmark(pageMeta) {
  if (!pageMeta?.url || pageMeta.url === 'dawn://newtab') return

  const existing = smartBookmarks.value.find(b => b.url === pageMeta.url)
  if (existing) {
    existing.visitCount = (existing.visitCount || 1) + 1
    existing.lastVisit = Date.now()
    return
  }

  const domain = (() => {
    try { return new URL(pageMeta.url).hostname } catch { return pageMeta.url }
  })()

  const categories = classifyBookmark(domain, pageMeta.title)

  smartBookmarks.value.unshift({
    url: pageMeta.url,
    title: pageMeta.title,
    domain,
    visitCount: 1,
    firstVisit: Date.now(),
    lastVisit: Date.now(),
    categories
  })

  if (smartBookmarks.value.length > 500) {
    smartBookmarks.value = smartBookmarks.value.slice(0, 500)
  }

  localStorage.setItem('dawn-smart-bookmarks', JSON.stringify(smartBookmarks.value))
}

function classifyBookmark(domain, title) {
  const cats = []
  const text = (domain + ' ' + (title || '')).toLowerCase()

  if (/github\.com|gitlab\.com|bitbucket/i.test(text)) cats.push('dev')
  if (/stackoverflow|docs\.|documentation|api\.|reference/i.test(text)) cats.push('reference')
  if (/arxiv|scholar|research|paper|journal|doi/i.test(text)) cats.push('academic')
  if (/youtube|bilibili|twitch|netflix|video/i.test(text)) cats.push('media')
  if (/twitter|x\.com|weibo|reddit|social/i.test(text)) cats.push('social')
  if (/amazon|taobao|jd\.com|shop|store|buy|price/i.test(text)) cats.push('shopping')
  if (/gmail|outlook|mail\.|webmail/i.test(text)) cats.push('email')
  if (/news|blog|article|post/i.test(text)) cats.push('news')
  if (!cats.length) cats.push('other')

  return cats
}

function loadSmartBookmarks() {
  const saved = localStorage.getItem('dawn-smart-bookmarks')
  if (saved) {
    try { smartBookmarks.value = JSON.parse(saved) } catch {}
  }
}

function getBookmarksByCategory() {
  const cats = {}
  for (const bm of smartBookmarks.value) {
    for (const cat of bm.categories || ['other']) {
      if (!cats[cat]) cats[cat] = []
      cats[cat].push(bm)
    }
  }
  return cats
}

function getFrequentBookmarks(limit = 10) {
  return [...smartBookmarks.value]
    .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
    .slice(0, limit)
}

function generateDailyBrief() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todayBookmarks = smartBookmarks.value.filter(b => b.lastVisit >= today.getTime())
  const frequentDomains = {}
  for (const bm of todayBookmarks) {
    frequentDomains[bm.domain] = (frequentDomains[bm.domain] || 0) + 1
  }

  const topDomains = Object.entries(frequentDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, visits: count }))

  dailyBrief.value = {
    date: today.toISOString().slice(0, 10),
    pagesVisited: todayBookmarks.length,
    topDomains,
    alertsToday: anomalyAlerts.value.filter(a => a.time >= today.getTime()).length
  }
}

export function useProactiveAI() {
  loadSmartBookmarks()
  return {
    pageHints,
    smartBookmarks,
    anomalyAlerts,
    dailyBrief,
    analyzePage,
    addSmartBookmark,
    getBookmarksByCategory,
    getFrequentBookmarks,
    generateDailyBrief
  }
}
