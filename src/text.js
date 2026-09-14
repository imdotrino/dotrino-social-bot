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
 * Lo que puede medir cada post redactado por la IA. X: 280 menos el enlace del eco, que
 * X cuenta como 23 más el espacio.
 */
export const POST_LIMITS = {
  twitter: { min: 80, max: 256 },
  linkedin: { min: 250, max: 1100 },
  discord: { min: 120, max: 800 }
}

// Las formas de voseo que se cuelan. No es la gramática entera: es la lista de lo que
// CONVENCIONES §9 prohíbe más lo que un modelo suele escribir en un post («revisá», «activá»).
const VOSEO = [
  'vos', 'podés', 'querés', 'tenés', 'sabés', 'hacés', 'decís', 'venís', 'mirá', 'fijate', 'fijáte', 'acá',
  'andá', 'vení', 'decí', 'hacé', 'poné', 'pensá', 'elegí', 'creá', 'jugá', 'unite', 'pegá', 'probá', 'contá',
  'sumate', 'entrá', 'escribí', 'compartí', 'revisá', 'chequeá', 'animate', 'cuidá', 'protegé', 'leé',
  'descargá', 'activá', 'desactivá', 'configurá', 'usá', 'instalá', 'borrá', 'cambiá', 'evitá', 'preguntá',
  'buscá', 'averiguá', 'guardá', 'esperá', 'mandá', 'dejá', 'empezá', 'enterate', 'informate', 'quedate'
]
const VOSEO_RE = new RegExp(`(?<!\\p{L})(${VOSEO.join('|')})(?!\\p{L})`, 'giu')

/**
 * Los fallos de un post redactado; vacío si se puede publicar. Los mensajes van en
 * inglés (son logs) y se le devuelven tal cual al modelo para que corrija.
 * @returns {string[]}
 */
export function checkPost (platform, text) {
  const lim = POST_LIMITS[platform]
  if (!lim) return [`unknown platform ${platform}`]
  const t = String(text ?? '').trim()
  const problems = []
  if (t.length < lim.min) problems.push(`too short (${t.length} chars, min ${lim.min})`)
  if (t.length > lim.max) problems.push(`too long (${t.length} chars, max ${lim.max})`)
  if (/\p{Extended_Pictographic}/u.test(t)) problems.push('has emoji')
  if (/https?:\/\/|www\./i.test(t)) problems.push('has a link (the system adds the source)')
  if (/dotrino/i.test(t)) problems.push('mentions Dotrino')
  const vos = [...new Set((t.match(VOSEO_RE) || []).map((w) => w.toLowerCase()))]
  if (vos.length) problems.push(`voseo: ${vos.join(', ')}`)
  return problems
}
