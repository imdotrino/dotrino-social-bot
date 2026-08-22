import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitEco, extractTags, extractLinks, bodyFor, pickTopic, canonical, ECO_MAX } from '../src/text.js'

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

test('pickTopic balancea por peso y evita repetir el último', () => {
  const pc = { a: ['1'], b: ['2'], _doc: 'x' }
  const st = { counts: { a: 1, b: 1 }, idx: {}, lastTopic: 'a' }
  assert.equal(pickTopic(pc, st), 'b')
  assert.equal(pickTopic(pc, { counts: {}, idx: {}, lastTopic: null }, { weights: { b: 3 } }), 'b')
  assert.equal(pickTopic(pc, { counts: {}, idx: {} }, { only: 'zzz' }), null)
})

test('canonical no incluye sig ni posición', () => {
  const c = JSON.parse(canonical({ id: 'i', author: 'a', text: 't', sig: 's', lat: 1, links: [], tags: [] }))
  assert.equal(c.sig, undefined); assert.equal(c.lat, undefined); assert.equal(c.text, 't')
})
