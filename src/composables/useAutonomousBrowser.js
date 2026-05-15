import { ref } from 'vue'

const domainWhitelist = ref([])
const allowlistMode = ref('ask')
const browseTrail = ref([])
const MAX_TRAIL = 100

function loadWhitelist() {
  const saved = localStorage.getItem('dawn-autobrowse-whitelist')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      domainWhitelist.value = parsed.domains || []
      allowlistMode.value = parsed.mode || 'ask'
    } catch {}
  }
}

function saveWhitelist() {
  localStorage.setItem('dawn-autobrowse-whitelist', JSON.stringify({
    domains: domainWhitelist.value,
    mode: allowlistMode.value
  }))
}

function isDomainAllowed(url) {
  if (allowlistMode.value === 'all') return true
  try {
    const hostname = new URL(url).hostname
    return domainWhitelist.value.some(d => {
      if (d === '*') return true
      if (d.startsWith('*.')) {
        const suffix = d.slice(2)
        return hostname === suffix || hostname.endsWith('.' + suffix)
      }
      return hostname === d || hostname.endsWith('.' + d)
    })
  } catch {
    return false
  }
}

function addDomain(domain) {
  const cleaned = domain.replace(/^https?:\/\//i, '').replace(/\/.*/, '').trim()
  if (!cleaned) return
  if (!domainWhitelist.value.includes(cleaned)) {
    domainWhitelist.value.push(cleaned)
    saveWhitelist()
  }
}

function removeDomain(domain) {
  domainWhitelist.value = domainWhitelist.value.filter(d => d !== domain)
  saveWhitelist()
}

function setMode(mode) {
  allowlistMode.value = mode
  saveWhitelist()
}

function addToTrail(entry) {
  browseTrail.value.unshift({
    ...entry,
    time: Date.now()
  })
  if (browseTrail.value.length > MAX_TRAIL) {
    browseTrail.value = browseTrail.value.slice(0, MAX_TRAIL)
  }
}

function getTrailSummary() {
  if (browseTrail.value.length === 0) return null
  const recent = browseTrail.value.slice(0, 5)
  const domains = [...new Set(recent.map(e => {
    try { return new URL(e.url).hostname } catch { return e.url }
  }))]
  return {
    totalSteps: browseTrail.value.length,
    recentDomains: domains,
    lastAction: recent[0]
  }
}

export function useAutonomousBrowser() {
  loadWhitelist()
  return {
    domainWhitelist,
    allowlistMode,
    browseTrail,
    isDomainAllowed,
    addDomain,
    removeDomain,
    setMode,
    addToTrail,
    getTrailSummary,
    loadWhitelist,
    saveWhitelist
  }
}
