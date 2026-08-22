// Publicar un eco como lo hace la app, pero desde Node: se firma con la llave del
// aparato, se pone el beacon en geo (24 h, uno por identidad) y se deja la copia
// PÚBLICA en el node de Dotrino —por su API local, porque el bot corre en la
// misma máquina que el node y un cert de servicio no abre sesión de control—.
//
// La copia pública se PINEA: el eco sale del feed a las 24 h, como todos, pero el
// enlace que quedó en una red sigue abriendo mientras el node lo sirva. Lo
// efímero es el beacon; la duración del enlace la decide el content (dueño, 2026-08-22).

import { randomUUID } from 'node:crypto'
import { createGeoClient } from '@dotrino/geo'
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
 * La copia pública en el node (API local, sin auth: solo escucha en loopback).
 * @returns {Promise<{ cid:string, url:string }>}
 */
export async function publishPublicCopy (eco, identity, { nodeUrl = process.env.CONTENT_URL || 'http://127.0.0.1:3777', pin = true, fetch: f = fetch } = {}) {
  const base = nodeUrl.replace(/\/+$/, '')
  const bytes = new TextEncoder().encode(JSON.stringify(eco))
  const up = await f(`${base}/c?ttl=${TTL_24H}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes })
  if (!up.ok) throw new Error(`node put failed: ${up.status} ${await up.text().catch(() => '')}`)
  const { cid } = await up.json()
  if (!cid) throw new Error('node put answered without cid')
  const pub = await f(`${base}/public/${cid}`, { method: 'POST' })
  if (!pub.ok) throw new Error(`node public failed: ${pub.status}`)
  if (pin) {
    const pr = await f(`${base}/pin/${cid}`, { method: 'POST' })
    if (!pr.ok) throw new Error(`node pin failed: ${pr.status}`)
  }
  return { cid, url: `${ECO_APP.replace(/\/+$/, '')}/#${identity.owner}/${cid}` }
}

/** Todo junto: eco firmado → beacon → copia pública pineada → enlace. */
export async function publishEco ({ text, source, identity, log = () => {} }) {
  const eco = await buildEco({ text, source, identity })
  log(`eco ${eco.id}: ${eco.text.length} chars, ${eco.tags.length} tags`)
  await publishPin(eco, identity)
  log('eco: beacon published (geo)')
  const ref = await publishPublicCopy(eco, identity)
  log(`eco: public copy ${ref.cid.slice(0, 20)}… → ${ref.url}`)
  return { eco, ...ref }
}
