import { useAiConfig } from './useAiConfig'

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  duckduckgo: 'https://duckduckgo.com/?q=',
}

export function resolveUrl(input, engine = 'baidu') {
  const v = input.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (/^dawn:\/\//i.test(v)) return v
  if (/^file:\/\/\//i.test(v)) return v
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(v)) return 'https://' + v
  const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.baidu
  return base + encodeURIComponent(v)
}

export function useSearchEngine() {
  const { config } = useAiConfig()
  return {
    resolve: (input) => resolveUrl(input, config.value?.searchEngine || 'baidu'),
    engine: config.value?.searchEngine || 'baidu'
  }
}
