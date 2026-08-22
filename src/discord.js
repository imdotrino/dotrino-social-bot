// Discord: #general del servidor, por el bot (token y guild del vault).
export async function postDiscord ({ token, guild, text }) {
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
  const chans = await fetch(`https://discord.com/api/v10/guilds/${guild}/channels`, { headers }).then((r) => r.json())
  const general = Array.isArray(chans) && chans.find((c) => c.type === 0 && c.name === 'general')
  if (!general) throw new Error('discord: #general not found')
  const res = await fetch(`https://discord.com/api/v10/channels/${general.id}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ content: text })
  })
  if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}
