// Uso local apenas: posta uma mensagem estruturada (embed) num canal ou DM do
// Discord via bot, a partir de um arquivo JSON no formato nativo da API do
// Discord: { content?, embeds?: [...] } — ou um array desses objetos, pra
// mandar várias mensagens em sequência.
//
// DISCORD_BOT_TOKEN deve estar no seu ambiente (não commitar, não colar no chat).
//
// Rode primeiro sem --send pra conferir o payload:
//   node scripts/send-discord-message.mjs <channel_id> <arquivo.json>
// Quando estiver ok, envia de verdade:
//   node scripts/send-discord-message.mjs <channel_id> <arquivo.json> --send
//
// Pra mandar como DM em vez de canal, use --dm (o primeiro argumento vira o
// user id do destinatário em vez de channel id -- o bot precisa compartilhar
// um servidor com essa pessoa pra poder abrir DM):
//   node scripts/send-discord-message.mjs <user_id> <arquivo.json> --dm --send

import { readFile } from 'node:fs/promises'
import { resolveColors, resolveDmChannelId, sendMessage } from './discord-messages/_lib.mjs'

const SEND_DELAY_MS = 700

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const args = process.argv.slice(2)
const shouldSend = args.includes('--send')
const isDm = args.includes('--dm')
const [targetId, filePath] = args.filter((a) => !a.startsWith('--'))

if (!targetId || !filePath) {
  console.error('Uso: node scripts/send-discord-message.mjs <channel_id|user_id> <arquivo.json> [--send] [--dm]')
  process.exit(1)
}

if (shouldSend && !BOT_TOKEN) {
  console.error('Defina DISCORD_BOT_TOKEN no ambiente antes de rodar com --send.')
  process.exit(1)
}

const raw = JSON.parse(await readFile(filePath, 'utf-8'))
const messages = (Array.isArray(raw) ? raw : [raw]).map(resolveColors)

let channelId = targetId
if (shouldSend && isDm) {
  channelId = await resolveDmChannelId(BOT_TOKEN, targetId)
  console.log(`DM channel resolvido: ${channelId}`)
}

console.log(`${messages.length} mensagem(ns) — ${shouldSend ? 'enviando pro ' + (isDm ? 'DM de ' + targetId : 'canal ' + targetId) : 'modo preview, nada será enviado'}\n`)

for (const [i, payload] of messages.entries()) {
  console.log(`--- mensagem ${i + 1}/${messages.length} ---`)
  console.log(JSON.stringify(payload, null, 2))
  console.log()

  if (shouldSend) {
    await sendMessage(BOT_TOKEN, channelId, payload)
    console.log(`✓ mensagem ${i + 1} enviada`)
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, SEND_DELAY_MS))
  }
}

if (shouldSend) console.log('\nPronto — todas as mensagens enviadas.')
