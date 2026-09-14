import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pickNews, readyCount, articleFrom, selectNews, writePosts, refreshNews,
  SELECT_PROMPT, POOL_TARGET
} from '../src/news.js'

const NOW = Date.parse('2026-09-14T17:00:00Z')
const H = 60 * 60 * 1000
const at = (hoursAgo) => new Date(NOW - hoursAgo * H).toISOString()
const TEXTS = {
  twitter: 'Según The Record, un regulador europeo multó a una empresa por guardar grabaciones de voz sin permiso de las personas. #privacidad',
  linkedin: 'Según The Record, un regulador europeo multó a una empresa por guardar grabaciones de voz de sus clientes sin su permiso. '.repeat(3) + '#privacidad',
  discord: 'Esto lo cuenta The Record: un regulador europeo multó a una empresa por guardar grabaciones de voz sin permiso. Si usas asistentes de voz, fíjate en qué guardan.'
}
const news = (source, hoursAgo) => ({ source, title: source, outlet: 'O', publishedAt: at(hoursAgo), addedAt: at(hoursAgo), texts: TEXTS })

test('pickNews: la que no salió en ninguna red, luego la que no salió en esta, y nunca una vieja', () => {
  const pool = { items: [news('https://a.test/1', 2), news('https://b.test/2', 5), news('https://c.test/3', 120), news('https://d.test/4', 30)] }
  const tw = { twitter: { history: [{ source: 'https://www.a.test/1/?utm_source=x' }] } }
  assert.equal(pickNews(pool, tw, 'twitter', { now: NOW }).source, 'https://b.test/2')
  assert.equal(pickNews(pool, tw, 'linkedin', { now: NOW }).source, 'https://b.test/2')
  const all = { twitter: { history: ['https://a.test/1', 'https://b.test/2', 'https://d.test/4'].map((source) => ({ source })) } }
  assert.equal(pickNews(pool, all, 'linkedin', { now: NOW }).source, 'https://a.test/1')
  assert.equal(pickNews(pool, all, 'twitter', { now: NOW }), null, 'la de hace 5 días no sale nunca')
  assert.equal(readyCount(pool, tw, { now: NOW }), 2)
})

test('pickNews aplica las reglas de hoy a lo ya redactado: lo que pregunta no sale', () => {
  const asks = { ...news('https://q.test/1', 1), texts: { ...TEXTS, discord: TEXTS.discord + ' ¿Qué opinas?' } }
  const pool = { items: [asks, news('https://b.test/2', 5)] }
  assert.equal(pickNews(pool, {}, 'discord', { now: NOW }).source, 'https://b.test/2')
  assert.equal(pickNews(pool, {}, 'twitter', { now: NOW }).source, 'https://q.test/1')
  assert.equal(readyCount(pool, {}, { now: NOW }), 1)
})

test('articleFrom toma la fecha del artículo y sus párrafos con texto', () => {
  const html = `<html><head><meta content="2026-06-03T09:00:00Z" property="article:published_time">
<meta property="og:description" content="La &amp; descripción"></head><body>
<p>corto</p><p>Un párrafo con suficiente texto como para contar algo de la noticia de verdad.</p>
<script>var x = "<p>no</p>"</script></body></html>`
  const a = articleFrom(html)
  assert.equal(a.publishedAt, Date.parse('2026-06-03T09:00:00Z'))
  assert.equal(a.description, 'La & descripción')
  assert.equal(a.text, 'Un párrafo con suficiente texto como para contar algo de la noticia de verdad.')
})

test('selectNews solo acepta índices que existan, sin repetir', async () => {
  const candidates = [0, 1, 2].map((i) => ({ title: `t${i}`, url: `https://x.test/${i}`, outlet: 'O', publishedAt: NOW, summary: 's' }))
  const ask = async () => ({ picks: [{ i: 2, why: 'w' }, { i: 7 }, { i: 2 }, { i: 'x' }, { i: 0 }] })
  const out = await selectNews({ apiKey: 'k', candidates, count: 5, ask })
  assert.deepEqual(out.map((c) => c.url), ['https://x.test/2', 'https://x.test/0'])
  await assert.rejects(selectNews({ apiKey: 'k', candidates, count: 2, ask: async () => ({ picks: [] }) }), { code: 'no-picks' })
})

