// Las noticias del bot: se buscan A DIARIO, las elige y redacta la IA y se comprueban en
// código.
//
// Existe porque el contenido era un archivo escrito a mano el 2026-08-22 que nadie volvió
// a tocar: el bot rotó las mismas seis noticias durante tres semanas, una de ellas de
// 2021. Ahora `refresh` mantiene noticias de los últimos días redactadas y listas, y
// `pickNews` no entrega nada más viejo que `POST_MAX_AGE_MS`. Si no hay ninguna fresca,
// el post NO sale: publicar una vieja es justo el fallo que esto quita.
//
// El reparto del trabajo, y no se cruza:
//   - de dónde sale la noticia y de cuándo es  → feeds.js, con la fecha que pone el medio
//   - cuál vale la pena y cómo se cuenta       → el modelo (llm.js), con los prompts de aquí
//   - si lo redactado cumple las reglas        → checkPost (text.js)

import { download, metaTags } from './image.js'
import { fetchFeeds, normalizeUrl, plainText } from './feeds.js'
import { askJson } from './llm.js'
import { checkPost } from './text.js'
import { feedsPath, poolPath, statePath, readJson, writeJson } from './paths.js'

const DAY = 24 * 60 * 60 * 1000
/** Lo más vieja que puede ser una noticia al publicarse. */
export const POST_MAX_AGE_MS = 3 * DAY
/** Lo más vieja que puede ser al elegirla: le deja al menos un día para salir. */
export const CANDIDATE_MAX_AGE_MS = 2 * DAY
/** Noticias frescas y sin publicar que se quieren tener listas: una por red al día. */
export const POOL_TARGET = 3
/** Lo que se recuerda del pool, para no volver a elegir lo ya elegido. */
export const POOL_KEEP_MS = 30 * DAY
export const MAX_CANDIDATES = 120
export const ARTICLE_MAX_BYTES = 3 * 1024 * 1024
export const ARTICLE_MAX_CHARS = 6000
/** Menos texto que esto no da para contar una noticia sin inventar. */
export const MIN_SOURCE_CHARS = 300
export const PLATFORM_KEYS = ['twitter', 'linkedin', 'discord']

export const readPool = () => readJson(poolPath(), { items: [] })
export const readState = () => readJson(statePath(), {})
export const writeState = (all) => writeJson(statePath(), all)

export function readFeeds () {
  const feeds = readJson(feedsPath(), null)?.feeds
  if (!Array.isArray(feeds) || !feeds.length) throw Object.assign(new Error(`${feedsPath()}: no feeds`), { code: 'no-feeds' })
  return feeds
}

const iso = (ms) => new Date(ms).toISOString()
const isFresh = (item, now) => now - Date.parse(item.publishedAt) <= POST_MAX_AGE_MS

/** Qué fuentes salieron ya y en qué redes: url normalizada → Set(red). */
export function publishedSources (state) {
  const out = new Map()
  for (const [platform, s] of Object.entries(state || {})) {
    for (const h of s?.history || []) {
      if (!h.source) continue
      const k = normalizeUrl(h.source)
      if (!out.has(k)) out.set(k, new Set())
      out.get(k).add(platform)
    }
  }
  return out
}

/**
 * La noticia que le toca a una red: fresca, redactada para esa red y sin publicar en
 * ella. Entre esas, la que no salió en NINGUNA red (así cada red cuenta una distinta
 * mientras haya) y, a igualdad, la más reciente. `null` si no hay ninguna.
 */
export function pickNews (pool, state, platform, { now = Date.now() } = {}) {
  const published = publishedSources(state)
  const open = (pool?.items || [])
    .filter((it) => isFresh(it, now) && it.texts?.[platform] && !published.get(normalizeUrl(it.source))?.has(platform))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  return open.find((it) => !published.has(normalizeUrl(it.source))) || open[0] || null
}

