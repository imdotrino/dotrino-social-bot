import { loadLink, clientLink } from '@dotrino/remote-agent/link'
const WS = globalThis.WebSocket
class SpyWS extends WS {
  send (d) {
    const n = typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength
    let head = typeof d === 'string' ? d.slice(0, 120) : '<bin>'
    console.log('[send]', n, 'bytes ::', head.replace(/\s+/g,' '))
    return super.send(d)
  }
}
globalThis.WebSocket = SpyWS
const dir = process.argv[2]
const raw = loadLink(dir)
const link = clientLink(raw, { dir })
try { const r = await link.id.listVaultDevices(); console.log('OK') } catch (e) { console.log('FAIL', e.message) }
process.exit(0)
