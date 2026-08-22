// Lo puro del bot: cómo se recorta un texto para que quepa en un eco, qué
// enlaces y etiquetas lleva, y cómo se arma el cuerpo de cada red. Sin red, sin
// disco: se prueba en Node a secas.

/** Un eco admite 280 caracteres (el mismo tope que impone la app al publicar). */
export const ECO_MAX = 280

// Mismas reglas que `dotrino-eco/src/feed/feedStore.js` (extractLinks/extractTags):
// un eco del bot tiene que leerse igual que uno escrito en la app.
const URL_RE = /(?:^|[\s(])((?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?:\/[^\s)]*)?)/giu
const FILE_EXT = new Set(['html', 'htm', 'js', 'json', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'txt', 'md'])
const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_]{1,30})/gu

export function extractLinks (text) {
  const out = []
  let m
  while ((m = URL_RE.exec(String(text))) !== null) {
    let u = m[1].replace(/[.,;:!?)]+$/, '')
    if (!/^https?:\/\//i.test(u)) {
      const tld = u.split('/')[0].split('.').pop().toLowerCase()
      if (FILE_EXT.has(tld)) continue
      u = 'https://' + u
    }
    out.push(u)
  }
  return [...new Set(out)].slice(0, 4)
}

export function extractTags (text) {
  const tags = []
  let m
  while ((m = TAG_RE.exec(String(text))) !== null) tags.push(m[1])
  return [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, 6)
}

/**
 * Recorta a ECO_MAX por frase entera (punto, signo de cierre) y, si ni una frase
 * cabe, por palabra con «…». Los #hashtags del final se conservan si caben.
 */
export function fitEco (text, max = ECO_MAX) {
  const t = String(text || '').trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const tags = (t.match(/(?:\s#[\p{L}\p{N}_]+)+$/u) || [''])[0].trim()
  const body = tags ? t.slice(0, t.length - tags.length).trim() : t
  const room = max - (tags ? tags.length + 1 : 0)
  let cut = ''
  const sentences = body.match(/[^.!?]+[.!?]+(?:\s|$)/g) || []
  for (const s of sentences) {
    if ((cut + s).trim().length > room) break
    cut += s
  }
  cut = cut.trim()
  if (!cut) {
    cut = body.slice(0, room - 1)
    cut = cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length).trim() + '…'
  }
  return tags && cut.length + 1 + tags.length <= max ? `${cut} ${tags}` : cut
}

/**
 * Lo que FIRMA un eco. Copia literal de `dotrino-eco/src/feed/canonical.js`: es el
 * contrato de la app y un eco del bot tiene que verificar igual que uno de la app.
 */
export function canonical (eco) {
  return JSON.stringify({
    id: eco.id,
    author: eco.author,
    authorName: eco.authorName,
    text: eco.text,
    links: eco.links,
    tags: eco.tags,
    createdAt: eco.createdAt,
    repostOf: eco.repostOf,
    replyTo: eco.replyTo,
    quoted: eco.quoted,
    media: eco.media || undefined
  })
}

/**
 * El cuerpo de cada red: el texto + el enlace al eco. En X solo cabe el eco (la
 * fuente ya va dentro del eco); en LinkedIn y Discord se citan los dos.
 */
export function bodyFor (platform, { text, source, ecoUrl }) {
  if (platform === 'twitter') return `${text} ${ecoUrl}`
  const lines = [text, '']
  if (source) lines.push(`Fuente: ${source}`)
  lines.push(`En eco: ${ecoUrl}`)
  return lines.join('\n')
}

/**
 * Elige el tópico: el de menor conteo/peso, sin repetir el último si hay empate.
 * Devuelve null si no hay nada que publicar.
 */
export function pickTopic (platformContent, state, { weights = {}, only = null } = {}) {
  let topics = Object.keys(platformContent)
    .filter((t) => !t.startsWith('_') && Array.isArray(platformContent[t]) && platformContent[t].length)
  if (only) topics = topics.filter((t) => t === only)
  if (!topics.length) return null
  for (const t of topics) { state.counts[t] ??= 0; state.idx[t] ??= 0 }
  const w = (t) => (Number(weights[t]) > 0 ? Number(weights[t]) : 1)
  const share = (t) => state.counts[t] / w(t)
  const min = Math.min(...topics.map(share))
  let pool = topics.filter((t) => share(t) === min)
  if (pool.length > 1 && state.lastTopic && pool.includes(state.lastTopic)) {
    const alt = pool.filter((t) => t !== state.lastTopic)
    if (alt.length) pool = alt
  }
  pool.sort((a, b) => w(b) - w(a))
  return pool[0]
}
