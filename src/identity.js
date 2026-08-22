// La identidad del bot: un aparato del acta de Dotrino enrolado como SERVICIO con
// `cn: eco` (`dotrino-vault pair --service eco`). Su cert solo lleva
// `vault:secrets:eco`: firma como él mismo, lee su cajón, y nada más — ni el perfil
// ni otros cajones. Eso es a propósito: si el bot se equivoca, se equivoca solo.
//
// De aquí salen las dos cosas que el resto necesita: `signData` (la llave del
// aparato, como cualquier aparato de la app) y `owner` (la huella de la maestra que
// lo certificó: el `ownerId` del enlace compartible, que rutea al node de Dotrino).

import { readServiceIdentity } from '@dotrino/vault/service'
import { serviceDir } from '@dotrino/vault/env'
import { signWithDevice, pubkeyId } from '@dotrino/identity/capabilities'

export const NS = 'eco'

export function identityDir () { return serviceDir(NS) }

/** @returns {Promise<{ publickey:string, owner:string, iss:string, signData:(d:object)=>Promise<string> }>} */
export async function loadBotIdentity () {
  const id = readServiceIdentity(identityDir())
  if (!id?.device?.privateJwk) {
    throw Object.assign(new Error(`not enrolled: run \`dotrino-social-bot enroll <invite>\` (dir ${identityDir()})`), { code: 'not-enrolled' })
  }
  if (id.cert?.exp && id.cert.exp <= Date.now()) {
    throw Object.assign(new Error('device cert expired: enroll again'), { code: 'expired' })
  }
  const owner = await pubkeyId(id.iss)
  return {
    publickey: id.device.publickey,
    iss: id.iss,
    owner,
    async signData (data) {
      const { signature } = await signWithDevice({ privateJwk: id.device.privateJwk, publickey: id.device.publickey, data })
      return signature
    }
  }
}
