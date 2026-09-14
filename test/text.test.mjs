import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitEco, extractTags, extractLinks, bodyFor, checkPost, canonical, ECO_MAX } from '../src/text.js'

test('fitEco deja pasar lo que cabe y recorta por frase lo que no', () => {
  assert.equal(fitEco('Hola mundo. #a'), 'Hola mundo. #a')
  const long = 'Primera frase que es larga y dice cosas. ' + 'Segunda frase igual de larga y con detalle. '.repeat(6) + '#privacidad #datos'
  const out = fitEco(long)
  assert.ok(out.length <= ECO_MAX, out.length)
  assert.ok(out.startsWith('Primera frase que es larga y dice cosas.'))
  assert.ok(out.endsWith('#privacidad #datos'), out)
})

test('fitEco sin frase entera corta por palabra con elipsis', () => {
  const out = fitEco('palabra '.repeat(80).trim())
  assert.ok(out.length <= ECO_MAX)
  assert.ok(out.endsWith('…'))
})

test('tags y links como en la app', () => {
  assert.deepEqual(extractTags('Algo #Privacidad y #datos (#x)'), ['privacidad', 'datos', 'x'])
  assert.deepEqual(extractLinks('ver https://themarkup.org/a/b. y index.html'), ['https://themarkup.org/a/b'])
})

test('el cuerpo de X solo lleva el eco; LinkedIn/Discord citan fuente y eco', () => {
  const p = { text: 'T', source: 'https://s', ecoUrl: 'https://eco.dotrino.com/#o/c' }
  assert.equal(bodyFor('twitter', p), 'T https://eco.dotrino.com/#o/c')
  assert.equal(bodyFor('linkedin', p), 'T\n\nFuente: https://s\nEn eco: https://eco.dotrino.com/#o/c')
})

test('checkPost deja pasar un post correcto', () => {
  const ok = 'Según The Record, el Gobierno británico abre las llaves de acceso a 23 millones de personas: entrar sin contraseña, con la huella o el PIN del teléfono. #privacidad'
  assert.deepEqual(checkPost('twitter', ok), [])
})

test('checkPost caza largo, emojis, enlaces, Dotrino y voseo', () => {
  assert.match(checkPost('twitter', 'corto').join(), /too short/)
  assert.match(checkPost('twitter', 'a'.repeat(257)).join(), /too long/)
  const base = 'Según EFF, el Parlamento Europeo frenó el escaneo masivo de mensajes privados y el cifrado queda en pie. '
  assert.match(checkPost('twitter', base + '🔒').join(), /emoji/)
  assert.match(checkPost('twitter', base + 'https://eff.org').join(), /link/)
  assert.match(checkPost('twitter', base + 'En Dotrino lo cuidamos.').join(), /Dotrino/)
  assert.match(checkPost('twitter', base + 'Mirá el detalle si podés.').join(), /voseo: mirá, podés/)
  assert.match(checkPost('twitter', base + '¿Qué opinas').join(), /question/)
  assert.match(checkPost('twitter', base + 'Y ahora qué?').join(), /question/)
  // «además», «después» o «país» no son voseo
  assert.deepEqual(checkPost('twitter', base + 'Además, después del voto, el país sigue.'), [])
  assert.deepEqual(checkPost('mastodon', base), ['unknown platform mastodon'])
})

test('canonical no incluye sig ni posición', () => {
  const c = JSON.parse(canonical({ id: 'i', author: 'a', text: 't', sig: 's', lat: 1, links: [], tags: [] }))
  assert.equal(c.sig, undefined); assert.equal(c.lat, undefined); assert.equal(c.text, 't')
})