/** Cuántas noticias frescas quedan sin publicar en ninguna red. */
export function readyCount (pool, state, { now = Date.now() } = {}) {
  const published = publishedSources(state)
  return (pool?.items || []).filter((it) => isFresh(it, now) && !published.has(normalizeUrl(it.source))).length
}

/**
 * Lo que se usa de un artículo: la fecha que declara y su texto. La fecha del artículo
 * manda sobre la del feed: hay feeds que vuelven a listar entradas viejas.
 */
export function articleFrom (html) {
  const s = String(html)
  const meta = metaTags(s)
  const ld = /"datePublished"\s*:\s*"([^"]+)"/.exec(s)?.[1]
  const publishedAt = [meta['article:published_time'], meta['og:published_time'], meta.date, meta['dc.date'], ld]
    .map((d) => Date.parse(d || ''))
    .find(Number.isFinite)
  const text = [...s.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => plainText(m[1]))
    .filter((p) => p.length >= 60)
    .join('\n')
    .slice(0, ARTICLE_MAX_CHARS)
  return { publishedAt: publishedAt ?? null, description: meta['og:description'] ? plainText(meta['og:description']) : null, text }
}

export const SELECT_PROMPT = `Eres el editor de las cuentas de Dotrino en X, LinkedIn y Discord. Cada día eliges noticias recientes para contarlas.

Qué buscas, en este orden:
1. Privacidad de los datos personales: qué se recoge de las personas, quién lo ve, cómo se protege, y las decisiones de reguladores y tribunales que lo cambian.
2. Seguridad digital que afecta a la gente común: filtraciones que tocan datos de usuarios, cambios como las llaves de acceso sin contraseña, el cifrado de los mensajes.
3. Inteligencia artificial y datos personales: entrenar con datos de usuarios, la voz y la cara, la identidad.
4. Soberanía de la información: código abierto, tener los datos en infraestructura propia, depender menos de un solo proveedor.

Descarta: ofertas y reseñas de productos, notas de empresas que venden algo, avisos técnicos de una vulnerabilidad de un producto empresarial sin impacto claro en las personas, criptomonedas, rumores, columnas de opinión sin un hecho nuevo, y temas que ya se contaron hace poco (te paso esos títulos).
Si varios medios cuentan lo mismo, elige UNA sola: la que mejor lo explique.
Prefiere lo que le importa a una persona de Latinoamérica o de España, sin descartar lo global.

Responde SOLO con JSON: {"picks":[{"i":<número de la candidata>,"why":"<una frase>"}]}, de la mejor a la peor.`

export const WRITE_PROMPT = `Redactas los posts de las cuentas de Dotrino a partir de UNA noticia. Te paso el texto del medio: es lo único que sabes de ella. Escribes tres versiones de la misma noticia.

Reglas duras (se comprueban y, si fallan, el post se descarta):
- Español neutro con TUTEO. Nunca voseo: nada de "podés", "querés", "tenés", "mirá", "fijate", "acá", "vos"; se dice "puedes", "quieres", "tienes", "mira", "fíjate", "aquí", "tú".
- Sin emojis. Sin enlaces: el de la fuente lo añade el sistema.
- No menciones a Dotrino ni lo que Dotrino hace. Nada de llamadas a la acción ("descarga", "únete", "síguenos").
- Solo hechos que estén en el texto del medio. No inventes cifras, fechas, nombres ni citas: si el texto no da un dato, no lo pongas.
- Atribuye al medio: "Según <medio>…", "<medio> informa que…".
- Si la noticia está en inglés, cuéntala en español.

Tono: sobrio e informativo. Cuenta el hecho y por qué importa para los datos de las personas. Sin alarmismo ni adjetivos de miedo. No hables de "atacantes", "estafadores" o "delincuentes" en general; si la noticia trata de una organización concreta, nombrarla está bien, porque es el hecho.

Las tres versiones:
- "twitter": entre 120 y 250 caracteres EN TOTAL, contando uno o dos hashtags al final (#privacidad, #ciberseguridad, #IA…).
- "linkedin": entre 400 y 1000 caracteres. Registro profesional: el hecho, el contexto y la consecuencia práctica. Uno o dos hashtags al final.
- "discord": entre 200 y 700 caracteres. Conversacional y en tuteo, como quien comenta la noticia con la comunidad. Sin hashtags.

Responde SOLO con JSON: {"twitter":"…","linkedin":"…","discord":"…"}`

