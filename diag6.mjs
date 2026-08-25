import { loadLink } from '@dotrino/remote-agent/link'
import { requestDevices } from './node_modules/@dotrino/identity/vault/remote.js'
const raw = loadLink(process.argv[2])
const r = await requestDevices({ master: raw.iss, proxy: raw.proxy, device: raw.device, cert: raw.cert, sinceSeq: 0 })
const L = (o) => JSON.stringify(o ?? null).length
console.log('TOTAL           ', L(r))
console.log('  devices (9)   ', L(r.devices))
console.log('  revoked       ', L(r.revoked))
console.log('  acta (actual) ', L(r.acta), ' seq', r.acta?.seq, ' miembros', r.acta?.members?.length)
console.log('  chain         ', L(r.chain), ` (${r.chain?.length} actas)`)
const sizes = (r.chain || []).map((a) => ({ seq: a.seq, bytes: L(a), members: a.members?.length }))
console.log('  chain: min/med/max bytes ', Math.min(...sizes.map(s=>s.bytes)), '/', sizes[Math.floor(sizes.length/2)]?.bytes, '/', Math.max(...sizes.map(s=>s.bytes)))
console.log('  primeras/últimas:')
for (const s of [...sizes.slice(0,3), ...sizes.slice(-3)]) console.log(`    seq ${s.seq} · ${s.bytes} bytes · ${s.members} miembros`)
process.exit(0)
