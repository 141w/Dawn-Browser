const PATTERNS = [
  [/fetch failed|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|Failed to fetch/i, '无法连接服务器。检查网络和 Base URL 设置。'],
  [/401|unauthorized|invalid.*api.?key/i, 'API Key 无效或已过期。请在设置中更新。'],
  [/429|rate.?limit|too many requests/i, '请求太频繁，稍等片刻再试。'],
  [/403|forbidden|access.?denied/i, '访问被拒绝。检查 API Key 权限。'],
  [/500|internal server|server error/i, 'AI 服务暂时故障，稍后再试。'],
  [/timeout|timed.?out|ETIMEDOUT/i, '请求超时。模型可能过载或 Prompt 太长。'],
  [/context.?length|token.?limit|exceeds.*limit/i, '对话太长超出限制。请新建对话。'],
  [/quota|billing|insufficient.*balance/i, 'API 额度用尽。检查账户余额或免费额度。'],
  [/cancelled|aborted|aborted by user/i, '请求已取消。'],
  [/not running in.*dawn|electronAPI.*unavailable/i, '需在 Dawn 浏览器中运行。请用 npm run electron:dev 启动。'],
  [/no active.*tab/i, '没有活跃的浏览标签页。请先打开一个网页。'],
]

export function formatError(error) {
  if (!error) return '发生未知错误。'
  let msg = ''
  if (typeof error === 'string') msg = error
  else if (error instanceof Error) msg = error.message
  else if (typeof error === 'object' && error.message) msg = error.message
  else msg = String(error)

  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(msg)) return friendly
  }

  return msg.length > 200 ? msg.slice(0, 197) + '...' : msg
}
