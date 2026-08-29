// Publicar un eco como lo hace la app, pero desde Node: se firma con la llave del
// aparato, se pone el beacon en geo (24 h, uno por identidad) y se deja la copia
// PÚBLICA en el node de Dotrino por el plano de control (`ContentClient`), igual que
// la app —el bot es un aparato del acta y abre sesión con el node como cualquiera—.
//
// Si la noticia trae imagen (la `og:image` del propio artículo, ver `image.js`), va
// como `media` DENTRO del eco —o sea, dentro de lo firmado— y como miniatura de la
// copia pública, que es lo que hace que la tarjeta del permalink muestre la noticia
// y no el og.jpg del ecosistema. La misma imagen se adjunta al post de la red.
//
// La copia pública se PINEA: el eco sale del feed a las 24 h, como todos, pero el
// enlace que quedó en una red sigue abriendo mientras el node lo sirva. Lo efímero es
// el beacon; la duración del enlace la decide el content (dueño, 2026-08-22).

import { randomUUID } from 'node:crypto'
import { createGeoClient } from '@dotrino/geo'
import { ContentClient, buildUrl } from '@dotrino/content-client'
import { canonical, extractLinks, extractTags, fitEco } from './text.js'
import { IMAGE_MAX_BYTES } from './image.js'

export const TTL_24H = 24 * 60 * 60 * 1000
/** Quito. El eco es «global» para cualquiera; el punto solo dice desde dónde habla Dotrino. */
export const POS = { lat: -0.1807, lng: -78.4678 }
export const AUTHOR_NAME = 'Dotrino'
export const ECO_APP = 'https://eco.dotrino.com/'
/**
 * El PERMALINK de cada eco: la página con la tarjeta OG que sirve el node de Dotrino en
 * modo público (`/p/<cid>`, detrás de dotrino.com). Es lo que va en las redes —un
 * `#fragment` no da tarjeta: los rastreadores no lo ven— y su botón «Abrir» lleva a eco.
 */
export const PERMALINK_BASE = (process.env.SOCIAL_PERMALINK_BASE || 'https://dotrino.com').replace(/\/+$/, '')
export const permalinkOf = (cid) => `${PERMALINK_BASE}/p/${cid}`
/**
 * La URL pública de un blob (la imagen). Es lo que adjunta Buffer al post y lo que
 * pinta la tarjeta: una sola imagen, en el node de su dueño, para las dos cosas.
 */
export const publicUrlOf = (cid) => `${PERMALINK_BASE}/c/${cid}`

/**
 * Arma y firma un eco. `text` se recorta a lo que cabe; `source` va en `links`;
 * `media` (la imagen ya subida) va DENTRO de lo firmado, porque la imagen es parte
 * de lo que el autor dijo.
 */
export async function buildEco ({ text, source, media = null, identity, now = Date.now() }) {
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
    media: media || null
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
 * La imagen de la noticia, subida al node como blob PÚBLICO y en claro, y pineada:
 * si caducara a las 24 h la tarjeta del permalink se quedaría en blanco mientras el
 * enlace sigue vivo en la red donde se publicó.
 * @param {any} cc  cliente del node ya conectado
 * @param {{ bytes: Uint8Array, mime: string, width?: number, height?: number }} image
 * @returns {Promise<{ owner:string, cid:string, mime:string, size:number, width?:number, height?:number }>}
 */
export async function attachImage (cc, image) {
  if (image.bytes.length > IMAGE_MAX_BYTES) {
    throw Object.assign(new Error(`image is ${image.bytes.length} bytes (max ${IMAGE_MAX_BYTES})`), { code: 'too-large' })
  }
  const ref = await cc.put(image.bytes, { encrypt: false, acl: 'public', mime: image.mime, ttlMs: TTL_24H })
  await cc.pin(ref.cid)
  const out = { owner: ref.owner, cid: ref.cid, mime: image.mime, size: image.bytes.length }
  if (image.width) out.width = image.width
  if (image.height) out.height = image.height
  return out
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
      // El texto ENTERO (un eco son 280 caracteres como mucho): recortarlo a 200
      // dejaba la tarjeta cortada a mitad de frase. Y los `links` del eco viajan
      // con él, que es donde está la fuente de la que habla: sin eso el permalink
      // contaba la noticia y escondía de dónde salió.
      meta: { title: `@${eco.authorName}`, description: String(eco.text || ''), links: eco.links || [] }
    })
    if (pin) await client.pin(ref.cid)
    return { cid: ref.cid, owner: ref.owner, url: buildUrl({ owner: ref.owner, cid: ref.cid }, ECO_APP), permalink: permalinkOf(ref.cid) }
  } finally {
    if (!cc) { try { await client.close?.() } catch (_) {} }
  }
}

/**
 * Todo junto: imagen → eco firmado → copia pública pineada → miniatura → beacon (con la
 * referencia) → enlace. La copia va ANTES del beacon para que el beacon lleve
 * `pub = { owner, cid }` (fuera de lo firmado: el cid es el hash del eco ya firmado, no
 * puede ir dentro) y quien lo vea en el feed pueda compartir el enlace de ese eco, como
 * en la app.
 *
 * La imagen va PRIMERO porque su `cid` entra en lo que se firma. Si falla, el eco sale
 * igual sin ella: una imagen no vale un post.
 *
 * @param {{ text:string, source?:string|null, image?:object|null, identity:object, log?:Function }} opts
 * @returns {Promise<{ eco:object, cid:string, owner:string, url:string, permalink:string,
 *   image:{ url:string, altText:string }|null }>}
 */
export async function publishEco ({ text, source, image = null, identity, log = () => {} }) {
  const cc = await ContentClient.connect({ link: identity.link })
  try {
    let media = null
    if (image) {
      try {
        media = await attachImage(cc, image)
        log(`eco: image ${media.cid.slice(0, 20)}… → ${publicUrlOf(media.cid)}`)
      } catch (err) {
        log(`eco: image not attached (${err.code || 'error'}): ${err.message}`)
      }
    }
    const eco = await buildEco({ text, source, media, identity })
    log(`eco ${eco.id}: ${eco.text.length} chars, ${eco.tags.length} tags${media ? ', with image' : ''}`)
    const ref = await publishPublicCopy(eco, identity, { cc })
    log(`eco: public copy ${ref.cid.slice(0, 20)}… → ${ref.url} · card ${ref.permalink}`)
    // La copia es JSON, así que la tarjeta no puede sacar la imagen del propio blob:
    // se la enlaza como miniatura, que es lo que mira el permalink (`pickImage`).
    if (media) await cc.setThumbnail(ref.cid, media.cid).catch((e) => log(`eco: thumbnail not set: ${e.message}`))
    eco.pub = { owner: ref.owner, cid: ref.cid }
    await publishPin(eco, identity)
    log('eco: beacon published (geo)')
    return {
      eco,
      ...ref,
      image: media ? { url: publicUrlOf(media.cid), altText: (image.alt || eco.text).slice(0, 400) } : null
    }
  } finally {
    try { await cc.close?.() } catch (_) {}
  }
}
