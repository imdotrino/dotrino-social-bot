import { loadLink } from '@dotrino/remote-agent/link'
import { requestDevices } from './node_modules/@dotrino/identity/vault/remote.js'
const dir = process.argv[2]
const raw = loadLink(dir)
for (const since of [undefined, 0]) {
  const t0 = Date.now()
  try {
    const r = await requestDevices({ master: raw.iss, proxy: raw.proxy, device: raw.device, cert: raw.cert, sinceSeq: since })
    const s = JSON.stringify(r)
    console.log(`sinceSeq=${since} → OK ${s.length} bytes (devices ${r.devices?.length}, chain ${r.chain?.length ?? 'none'}) in ${Date.now()-t0}ms`)
  } catch (e) { console.log(`sinceSeq=${since} → FAIL ${e.message} in ${Date.now()-t0}ms`) }
}
process.exit(0)
