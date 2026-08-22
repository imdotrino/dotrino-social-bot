// Una corrida = un post en una red: elige el tópico, PUBLICA EN ECO PRIMERO y
// después comparte en la red el enlace de ese eco. Si eco falla, no se publica
// nada en la red (el enlace es el post); si la red falla, el eco ya salió y se
// dice — el estado solo avanza cuando las dos cosas pasaron.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { waitForSecrets } from '@dotrino/vault/service'
import { loadBotIdentity, NS } from './identity.js'
import { publishEco } from './eco.js'
import { bodyFor, pickTopic } from './text.js'
import { createPost } from './buffer.js'
import { postDiscord } from './discord.js'

export const PLATFORMS = ['twitter', 'linkedin', 'discord']
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function contentPath () { return process.env.SOCIAL_CONTENT || join(ROOT, 'content', 'social-content.json') }
export function statePath () {
  return process.env.SOCIAL_STATE || join(process.env.XDG_DATA_HOME || join(os.homedir(), '.local', 'share'), 'dotrino', 'social-bot', 'state.json')
}

export function readState () {
  try { return JSON.parse(readFileSync(statePath(), 'utf8')) } catch (_) { return {} }
}
export function writeState (all) {
  mkdirSync(dirname(statePath()), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(all, null, 2))
}

/**
 * @param {{ platform:string, dry?:boolean, only?:string|null, log?:(m:string)=>void }} opts
 */
export async function runOnce ({ platform, dry = false, only = null, log = console.log }) {
  if (!PLATFORMS.includes(platform)) throw new Error(`platform must be one of ${PLATFORMS.join('|')}`)
  const content = JSON.parse(readFileSync(contentPath(), 'utf8'))
  const pc = content[platform]
  if (!pc) throw new Error(`no content for ${platform}`)
  const all = readState()
  const state = (all[platform] ||= { counts: {}, idx: {}, lastTopic: null, history: [] })
  state.counts ||= {}; state.idx ||= {}; state.history ||= []

  const topic = pickTopic(pc, state, { weights: { ...(content._weights || {}), ...(pc._weights || {}) }, only })
  if (!topic) throw new Error(`nothing to publish for ${platform}`)
  const arr = pc[topic]
  const item = arr[state.idx[topic] % arr.length]
  const text = typeof item === 'string' ? item : item.text
  const source = (typeof item === 'object' && item.source) || null
  log(`[${platform}] topic=${topic} count=${state.counts[topic]} idx=${state.idx[topic] % arr.length}/${arr.length}${dry ? ' [DRY]' : ''}`)

  if (dry) {
    log(`[${platform}] text: ${bodyFor(platform, { text, source, ecoUrl: 'https://dotrino.com/p/<cid>' })}`)
    return { dry: true, topic, text, source }
  }

  // Secretos del cajón `eco` del vault, con la identidad del enlace (espera a la
  // bóveda; sin ella no se opera).
  const identity = await loadBotIdentity()
  const required = platform === 'discord' ? ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'] : ['BUFFER_API_KEY']
  const secrets = await waitForSecrets({ ...identity.secretsArgs, onRetry: (e, ms) => log(`[vault] ${e.message}; retry in ${Math.round(ms / 1000)}s`) })
  const missing = required.filter((k) => !(k in secrets))
  if (missing.length) throw new Error(`missing secrets in ns "${NS}": ${missing.join(', ')} (dotrino-vault secret set ${NS} KEY=value)`)

  // 1) eco
  const { eco, url, permalink } = await publishEco({ text, source, identity, log })

  // 2) la red, con el enlace del eco: el permalink (tarjeta OG pública) que abre en eco
  const body = bodyFor(platform, { text, source, ecoUrl: permalink })
  if (platform === 'discord') {
    await postDiscord({ token: secrets.DISCORD_BOT_TOKEN, guild: secrets.DISCORD_GUILD_ID, text: body })
  } else {
    const post = await createPost({ token: secrets.BUFFER_API_KEY, channel: platform, text: body, mode: process.env.BUFFER_MODE || 'shareNow' })
    log(`[${platform}] buffer ${post.id} ${post.status}`)
  }

  state.counts[topic]++
  state.idx[topic]++
  state.lastTopic = topic
  state.history.push({ ts: new Date().toISOString(), topic, eco: url, permalink, text: body.slice(0, 90) })
  if (state.history.length > 300) state.history = state.history.slice(-300)
  all[platform] = state
  writeState(all)
  log(`[${platform}] OK eco=${eco.id} counts=${JSON.stringify(state.counts)}`)
  return { topic, eco, url }
}
