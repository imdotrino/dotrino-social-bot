import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFeed, normalizeUrl, plainText, fetchFeeds } from '../src/feeds.js'

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title><atom:link href="https://x.test/rss" rel="self"/>
<item><title><![CDATA[La ONU y la IA: "riesgo"]]></title><link><![CDATA[https://www.eldiario.es/a_1.html]]></link>
<description><![CDATA[<p><img src="a.jpg"></p><p>Resumen con <b>negrita</b> y &quot;comillas&quot;</p>]]></description>
<pubDate>Mon, 14 Sep 2026 10:16:39 GMT</pubDate></item>
<item><title>Escapado &lt;b&gt;sí&lt;/b&gt;</title><link>https://www.theregister.com/b?utm_source=rss</link>
<description>&lt;p&gt;Hola&amp;nbsp;mundo&lt;/p&gt;</description><pubDate>Sun, 13 Sep 2026 21:36:00 GMT</pubDate></item>
<item><title>Sin fecha</title><link>https://x.test/c</link></item>
</channel></rss>`

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>S</title><link href="https://www.schneier.com/"/>
<entry><title type="html">Passkeys &amp; más</title>
<link rel="replies" href="https://s.test/r"/><link rel="alternate" type="text/html" href="https://www.schneier.com/blog/x.html"/>
<published>2026-09-12T11:03:51Z</published><updated>2026-09-14T11:03:51Z</updated>
<summary type="html">&lt;p&gt;Texto&lt;/p&gt;</summary></entry></feed>`

test('parseFeed lee RSS con CDATA y escapado, y descarta lo que no tiene fecha', () => {
  const items = parseFeed(RSS, 'https://x.test/rss')
  assert.equal(items.length, 2)
  assert.deepEqual(items[0], {
    title: 'La ONU y la IA: "riesgo"',
    url: 'https://www.eldiario.es/a_1.html',
    publishedAt: Date.parse('2026-09-14T10:16:39Z'),
    summary: 'Resumen con negrita y "comillas"'
  })
  assert.equal(items[1].title, 'Escapado sí')
  assert.equal(items[1].summary, 'Hola mundo')
})

test('parseFeed lee Atom: el enlace alternate y la fecha de publicación, no la de edición', () => {
  const [it] = parseFeed(ATOM, 'https://www.schneier.com/feed/atom/')
  assert.equal(it.title, 'Passkeys & más')
  assert.equal(it.url, 'https://www.schneier.com/blog/x.html')
  assert.equal(it.publishedAt, Date.parse('2026-09-12T11:03:51Z'))
  assert.equal(it.summary, 'Texto')
})

test('normalizeUrl iguala la misma noticia con otro utm, www o barra final', () => {
  assert.equal(normalizeUrl('https://www.theregister.com/b/?utm_source=rss#x'), normalizeUrl('https://theregister.com/b'))
  assert.notEqual(normalizeUrl('https://x.test/a?id=1'), normalizeUrl('https://x.test/a?id=2'))
})

test('plainText quita scripts y etiquetas', () => {
  assert.equal(plainText('<p>a<script>alert(1)</script> <i>b</i> &#8217;c&#x2019;</p>'), 'a b ’c’')
})

test('fetchFeeds: filtra por fecha, quita duplicados e informa el feed caído sin parar a los demás', async () => {
  const f = async (url) => {
    if (url === 'https://down.test/rss') return new Response('nope', { status: 500 })
    if (url === 'https://empty.test/rss') return new Response('<html>not a feed</html>')
    return new Response(RSS)
  }
  const { items, failed } = await fetchFeeds([
    { name: 'Uno', url: 'https://x.test/rss' },
    { name: 'Dos', url: 'https://y.test/rss' },
    { name: 'Caído', url: 'https://down.test/rss' },
    { name: 'Roto', url: 'https://empty.test/rss' }
  ], { since: Date.parse('2026-09-14T00:00:00Z'), now: Date.parse('2026-09-14T12:00:00Z'), fetch: f })
  assert.deepEqual(items.map((it) => [it.outlet, it.url]), [['Uno', 'https://www.eldiario.es/a_1.html']])
  assert.equal(failed.length, 2)
  assert.match(failed[0], /^Caído: .*HTTP 500/)
  assert.match(failed[1], /^Roto: no entries parsed/)
})
