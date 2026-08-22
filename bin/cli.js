#!/usr/bin/env node
// dotrino-social-bot — CLI.
//
//   dotrino-social-bot enroll <invite>        enlaza este bot al vault (pair --service eco)
//   dotrino-social-bot post <twitter|linkedin|discord> [--dry] [--only <topic>]
//   dotrino-social-bot channels               lista los canales de Buffer (con el token del vault)
//   dotrino-social-bot whoami                 identidad del bot (aparato, dueño, cert)
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { dry: { type: 'boolean', default: false }, only: { type: 'string' }, help: { type: 'boolean', short: 'h' } }
})
const [cmd, arg] = positionals

const usage = () => {
  console.log(`usage:
  dotrino-social-bot enroll <invite>
  dotrino-social-bot post <twitter|linkedin|discord> [--dry] [--only <topic>]
  dotrino-social-bot channels
  dotrino-social-bot whoami`)
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
    console.log(`enrolled: scope ${JSON.stringify(link.cert.scope)} · exp ${new Date(link.cert.exp).toISOString()} · dir ${identityDir()}`)
  } else if (cmd === 'post') {
    const { runOnce } = await import('../src/poster.js')
    await runOnce({ platform: String(arg || ''), dry: values.dry, only: values.only || null })
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
    console.log(JSON.stringify({ dir: identityDir(), owner: id.owner, scope: id.raw.cert.scope, exp: new Date(id.raw.cert.exp).toISOString(), publickey: id.publickey }, null, 2))
  } else { usage(); process.exit(2) }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
