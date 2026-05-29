import { t } from './useI18n'

const PATTERNS = [
  [/fetch failed|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|Failed to fetch/i, 'error.connection'],
  [/401|unauthorized|invalid.*api.?key/i, 'error.apiKey'],
  [/429|rate.?limit|too many requests/i, 'error.rateLimit'],
  [/403|forbidden|access.?denied/i, 'error.forbidden'],
  [/500|internal server|server error/i, 'error.serverError'],
  [/timeout|timed.?out|ETIMEDOUT/i, 'error.timeout'],
  [/context.?length|token.?limit|exceeds.*limit/i, 'error.contextLength'],
  [/quota|billing|insufficient.*balance/i, 'error.quota'],
  [/cancelled|aborted|aborted by user/i, 'error.cancelled'],
  [/not running in.*dawn|electronAPI.*unavailable/i, 'error.noTab'],
  [/no active.*tab/i, 'error.noTab'],
]

export function formatError(error) {
  if (!error) return t('error.stream')
  let msg = ''
  if (typeof error === 'string') msg = error
  else if (error instanceof Error) msg = error.message
  else if (typeof error === 'object' && error.message) msg = error.message
  else msg = String(error)

  for (const [pattern, i18nKey] of PATTERNS) {
    if (pattern.test(msg)) return t(i18nKey)
  }

  return msg.length > 200 ? msg.slice(0, 197) + '...' : msg
}
