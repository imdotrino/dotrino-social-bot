// La identidad del bot: un aparato del acta de Dotrino, enrolado por el camino
// estándar de los agentes headless (`@dotrino/remote-agent/link`). Lo que puede hacer
// lo dice la invitación con la que se emparejó —`dotrino-vault pair --service eco
// --scope sign`—: firma como aparato del acta (`vault:sign`: publica en las apps y
// abre sesión con el node de contenido por el plano de control) y lee SOLO su cajón
// de secretos (`vault:secrets:eco`). Ni el perfil ni otros cajones: si el bot se
// equivoca, se equivoca solo.
//
// De aquí salen las tres cosas que el resto necesita: `signData` (la llave del
// aparato, como cualquier aparato de la app), `owner` (la huella de la maestra que lo
// certificó: el `ownerId` del enlace compartible, que rutea al node de Dotrino) y
// `link` (lo que espera `ContentClient.connect`).

import { loadLink, clientLink, dataDir } from '@dotrino/remote-agent/link'
import { pubkeyId } from '@dotrino/identity/capabilities'

export const NS = 'eco'
export const LABEL = 'social-bot'

export function identityDir () { return process.env.SOCIAL_BOT_DIR || dataDir('dotrino-social-bot') }

/**
 * @returns {Promise<{ publickey:string, owner:string, iss:string, raw:object, link:object,
 *   signData:(d:object)=>Promise<string>, secretsArgs:object }>}
 */
export async function loadBotIdentity () {
  const dir = identityDir()
  const raw = loadLink(dir)
  if (!raw?.device?.privateJwk) {
    throw Object.assign(new Error(`not enrolled: run \`dotrino-social-bot enroll <invite>\` (dir ${dir})`), { code: 'not-enrolled' })
  }
  if (raw.cert?.exp && raw.cert.exp <= Date.now()) {
    throw Object.assign(new Error('device cert expired: enroll again'), { code: 'expired' })
  }
  if (!raw.enc?.privateJwk) {
    throw Object.assign(new Error('this link has no encryption key (enrolled with an old remote-agent): enroll again'), { code: 'no-enc' })
  }
  const link = clientLink(raw, { dir })
  return {
    publickey: raw.device.publickey,
    iss: raw.iss,
    owner: await pubkeyId(raw.iss),
    raw,
    link,
    async signData (data) { return (await link.id.signData(data)).signature },
    /** Lo que piden `fetchSecrets`/`waitForSecrets` cuando la identidad no vive en `service-identity.json`. */
    secretsArgs: { ns: NS, proxyUrl: link.proxy, masterPubkey: raw.iss, device: raw.device, cert: raw.cert, enc: raw.enc }
  }
}
