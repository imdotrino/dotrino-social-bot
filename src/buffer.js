// Buffer (X y LinkedIn), por su API GraphQL con el token personal. Lo mismo que
// hacía `buffer-post.js`, como módulo y con el token que le llega del vault.

const ENDPOINT = 'https://api.buffer.com/graphql'
export const ORG_ID = '6a342aa3e92a2f5188845575' // My Organization (imdotrino@gmail.com)
export const CHANNELS = {
  twitter: '6a342bf938b5579345ad3317',  // imdotrino (X)
  linkedin: '6a5505d480cc80cdcaabcfd4'  // Dotrino (Página de empresa)
}
const DEFAULT_IMAGE = { url: 'https://dotrino.com/og.jpg', altText: 'Dotrino: tu información, en tu servidor, bajo tus reglas' }

async function gql (token, query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const json = await res.json()
  if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors))
  return json.data
}

export async function listChannels (token) {
  const q = 'query($input: ChannelsInput!){ channels(input:$input){ id name service type displayName isDisconnected } }'
  return (await gql(token, q, { input: { organizationId: ORG_ID } })).channels
}

/**
 * Encola/publica un post. Devuelve el payload de Buffer; lanza si no fue éxito.
 * @param {{ token:string, channel:'twitter'|'linkedin', text:string, mode?:string, image?:{url:string,altText:string}|null }} p
 */
export async function createPost ({ token, channel, text, mode = 'shareNow', image = DEFAULT_IMAGE }) {
  const channelId = CHANNELS[channel]
  if (!channelId) throw new Error(`unknown channel: ${channel}`)
  const q = `mutation($input: CreatePostInput!){
    createPost(input:$input){
      __typename
      ... on PostActionSuccess { post { id status channelService dueAt } }
      ... on InvalidInputError { message }
      ... on UnauthorizedError { message }
      ... on LimitReachedError { message }
      ... on NotFoundError { message }
      ... on UnexpectedError { message }
      ... on RestProxyError { message }
    }
  }`
  const assets = image ? [{ image: { url: image.url, metadata: { altText: image.altText } } }] : []
  const r = (await gql(token, q, { input: { channelId, text, schedulingType: 'automatic', mode, assets } })).createPost
  if (r.__typename !== 'PostActionSuccess') throw new Error(`buffer ${channel}: ${r.__typename} ${r.message || ''}`)
  return r.post
}