test('writePosts le devuelve los fallos al modelo una vez, y a la segunda lanza', async () => {
  const seen = []
  const ask = async ({ messages }) => {
    seen.push(messages.length)
    return seen.length === 1 ? { ...TEXTS, discord: TEXTS.discord.replace('fíjate', 'fijate') } : TEXTS
  }
  const item = { outlet: 'O', title: 't', publishedAt: NOW }
  assert.deepEqual(await writePosts({ apiKey: 'k', item, body: 'b', ask }), TEXTS)
  assert.deepEqual(seen, [2, 4], 'la segunda vuelta lleva la respuesta y los fallos')
  await assert.rejects(writePosts({ apiKey: 'k', item, body: 'b', ask: async () => ({ twitter: 'x' }) }), { code: 'bad-posts' })
})

test('refreshNews: redacta lo fresco, salta el artículo viejo, guarda y a la segunda no hace nada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-bot-'))
  process.env.SOCIAL_STATE = join(dir, 'state.json')
  process.env.SOCIAL_POOL = join(dir, 'news.json')
  process.env.SOCIAL_FEEDS = join(dir, 'feeds.json')
  writeFileSync(process.env.SOCIAL_FEEDS, JSON.stringify({ feeds: [{ name: 'The Record', url: 'https://feed.test/rss' }] }))
  const summary = 'Resumen del medio con texto suficiente. '.repeat(12)
  const entry = (n, hoursAgo) => `<item><title>Noticia ${n}</title><link>https://news.test/${n}</link><description>${summary}</description><pubDate>${new Date(NOW - hoursAgo * H).toUTCString()}</pubDate></item>`
  const rss = `<rss><channel>${entry(1, 1)}${entry(2, 3)}${entry(3, 5)}${entry(4, 7)}${entry(5, 72)}</channel></rss>`
  const fetch = async (url) => {
    if (url === 'https://feed.test/rss') return new Response(rss)
    // la 2 dice en su propia página que es de junio: el feed la re-listó
    if (url === 'https://news.test/2') return new Response('<meta property="article:published_time" content="2026-06-01T00:00:00Z">')
    if (url === 'https://news.test/3') return new Response('forbidden', { status: 403 })
    return new Response('<p>Texto del artículo con detalle suficiente para contar la noticia sin inventar nada.</p>')
  }
  const calls = []
  const ask = async ({ messages }) => {
    calls.push(messages[0].content === SELECT_PROMPT ? 'select' : 'write')
    return messages[0].content === SELECT_PROMPT ? { picks: [0, 1, 2, 3].map((i) => ({ i, why: 'w' })) } : TEXTS
  }
  let keys = 0
  const getApiKey = async () => { keys++; return 'k' }
  const logs = []
  const log = (m) => logs.push(m)

  const r = await refreshNews({ getApiKey, now: NOW, fetch, ask, log })
  assert.deepEqual(r.added.map((it) => it.source), ['https://news.test/1', 'https://news.test/3', 'https://news.test/4'])
  assert.equal(r.added.length, POOL_TARGET)
  assert.ok(logs.some((m) => /skip https:\/\/news\.test\/2: the article itself is dated 2026-06-01/.test(m)), logs.join('\n'))
  assert.ok(logs.some((m) => /news\.test\/3: article not readable/.test(m)))
  assert.equal(JSON.parse(readFileSync(process.env.SOCIAL_POOL, 'utf8')).items.length, 3)

  const again = await refreshNews({ getApiKey, now: NOW, fetch, ask, log })
  assert.deepEqual(again, { added: [], ready: 3 })
  assert.equal(keys, 1, 'si ya hay noticias no se pide la clave')
  assert.equal(calls.filter((c) => c === 'select').length, 1)
})

test('refreshNews con un pool roto lanza en vez de empezar de cero', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-bot-'))
  process.env.SOCIAL_POOL = join(dir, 'news.json')
  process.env.SOCIAL_STATE = join(dir, 'state.json')
  writeFileSync(process.env.SOCIAL_POOL, '{"items": [')
  await assert.rejects(refreshNews({ getApiKey: async () => 'k', now: NOW, log: () => {} }), { code: 'bad-json' })
})