/**
 * El modelo elige, entre las candidatas, hasta `count` noticias. Solo se aceptan índices
 * que existan: lo que no se pueda atar a una candidata no pasa.
 */
export async function selectNews ({ apiKey, candidates, recentTitles = [], count, ask = askJson }) {
  const list = candidates.map((c, i) => `[${i}] (${c.outlet}, ${iso(c.publishedAt).slice(0, 10)}) ${c.title} — ${c.summary.slice(0, 220)}`)
  const user = [
    `Elige hasta ${count} noticias.`,
    '',
    'Títulos que ya se contaron hace poco (no repitas el tema):',
    ...(recentTitles.length ? recentTitles.map((t) => `- ${t}`) : ['- (ninguno)']),
    '',
    'Candidatas:',
    ...list
  ].join('\n')
  const out = await ask({ apiKey, messages: [{ role: 'system', content: SELECT_PROMPT }, { role: 'user', content: user }] })
  const chosen = []
  const seen = new Set()
  for (const p of Array.isArray(out?.picks) ? out.picks : []) {
    const i = Number(p?.i)
    if (!Number.isInteger(i) || !candidates[i] || seen.has(i)) continue
    seen.add(i)
    chosen.push({ ...candidates[i], why: String(p.why || '') })
  }
  if (!chosen.length) throw Object.assign(new Error(`the model picked nothing usable: ${JSON.stringify(out).slice(0, 200)}`), { code: 'no-picks' })
  return chosen.slice(0, count)
}

/**
 * Las tres versiones de una noticia. Si no pasan `checkPost`, se le devuelven los fallos
 * al modelo UNA vez; si tampoco, se lanza y esa noticia no entra.
 */
export async function writePosts ({ apiKey, item, body, ask = askJson, log = () => {} }) {
  const messages = [
    { role: 'system', content: WRITE_PROMPT },
    {
      role: 'user',
      content: [
        `Medio: ${item.outlet}`,
        `Fecha: ${iso(item.publishedAt).slice(0, 10)}`,
        `Título: ${item.title}`,
        'Texto del medio:',
        '<<<',
        body,
        '>>>'
      ].join('\n')
    }
  ]
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await ask({ apiKey, messages, temperature: 0.4 })
    const texts = Object.fromEntries(PLATFORM_KEYS.map((p) => [p, String(out?.[p] ?? '').trim()]))
    const problems = PLATFORM_KEYS.flatMap((p) => checkPost(p, texts[p]).map((x) => `${p}: ${x}`))
    if (!problems.length) return texts
    log(`[refresh] draft ${attempt} rejected: ${problems.join('; ')}`)
    messages.push(
      { role: 'assistant', content: JSON.stringify(out) },
      { role: 'user', content: `No pasa las comprobaciones:\n${problems.map((p) => `- ${p}`).join('\n')}\nCorrígelo y responde otra vez SOLO con el JSON.` }
    )
  }
  throw Object.assign(new Error('the drafts failed the checks twice'), { code: 'bad-posts' })
}

/**
 * Deja listas `POOL_TARGET` noticias frescas sin publicar. Si ya las hay, no hace nada
 * (ni red ni bóveda): por eso se puede correr antes de cada post.
 *
 * @param {{ getApiKey: () => Promise<string>, dry?: boolean, force?: boolean, now?: number,
 *   log?: (m:string)=>void, fetch?: typeof fetch, ask?: typeof askJson }} opts
 */
