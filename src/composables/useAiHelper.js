import { useAiConfig } from './useAiConfig'

/**
 * Lightweight non-streaming AI call for tasks like tab grouping.
 * Returns the text content from the AI response.
 */
export async function callAI(systemPrompt, userPrompt, options = {}) {
  const { config, getEffectiveModel, getEffectiveBaseUrl, getApiFormat } = useAiConfig()
  const apiKey = config.value.apiKey
  if (!apiKey) throw new Error('API Key not configured')

  const format = options.format || getApiFormat()
  const model = options.model || getEffectiveModel()
  const baseUrl = options.baseUrl || getEffectiveBaseUrl()
  const maxTokens = options.maxTokens || 1024
  const temperature = options.temperature ?? 0.2

  let content = ''

  if (format === 'anthropic') {
    let url = baseUrl.replace(/\/+$/, '')
    if (!url.endsWith('/messages')) url += '/messages'
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: maxTokens,
        temperature
      })
    })
    if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`)
    const data = await resp.json()
    content = data.content?.[0]?.text || ''
  } else if (format === 'google') {
    const url = `${baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature }
      })
    })
    if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`)
    const data = await resp.json()
    content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } else {
    // OpenAI / DeepSeek / compatible
    let url = baseUrl.replace(/\/+$/, '')
    if (!url.endsWith('/chat/completions')) url += '/chat/completions'
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature,
        stream: false
      })
    })
    if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`)
    const data = await resp.json()
    content = data.choices?.[0]?.message?.content || ''
  }

  return content
}

/**
 * Parse JSON from AI response, handling markdown code fences.
 */
export function parseAIJson(content) {
  let jsonStr = content.trim()
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) jsonStr = fenceMatch[1].trim()
  return JSON.parse(jsonStr)
}
