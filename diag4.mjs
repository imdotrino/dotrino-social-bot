import { loadLink, clientLink } from '@dotrino/remote-agent/link'
import { WebSocketProxyClient } from '@dotrino/proxy-client'
const dir = process.argv[2]
const raw = loadLink(dir)
const c = new WebSocketProxyClient({ url: raw.proxy, enableWebRTC: false, autoReconnect: false })
await c.connect()
console.log('MY TOKEN:', c.token || c.myToken || c.id)
const link = clientLink(raw, { dir })
try { await link.id.listVaultDevices() } catch (e) { console.log('FAIL', e.message) }
try { c.close() } catch {}
process.exit(0)