export async function refreshNews ({ getApiKey, dry = false, force = false, now = Date.now(), log = console.log, fetch: f = fetch, ask = askJson }) {
  const pool = readPool()
  const state = readState()
  const ready = readyCount(pool, state, { now })
  const need = force ? POOL_TARGET : POOL_TARGET - ready
  if (need <= 0) {
    log(`[refresh] ${ready} fresh unpublished news ready; nothing to do`)
    return { added: [], ready }
  }

  const feeds = readFeeds()
  const { items, failed } = await fetchFeeds(feeds, { since: now - CANDIDATE_MAX_AGE_MS, now, fetch: f })
  for (const m of failed) log(`[refresh] feed failed: ${m}`)
  if (failed.length === feeds.length) throw Object.assign(new Error('every feed failed'), { code: 'feeds-down' })
  const known = new Set([...pool.items.map((it) => normalizeUrl(it.source)), ...publishedSources(state).keys()])
  const candidates = items.filter((it) => !known.has(normalizeUrl(it.url))).slice(0, MAX_CANDIDATES)
  log(`[refresh] need ${need}: ${items.length} recent entries from ${feeds.length - failed.length}/${feeds.length} feeds, ${candidates.length} not used before`)
  if (!candidates.length) throw Object.assign(new Error('the feeds have no recent news that was not already used'), { code: 'no-candidates' })

  const apiKey = await getApiKey()
  const picks = await selectNews({ apiKey, candidates, recentTitles: pool.items.slice(-20).map((it) => it.title), count: need + 2, ask })
  const added = []
  const rejected = []
  for (const c of picks) {
    if (added.length >= need) break
    try {
      let article = null
      try {
        article = articleFrom((await download(c.url, ARTICLE_MAX_BYTES, { fetch: f, accept: 'text/html,application/xhtml+xml' })).toString('utf8'))
      } catch (e) {
        // Muchos medios no dejan leer el artículo a un bot; el resumen del feed es texto
        // del propio medio, y MIN_SOURCE_CHARS decide si da para escribir.
        log(`[refresh] ${c.url}: article not readable (${e.message}); writing from the feed summary`)
      }
      const publishedAt = article?.publishedAt ?? c.publishedAt
      if (now - publishedAt > CANDIDATE_MAX_AGE_MS) throw new Error(`the article itself is dated ${iso(publishedAt)}`)
      const body = [c.summary, article?.description, article?.text].filter(Boolean).join('\n\n')
      if (body.length < MIN_SOURCE_CHARS) throw new Error(`only ${body.length} chars of source text`)
      const texts = await writePosts({ apiKey, item: { ...c, publishedAt }, body, ask, log })
      added.push({ source: c.url, title: c.title, outlet: c.outlet, publishedAt: iso(publishedAt), addedAt: iso(now), why: c.why, texts })
      log(`[refresh] + ${c.outlet} ${iso(publishedAt).slice(0, 10)}: ${c.title}`)
    } catch (e) {
      rejected.push(`${c.url}: ${e.message}`)
      log(`[refresh] skip ${c.url}: ${e.message}`)
    }
  }
  if (!added.length) {
    throw Object.assign(new Error(`refresh produced no usable news (${rejected.length} rejected; last: ${rejected.at(-1)})`), { code: 'no-news' })
  }
  if (dry) {
    log(`[refresh] DRY: ${added.length} news written, not saved`)
    return { added, ready: ready + added.length, dry: true }
  }
  pool.items = [...pool.items.filter((it) => now - Date.parse(it.addedAt) <= POOL_KEEP_MS), ...added]
  writeJson(poolPath(), pool)
  log(`[refresh] saved ${added.length}${added.length < need ? ` of ${need} wanted` : ''}; ${ready + added.length} fresh unpublished news ready`)
  return { added, ready: ready + added.length }
}
