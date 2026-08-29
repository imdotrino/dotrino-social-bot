import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { metaTags, pickImage, normalize, imageForSource, IMAGE_MAX_BYTES } from '../src/image.js'

const page = (head) => `<!doctype html><html><head>${head}</head><body>x</body></html>`

test('las etiquetas se leen en cualquier orden de atributos y con comillas simples', () => {
  const m = metaTags(page(`
    <meta content="https://medio.test/a.png" property="og:image">
    <meta name='twitter:image' content='https://medio.test/b.png'>
    <meta property="og:title" content="Titular">
  `))
  assert.equal(m['og:image'], 'https://medio.test/a.png')
  assert.equal(m['twitter:image'], 'https://medio.test/b.png')
  assert.equal(m['og:title'], 'Titular')
})

test('la imagen del artículo: og manda sobre twitter, y las relativas se resuelven', () => {
  const one = pickImage(page('<meta property="og:image" content="/img/a.png"><meta name="twitter:image" content="https://otro.test/b.png">'), 'https://medio.test/nota/')
  assert.deepEqual(one, { url: 'https://medio.test/img/a.png', alt: null })

  const only = pickImage(page('<meta name="twitter:image" content="https://medio.test/b.png"><meta name="twitter:image:alt" content="Un gráfico">'), 'https://medio.test/nota/')
  assert.deepEqual(only, { url: 'https://medio.test/b.png', alt: 'Un gráfico' })

  assert.equal(pickImage(page('<meta property="og:title" content="sin imagen">'), 'https://medio.test/'), null)
  // Un `javascript:` en una etiqueta del medio no se convierte en una descarga.
  assert.equal(pickImage(page('<meta property="og:image" content="javascript:alert(1)">'), 'https://medio.test/'), null)
})

test('normalizar es lo que hace que la imagen de un medio quepa por el plano de control', async () => {
  // Ruido de verdad a 2000 px: un PNG así no se comprime y pasa de sobra el tope,
  // igual que la og:image de un medio (la que disparó esto pesaba 508 KB).
  const noise = randomBytes(2000 * 1200 * 3)
  const big = await sharp(noise, { raw: { width: 2000, height: 1200, channels: 3 } }).png().toBuffer()
  assert.ok(big.length > IMAGE_MAX_BYTES, 'el original tiene que pasarse del tope para que la prueba pruebe algo')

  const out = await normalize(big)
  assert.equal(out.mime, 'image/jpeg')
  assert.equal(out.width, 1200, 'se limita el ancho: una tarjeta no necesita más')
  assert.ok(out.bytes.length <= IMAGE_MAX_BYTES, `${out.bytes.length} bytes no caben en ${IMAGE_MAX_BYTES}`)
})

test('una noticia sin imagen NO tumba el post: devuelve null y lo dice', async () => {
  const logs = []
  const fetch404 = async () => new Response('no', { status: 404 })
  assert.equal(await imageForSource('https://medio.test/nota', { fetch: fetch404, log: (m) => logs.push(m) }), null)
  assert.match(logs.join('\n'), /no image from/)

  const noMeta = async () => new Response(page('<title>x</title>'), { status: 200, headers: { 'content-type': 'text/html' } })
  assert.equal(await imageForSource('https://medio.test/nota', { fetch: noMeta, log: () => {} }), null)
  // Y sin fuente no hay nada que pedir.
  assert.equal(await imageForSource(null, {}), null)
})
