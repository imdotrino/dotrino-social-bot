// Una corrida = un post en una red: toma la noticia fresca que le toca (`news.js`),
// PUBLICA EN ECO PRIMERO y después comparte en la red el enlace de ese eco. Si eco falla,
// no se publica nada en la red (el enlace es el post); si la red falla, el eco ya salió y
// se dice — el estado solo avanza cuando las dos cosas pasaron.
//
// La imagen sale de la propia noticia (`image.js`) y es la misma en los tres sitios:
// dentro del eco, en la tarjeta del permalink y adjunta al post de la red. Sin imagen de
// la noticia, Buffer cae al og.jpg del ecosistema.

import { loadBotIdentity, loadSecrets } from './identity.js'
import { publishEco } from './eco.js'
import { imageForSource } from './image.js'
import { bodyFor } from './text.js'
import { createPost } from './buffer.js'
import { postDiscord } from './discord.js'
import { pickNews, readPool, readState, writeState, POST_MAX_AGE_MS } from './news.js'

export const PLATFORMS = ['twitter', 'linkedin', 'discord']
/** Lo que se recuerda por red: es lo que impide publicar dos veces la misma fuente. */
const HISTORY_MAX = 300

/**
 * @param {{ platform:string, dry?:boolean, log?:(m:string)=>void }} opts
 */
export async function runOnce ({ platform, dry = false, log = console.log }) {
  if (!PLATFORMS.includes(platform)) throw new Error(`platform must be one of ${PLATFORMS.join('|')}`)
  const all = readState()
  const item = pickNews(readPool(), all, platform)
  if (!item) {
    throw Object.assign(new Error(
      `[${platform}] no fresh news to post (published in the last ${POST_MAX_AGE_MS / 86400000} days and not posted here yet); nothing was published. Run: dotrino-social-bot refresh`
    ), { code: 'no-fresh-news' })
  }
  const text = item.texts[platform]
  const source = item.source
  log(`[${platform}] ${item.outlet} ${item.publishedAt.slice(0, 10)} · ${item.title}${dry ? ' [DRY]' : ''}`)

  if (dry) {
    log(`[${platform}] text: ${bodyFor(platform, { text, source, ecoUrl: 'https://dotrino.com/p/<cid>' })}`)
    const img = await imageForSource(source, { log: (m) => log(`[${platform}] ${m}`) })
    return { dry: true, item, image: img ? { from: img.from, bytes: img.bytes.length } : null }
  }

  const identity = await loadBotIdentity()
  const secrets = await loadSecrets(identity, platform === 'discord' ? ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'] : ['BUFFER_API_KEY'], { log })

  // 1) la imagen de la noticia (nunca lanza: sin ella el post sale igual)
  const image = await imageForSource(source, { log })

  // 2) eco
  const { eco, url, permalink, image: asset } = await publishEco({ text, source, image, identity, log })

  // 3) la red, con el enlace del eco: el permalink (tarjeta OG pública) que abre en eco
  const body = bodyFor(platform, { text, source, ecoUrl: permalink })
  if (platform === 'discord') {
    await postDiscord({ token: secrets.DISCORD_BOT_TOKEN, guild: secrets.DISCORD_GUILD_ID, text: body })
  } else {
    const post = await createPost({
      token: secrets.BUFFER_API_KEY, channel: platform, text: body,
      mode: process.env.BUFFER_MODE || 'shareNow',
      // `undefined` deja el og.jpg del ecosistema; `null` lo dejaría SIN imagen.
      image: asset || undefined
    })
    log(`[${platform}] buffer ${post.id} ${post.status}${asset ? ' (news image)' : ''}`)
  }

  const history = all[platform]?.history || []
  history.push({ ts: new Date().toISOString(), source, title: item.title, eco: url, permalink, image: asset?.url || null, text: body.slice(0, 90) })
  all[platform] = { history: history.slice(-HISTORY_MAX) }
  writeState(all)
  log(`[${platform}] OK eco=${eco.id}`)
  return { item, eco, url }
}
