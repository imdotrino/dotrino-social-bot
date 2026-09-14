// Las noticias candidatas: lo que publicaron en los últimos días los medios de
// `content/feeds.json`.
//
// Por qué feeds y no un buscador: un feed trae la FECHA de publicación y un enlace que
// existe, las dos cosas que un post informado no puede inventarse. La IA elige y redacta
// (`news.js`); de dónde sale la noticia y de cuándo es lo decide esto, en código.

import { download } from './image.js'

const DAY = 24 * 60 * 60 * 1000
/** Un feed con cientos de entradas (noyb trae 286) cabe de sobra. */
export const FEED_MAX_BYTES = 5 * 1024 * 1024
/** Lo que aporta cada medio como mucho: que uno que publica 50 al día no tape a los demás. */
export const PER_FEED_MAX = 12

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities (s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Texto plano de un fragmento HTML: sin etiquetas, con las entidades resueltas. */
export function plainText (html) {
  return decodeEntities(String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** El contenido crudo de la primera etiqueta de `names` que exista y no esté vacía. */
function field (block, names) {
  for (const name of names) {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
    if (m && m[1].trim()) return m[1]
  }
  return ''
}

/** CDATA va tal cual; lo demás viene escapado (un `&lt;p&gt;` es un `<p>`). */
function unwrap (raw) {
  const s = String(raw).trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(s)
  return cdata ? cdata[1] : decodeEntities(s)
}

/** Atom: `<link rel="alternate" href="…"/>` (sin `rel` también es alternate). */
function atomLink (block) {
  let first = ''
  for (const m of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(m[1])?.[1]
    if (!href) continue
    const rel = /rel\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] || 'alternate'
    if (rel === 'alternate') return decodeEntities(href)
    first ||= decodeEntities(href)
  }
  return first
}

/**
 * Las entradas de un feed RSS 2.0 o Atom. Se descarta la que no tenga título, enlace
 * http(s) o fecha legible: sin fecha no se puede saber si es noticia.
 * @returns {{ title:string, url:string, publishedAt:number, summary:string }[]}
 */
export function parseFeed (xml, feedUrl) {
  const out = []
  for (const [, , block] of String(xml).matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const title = plainText(unwrap(field(block, ['title'])))
    const link = unwrap(field(block, ['link'])) || atomLink(block)
    // `published` antes que `updated`: una entrada vieja retocada no es una noticia nueva.
    const publishedAt = Date.parse(unwrap(field(block, ['pubDate', 'published', 'dc:date', 'updated'])))
    const summary = plainText(unwrap(field(block, ['description', 'summary', 'content:encoded', 'content']))).slice(0, 600)
    let url
    try { url = new URL(link, feedUrl).href } catch { continue }
    if (!title || !/^https?:\/\//i.test(url) || !Number.isFinite(publishedAt)) continue
    out.push({ title, url, publishedAt, summary })
  }
  return out
}

/** La misma noticia con otro `utm_`, otra `www.` u otra barra final sigue siendo la misma. */
export function normalizeUrl (u) {
  try {
    const x = new URL(u)
    for (const k of [...x.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i.test(k)) x.searchParams.delete(k)
    }
    const host = x.hostname.replace(/^www\./, '')
    return `${host}${x.pathname.replace(/\/+$/, '')}${x.search}`.toLowerCase()
  } catch {
    return String(u).toLowerCase()
  }
}

/**
 * Lo publicado por los medios desde `since`, sin duplicados, de lo más nuevo a lo más
 * viejo. Un medio caído se informa en `failed` y no para a los demás; que caigan TODOS
 * lo decide quien llama.
 * @param {{ name:string, url:string, lang?:string }[]} feeds
 */
export async function fetchFeeds (feeds, { since, now = Date.now(), fetch: f = fetch } = {}) {
  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const xml = await download(feed.url, FEED_MAX_BYTES, { fetch: f, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' })
    const items = parseFeed(xml.toString('utf8'), feed.url)
    // Un feed que responde y no da ni una entrada es un parser roto o un medio que cambió
    // de formato: se dice, no se toma por «hoy no publicó nada».
    if (!items.length) throw new Error('no entries parsed')
    return items
      .filter((it) => it.publishedAt >= since && it.publishedAt <= now + DAY)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, PER_FEED_MAX)
      .map((it) => ({ ...it, outlet: feed.name, lang: feed.lang || null }))
  }))
  const failed = []
  const seen = new Set()
  const items = []
  settled.forEach((r, i) => {
    if (r.status === 'rejected') { failed.push(`${feeds[i].name}: ${r.reason?.message}`); return }
    for (const it of r.value) {
      const k = normalizeUrl(it.url)
      if (seen.has(k)) continue
      seen.add(k)
      items.push(it)
    }
  })
  items.sort((a, b) => b.publishedAt - a.publishedAt)
  return { items, failed }
}
