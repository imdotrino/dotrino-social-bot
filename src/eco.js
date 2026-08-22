// Publicar un eco como lo hace la app, pero desde Node: se firma con la llave del
// aparato, se pone el beacon en geo (24 h, uno por identidad) y se deja la copia
// PÚBLICA en el node de Dotrino por el plano de control (`ContentClient`), igual que
// la app —el bot es un aparato del acta y abre sesión con el node como cualquiera—.
//
// La copia pública se PINEA: el eco sale del feed a las 24 h, como todos, pero el
// enlace que quedó en una red sigue abriendo mientras el node lo sirva. Lo efímero es
// el beacon; la duración del enlace la decide el content (dueño, 2026-08-22).

import { randomUUID } from 'node:crypto'
import { createGeoClient } from '@dotrino/geo'
import { ContentClient, buildUrl } from '@dotrino/content-client'
import { canonical, extractLinks, extractTags, fitEco } from './text.js'

export const TTL_24H = 24 * 60 * 60 * 1000
/** Quito. El eco es «global» para cualquiera; el punto solo dice desde dónde habla Dotrino. */
export const POS = { lat: -0.1807, lng: -78.4678 }
export const AUTHOR_NAME = 'Dotrino'
export const ECO_APP = 'https://eco.dotrino.com/'

/** Arma y firma un eco. `text` se recorta a lo que cabe; `source` va en `links`. */
export async function buildEco ({ text, source, identity, now = Date.now() }) {
  const body = fitEco(text)
  const links = [...new Set([...(source ? [source] : []), ...extractLinks(body)])].slice(0, 4)
  const eco = {
    id: randomUUID(),
    author: identity.publickey,
    authorName: AUTHOR_NAME,
    text: body,
    links,
    tags: extractTags(body),
    lat: POS.lat, lng: POS.lng,
    createdAt: now,
    expiresAt: now + TTL_24H,
    repostOf: null, replyTo: null, quoted: null,
    media: null
  }
  eco.sig = await identity.signData(canonical(eco))
  return eco
}

/** El beacon en geo: el mismo `publishPin` que usa la app. */
export async function publishPin (eco, identity, { geoUrl, fetch: f } = {}) {
  const geo = createGeoClient({
    signData: (d) => identity.signData(d),
    getPublicKeyJwk: async () => identity.publickey,
    ...(geoUrl ? { baseUrl: geoUrl } : {}),
    ...(f ? { fetch: f } : {})
  })
  return geo.publishPin({ lat: POS.lat, lng: POS.lng, payload: eco, tags: eco.tags, ttlMs: TTL_24H })
}

/**
 * La copia pública del eco (ya firmado) en el node de su dueño, por el plano de
 * control, y pineada. Lo mismo que `publishPublicCopy` + `pinPublic` de la app.
 * @param {{ cc?: any }} [opts]  un `ContentClient` ya conectado (para reusar sesión o para probar)
 * @returns {Promise<{ cid:string, owner:string, url:string }>}
 */
export async function publishPublicCopy (eco, identity, { cc = null, pin = true } = {}) {
  const client = cc || await ContentClient.connect({ link: identity.link })
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(eco))
    const ref = await client.put(bytes, {
      encrypt: false,
      acl: 'public',
      mime: 'application/json',
      ttlMs: TTL_24H,
      meta: { title: `@${eco.authorName}`, description: String(eco.text || '').slice(0, 200) }
    })
    if (pin) await client.pin(ref.cid)
    return { cid: ref.cid, owner: ref.owner, url: buildUrl({ owner: ref.owner, cid: ref.cid }, ECO_APP) }
  } finally {
    if (!cc) { try { await client.close?.() } catch (_) {} }
  }
}

/**
 * Todo junto: eco firmado → copia pública pineada → beacon (con la referencia) → enlace.
 * La copia va ANTES del beacon para que el beacon lleve `pub = { owner, cid }` (fuera de
 * lo firmado: el cid es el hash del eco ya firmado, no puede ir dentro) y quien lo vea en
 * el feed pueda compartir el enlace de ese eco, como en la app.
 */
export async function publishEco ({ text, source, identity, log = () => {} }) {
  const eco = await buildEco({ text, source, identity })
  log(`eco ${eco.id}: ${eco.text.length} chars, ${eco.tags.length} tags`)
  const ref = await publishPublicCopy(eco, identity)
  log(`eco: public copy ${ref.cid.slice(0, 20)}… → ${ref.url}`)
  eco.pub = { owner: ref.owner, cid: ref.cid }
  await publishPin(eco, identity)
  log('eco: beacon published (geo)')
  return { eco, ...ref }
}
