// Funções compartilhadas por scripts/send-discord-message.mjs.

const DISCORD_API = 'https://discord.com/api/v10'

// Embeds só aceitam cor como inteiro decimal -- deixa o JSON usar "#22C55E"
// que fica bem mais legível de escrever/revisar do que 2278750.
export function resolveColors(payload) {
  for (const embed of payload.embeds ?? []) {
    if (typeof embed.color === 'string') {
      embed.color = parseInt(embed.color.replace('#', ''), 16)
    }
  }
  return payload
}

export async function resolveDmChannelId(botToken, userId) {
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bot ${botToken}`,
    },
    body: JSON.stringify({ recipient_id: userId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(`Falha ao abrir DM (status ${res.status}): ${JSON.stringify(data)}`)
  }
  const data = await res.json()
  return data.id
}

export async function sendMessage(botToken, channelId, payload) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bot ${botToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(`Falha ao enviar (status ${res.status}): ${JSON.stringify(data)}`)
  }
}
