// El modelo que elige y redacta las noticias: DeepSeek, el mismo que usan los bots del
// ecosistema (`dotrino-bots/src/core/brain.js`). Se le pide JSON, y lo que devuelve es una
// PROPUESTA: quien llama la comprueba en código antes de usarla.

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = process.env.SOCIAL_LLM_MODEL || 'deepseek-chat'

/**
 * @param {{ apiKey:string, messages:{role:string,content:string}[], temperature?:number }} opts
 * @returns {Promise<object>} el JSON que contestó el modelo
 */
export async function askJson ({ apiKey, messages, temperature = 0.3, fetch: f = fetch, timeoutMs = 180000 }) {
  if (!apiKey) throw Object.assign(new Error('missing DEEPSEEK_API_KEY'), { code: 'no-llm-key' })
  const res = await f(DEEPSEEK_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, temperature, response_format: { type: 'json_object' }, messages })
  })
  if (!res.ok) throw Object.assign(new Error(`deepseek → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`), { code: 'llm-http' })
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw Object.assign(new Error(`deepseek → empty answer (${data?.choices?.[0]?.finish_reason})`), { code: 'llm-empty' })
  try {
    return JSON.parse(content)
  } catch {
    throw Object.assign(new Error(`deepseek → not JSON: ${content.slice(0, 200)}`), { code: 'llm-json' })
  }
}
