// Dónde vive lo que el bot recuerda entre corridas. El estado no va en el repo: es de la
// máquina que publica.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = () => join(process.env.XDG_DATA_HOME || join(os.homedir(), '.local', 'share'), 'dotrino', 'social-bot')

/** Los medios de donde salen las noticias. */
export const feedsPath = () => process.env.SOCIAL_FEEDS || join(ROOT, 'content', 'feeds.json')
/** Lo publicado, por red. */
export const statePath = () => process.env.SOCIAL_STATE || join(dataDir(), 'state.json')
/** Las noticias ya redactadas, esperando su turno. */
export const poolPath = () => process.env.SOCIAL_POOL || join(dataDir(), 'news.json')

/**
 * Lee un JSON. SOLO la ausencia del archivo da `empty` (la primera corrida). Un archivo
 * roto lanza: tomarlo por vacío borraría el historial y el bot volvería a publicar lo
 * que ya publicó.
 */
export function readJson (path, empty) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return empty
    throw e
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw Object.assign(new Error(`${path}: invalid JSON (${e.message})`), { code: 'bad-json' })
  }
}

/** Escribe por renombrado: un corte a mitad no deja un JSON a medias. */
export function writeJson (path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}
