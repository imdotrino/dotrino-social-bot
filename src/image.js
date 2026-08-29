// La imagen de la noticia: la del PROPIO artículo (`og:image`), traída, normalizada
// y republicada como blob público en el node de Dotrino.
//
// Por qué no basta con enlazar la del medio: el permalink necesita una imagen que
// sirva NUESTRO node (la tarjeta la pinta `/c/<cid>`), y Buffer necesita una URL
// pública estable para adjuntarla al post. Las dos salen del mismo blob, así que la
// imagen vive en un solo sitio y es la misma en la red y en el eco.
//
// Y por qué se re-codifica en vez de subir el original: el plano de control lleva
// 256 KB por blob y una `og:image` de un medio pasa medio mega sin despeinarse (la
// del artículo que disparó esto: 508 KB). Sin normalizar, casi ningún post tendría
// imagen.

import sharp from 'sharp'

/** Lo que se lee del artículo buscando sus etiquetas: la cabeza, no el sitio entero. */
export const HTML_MAX_BYTES = 512 * 1024
/** Lo que se acepta descargar del original antes de re-codificarlo. */
export const SOURCE_MAX_BYTES = 8 * 1024 * 1024
/** El tope del blob ya normalizado: el plano de control lleva 256 KB, con margen para el base64. */
export const IMAGE_MAX_BYTES = 200 * 1024
export const IMAGE_MAX_WIDTH = 1200
/** Calidades que se prueban, de mejor a peor, hasta que la imagen entra en el tope. */
const QUALITIES = [82, 70, 58, 45]

const ATTR = (tag, name) => new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v != null) || null

/**
 * Las etiquetas `<meta>` de una página, como pares nombre→contenido. Se mira tanto
 * `property` (Open Graph) como `name` (Twitter), y en cualquier orden de atributos:
 * el orden lo decide el CMS del medio, no nosotros.
 * @param {string} html
 * @returns {Record<string,string>}
 */
export function metaTags (html) {
  const out = {}
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    const key = ATTR(tag, 'property') || ATTR(tag, 'name')
    const val = ATTR(tag, 'content')
    if (key && val && !(key.toLowerCase() in out)) out[key.toLowerCase()] = val
  }
  return out
}

/**
 * La imagen que el propio artículo declara para sus tarjetas, en URL absoluta.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{ url: string, alt: string|null }|null}
 */
export function pickImage (html, pageUrl) {
  const m = metaTags(html)
  const raw = m['og:image:secure_url'] || m['og:image'] || m['twitter:image'] || m['twitter:image:src']
  if (!raw) return null
  let url
  try { url = new URL(raw, pageUrl).href } catch { return null }
  if (!/^https?:\/\//i.test(url)) return null
  return { url, alt: m['og:image:alt'] || m['twitter:image:alt'] || null }
}

/** Descarga con tope: un cuerpo enorme no se traga entero solo para descartarlo. */
async function download (url, maxBytes, { fetch: f = fetch, accept, timeoutMs = 20000 } = {}) {
  const res = await f(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    // Sin User-Agent, varios medios contestan 403 y la noticia se quedaría sin imagen.
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; DotrinoSocialBot/1.0; +https://dotrino.com/)', ...(accept ? { accept } : {}) }
  })
  if (!res.ok) throw Object.assign(new Error(`${url} → HTTP ${res.status}`), { code: 'http' })
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw Object.assign(new Error(`${url} → ${declared} bytes (max ${maxBytes})`), { code: 'too-large' })
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw Object.assign(new Error(`${url} → ${buf.length} bytes (max ${maxBytes})`), { code: 'too-large' })
  return buf
}

/**
 * Re-codifica a JPEG hasta que entra en el tope. Baja la calidad, no el ancho, salvo
 * que sea más ancha de la cuenta: una tarjeta social no necesita más de 1200 px.
 * @param {Buffer} bytes
 * @returns {Promise<{ bytes: Buffer, mime: string, width: number, height: number }>}
 */
export async function normalize (bytes, { maxBytes = IMAGE_MAX_BYTES, maxWidth = IMAGE_MAX_WIDTH } = {}) {
  const base = sharp(bytes, { failOn: 'error' }).rotate().flatten({ background: '#0e1116' })
  const meta = await sharp(bytes).metadata()
  const resized = meta.width && meta.width > maxWidth ? base.resize({ width: maxWidth }) : base
  let last = null
  for (const quality of QUALITIES) {
    const out = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    last = out
    if (out.data.length <= maxBytes) break
  }
  if (last.data.length > maxBytes) {
    throw Object.assign(new Error(`no cabe en ${maxBytes} bytes ni al mínimo de calidad (${last.data.length})`), { code: 'too-large' })
  }
  return { bytes: last.data, mime: 'image/jpeg', width: last.info.width, height: last.info.height }
}

/**
 * La imagen de una noticia, lista para subir: se lee el artículo, se toma la que él
 * mismo declara y se normaliza.
 *
 * NUNCA lanza: una noticia sin imagen se publica igual (con la del ecosistema). Que
 * el medio no tenga `og:image`, conteste 403 o sirva un WebP roto no es motivo para
 * quedarse sin post.
 * @param {string|null} source
 * @returns {Promise<{ bytes: Buffer, mime: string, width: number, height: number, alt: string|null, from: string }|null>}
 */
export async function imageForSource (source, { fetch: f = fetch, log = () => {} } = {}) {
  if (!source) return null
  try {
    const html = await download(source, HTML_MAX_BYTES, { fetch: f, accept: 'text/html,application/xhtml+xml' })
    const found = pickImage(html.toString('utf8'), source)
    if (!found) { log(`image: ${source} declares no og:image`); return null }
    const raw = await download(found.url, SOURCE_MAX_BYTES, { fetch: f, accept: 'image/*' })
    const img = await normalize(raw)
    log(`image: ${found.url} → ${img.width}×${img.height}, ${Math.round(img.bytes.length / 1024)} KB`)
    return { ...img, alt: found.alt, from: found.url }
  } catch (err) {
    log(`image: no image from ${source}: ${err.message}`)
    return null
  }
}

export default { imageForSource, pickImage, metaTags, normalize, IMAGE_MAX_BYTES }
