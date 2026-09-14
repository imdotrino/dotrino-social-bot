#!/usr/bin/env node
// dotrino-social-bot — CLI.
//
//   dotrino-social-bot enroll <invite>        enlaza este bot al vault (pair --service eco)
//   dotrino-social-bot refresh [--dry] [--force]
//                                             deja listas noticias frescas, elegidas y redactadas por IA
//   dotrino-social-bot post <twitter|linkedin|discord> [--dry]
//   dotrino-social-bot news                   las noticias redactadas y en qué redes salieron
//   dotrino-social-bot channels               lista los canales de Buffer (con el token del vault)
//   dotrino-social-bot whoami                 identidad del bot (aparato, dueño, cert)
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dry: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
})
const [cmd, arg] = positionals

const usage = () => {
  console.log(`usage:
  dotrino-social-bot enroll <invite>
  dotrino-social-bot refresh [--dry] [--force]
  dotrino-social-bot post <twitter|linkedin|discord> [--dry]
  dotrino-social-bot news
  dotrino-social-bot channels
  dotrino-social-bot whoami`)
}

/** Cómo se describe un papel ahora: por el acta a la que se ató, no por un reloj. */
function describeCert (cert) {
  if (typeof cert?.seq === 'number') return `acta #${cert.seq}`
  if (typeof cert?.exp === 'number') return `modelo viejo · vence ${new Date(cert.exp).toISOString().slice(0, 10)}`
  return 'sin papel'
}

try {
  if (!cmd || values.help) { usage(); process.exit(cmd ? 0 : 2) }
  if (cmd === 'enroll') {
    if (!arg) throw new Error('missing invite (from `dotrino-vault pair --service eco --scope sign`)')
    const { enroll, loadLink } = await import('@dotrino/remote-agent/link')
    const { identityDir, NS, LABEL } = await import('../src/identity.js')
    const prev = loadLink(identityDir())
    if (prev) console.log(`replacing previous identity (enrolled ${new Date(prev.at).toISOString()})`)
    const link = await enroll({
      qr: arg, ns: NS, label: LABEL, dir: identityDir(),
      onChallenge: ({ deviceId, code }) => console.log(`\nDevice ${deviceId}. In the vault run:  dotrino-vault approve ${code}\n`)
    })
    // El papel no vence: se ata al ACTA. Esto imprimía `new Date(cert.exp)`, que con un
    // papel del modelo nuevo es `new Date(undefined)` y LANZA `RangeError` — o sea que
    // enrolar terminaba bien y el comando se caía en la última línea.
    console.log(`enrolled: scope ${JSON.stringify(link.cert.scope)} · ${describeCert(link.cert)} · dir ${identityDir()}`)
  } else if (cmd === 'refresh') {
    const { refreshNews } = await import('../src/news.js')
    const getApiKey = values.dry
      // En seco no se toca la bóveda, igual que `post --dry`: la clave va por el entorno.
      ? async () => {
        if (!process.env.DEEPSEEK_API_KEY) throw new Error('refresh --dry reads DEEPSEEK_API_KEY from the environment')
        return process.env.DEEPSEEK_API_KEY
      }
      : async () => {
        const { loadBotIdentity, loadSecrets } = await import('../src/identity.js')
        return (await loadSecrets(await loadBotIdentity(), ['DEEPSEEK_API_KEY'])).DEEPSEEK_API_KEY
      }
    const { added } = await refreshNews({ getApiKey, dry: values.dry, force: values.force })
    if (values.dry) {
      for (const it of added) {
        console.log(`\n${it.outlet} · ${it.publishedAt.slice(0, 10)} · ${it.source}\n  why: ${it.why}`)
        for (const [p, t] of Object.entries(it.texts)) console.log(`  ${p} (${t.length}): ${t}`)
      }
    }
  } else if (cmd === 'post') {
    const { runOnce } = await import('../src/poster.js')
    await runOnce({ platform: String(arg || ''), dry: values.dry })
  } else if (cmd === 'news') {
    const { readPool, readState, publishedSources, POST_MAX_AGE_MS } = await import('../src/news.js')
    const { normalizeUrl } = await import('../src/feeds.js')
    const published = publishedSources(readState())
    const now = Date.now()
    for (const it of readPool().items) {
      const fresh = now - Date.parse(it.publishedAt) <= POST_MAX_AGE_MS
      const where = [...(published.get(normalizeUrl(it.source)) || [])].join(',') || '-'
      console.log(`${it.publishedAt.slice(0, 10)} ${fresh ? 'fresh' : 'stale'} [${where}] ${it.outlet}: ${it.title}`)
    }
  } else if (cmd === 'channels') {
    const { fetchSecrets } = await import('@dotrino/vault/service')
    const { listChannels } = await import('../src/buffer.js')
    const { loadBotIdentity } = await import('../src/identity.js')
    const secrets = await fetchSecrets((await loadBotIdentity()).secretsArgs)
    if (!secrets.BUFFER_API_KEY) throw new Error('missing BUFFER_API_KEY in ns eco')
    for (const c of await listChannels(secrets.BUFFER_API_KEY)) console.log(`${c.service.padEnd(9)} ${c.id}  ${c.displayName}${c.isDisconnected ? ' (DISCONNECTED)' : ''}`)
  } else if (cmd === 'whoami') {
    const { loadBotIdentity, identityDir } = await import('../src/identity.js')
    const id = await loadBotIdentity()
    console.log(JSON.stringify({
      dir: identityDir(), owner: id.owner, scope: id.raw.cert.scope,
      // `seq` con el modelo nuevo; `exp` solo si todavía lleva uno viejo, que es justo lo
      // que quien mira necesita saber (le falta migrar y ese sí caduca).
      seq: id.raw.cert.seq ?? null,
      ...(typeof id.raw.cert.exp === 'number' ? { exp: new Date(id.raw.cert.exp).toISOString(), legacy: true } : {}),
      publickey: id.publickey
    }, null, 2))
  } else { usage(); process.exit(2) }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
