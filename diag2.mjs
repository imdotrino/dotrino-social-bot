import { loadLink, clientLink } from '@dotrino/remote-agent/link'
const dir = process.argv[2]
const raw = loadLink(dir)
console.log('proxy', raw.proxy, 'nonce', raw.cert?.nonce, 'exp', new Date(raw.cert?.exp).toISOString())
const link = clientLink(raw, { dir })
const t0 = Date.now()
try { const d = await link.id.listVaultDevices(); console.log('OK', d.devices?.length, 'devices in', Date.now()-t0, 'ms') }
catch (e) { console.log('FAIL', e.message, Date.now()-t0, 'ms') }
process.exit(0)
