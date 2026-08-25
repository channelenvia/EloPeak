import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'

const DISCORD_API = 'https://discord.com/api/v10'
const BOT_TOKEN     = Deno.env.get('DISCORD_BOT_TOKEN')  ?? ''
const WEBHOOK_SECRET = Deno.env.get('DISCORD_WEBHOOK_SECRET') ?? ''

const CHANNELS = {
  sobre_nos:    Deno.env.get('DISCORD_CHANNEL_SOBRE_NOS')    ?? '',
  regras:       Deno.env.get('DISCORD_CHANNEL_REGRAS')       ?? '',
  anuncios:     Deno.env.get('DISCORD_CHANNEL_ANUNCIOS')     ?? '',
  como_comprar: Deno.env.get('DISCORD_CHANNEL_COMO_COMPRAR') ?? '',
  reviews:      Deno.env.get('DISCORD_CHANNEL_REVIEWS')      ?? '',
}

async function send(channelId: string, payload: object) {
  const res = await fetchWithTimeout(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error(`Discord init message failed ${res.status}:`, await res.text())
    throw new Error(`Discord ${res.status}`)
  }
}

// ─── Mensagens de cada canal ──────────────────────────────────────────────────

async function initSobreNos(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: 'Sobre a EloPeak',
      description: 'Plataforma de serviços para **League of Legends**: conectamos jogadores a boosters aprovados, de forma prática, transparente e segura.',
      color: 0x22C55E,
      fields: [
        {
          name: 'Serviços',
          value: '**Elo Boost** • **Duo Boost** • **MD5** (colocação) • **Pacotes de Vitórias** • **Coach**',
          inline: false,
        },
        {
          name: 'Segurança',
          value: 'Credenciais criptografadas, acesso restrito ao pedido, acompanhamento em tempo real e suporte 24h.',
          inline: false,
        },
      ],
      footer: { text: 'EloPeak — Profissional. Rápido. Seguro.' },
    }],
  })
}

async function initRegras(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: 'Regras da Comunidade',
      description: 'Ao participar deste servidor você concorda em seguir as regras abaixo. O descumprimento pode resultar em silenciamento ou **remoção permanente**.',
      color: 0xE74C3C,
      fields: [
        {
          name: 'Respeito',
          value: 'Sem ofensas, discriminação, assédio ou ataques pessoais. Sem spam, flood ou divulgação de terceiros.',
          inline: false,
        },
        {
          name: 'Segurança',
          value: 'Nunca compartilhe senhas ou dados pessoais. Credenciais de pedidos só pelos sistemas oficiais da plataforma — a equipe nunca pede isso por DM.',
          inline: false,
        },
        {
          name: 'Pedidos',
          value: 'Dúvidas e problemas de pedido: sistema de tickets. Negociações fora da plataforma não têm suporte nem garantia.',
          inline: false,
        },
        {
          name: 'Conteúdo proibido',
          value: 'Conteúdo ilegal, difamação ou violação dos Termos do Discord resultam em banimento.',
          inline: false,
        },
      ],
      footer: { text: 'EloPeak — respeito é a base da nossa comunidade.' },
    }],
  })
}

async function initAnuncios(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: 'Canal de Anúncios',
      description: 'Canal oficial da equipe: atualizações da plataforma, promoções, novos serviços e avisos de manutenção. Só leitura — dúvidas vão pro canal de suporte.',
      color: 0x3498DB,
      footer: { text: 'Mantenha as notificações ativadas pra não perder nada.' },
    }],
  })
}

async function initComoComprar(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: 'Como Comprar na EloPeak',
      description: 'Simples, seguro e transparente:',
      color: 0x9B59B6,
      fields: [
        {
          name: 'Passo a passo',
          value:
            '**1.** Crie sua conta com Discord.\n' +
            '**2.** Escolha o serviço (Boost, MD5, Vitórias ou Coach).\n' +
            '**3.** Configure rank atual, alvo e adicionais.\n' +
            '**4.** Pague com Pix.\n' +
            '**5.** Acompanhe pelo painel — um booster aprovado assume o pedido.\n' +
            '**6.** Avalie o serviço ao final.',
          inline: false,
        },
        {
          name: 'Segurança',
          value: 'Credenciais só pela plataforma oficial, criptografadas e liberadas apenas pro booster designado.',
          inline: false,
        },
      ],
      footer: { text: 'Dúvidas? Abra um ticket no canal de suporte.' },
    }],
  })
}

async function initReviews(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: 'Canal de Reviews',
      description: 'Avaliações automáticas dos pedidos concluídos aparecem aqui. Comprou um serviço? Conte como foi sua experiência.',
      color: 0xF1C40F,
      fields: [
        {
          name: 'Regra do canal',
          value: 'Exclusivo pra quem comprou um serviço. Avaliações falsas ou de quem não usou os serviços são removidas.',
          inline: false,
        },
      ],
      footer: { text: 'Obrigado por confiar na EloPeak!' },
    }],
  })
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

const INITS: { key: keyof typeof CHANNELS; fn: (id: string) => Promise<void> }[] = [
  { key: 'sobre_nos',    fn: initSobreNos    },
  { key: 'regras',       fn: initRegras      },
  { key: 'anuncios',     fn: initAnuncios    },
  { key: 'como_comprar', fn: initComoComprar },
  { key: 'reviews',      fn: initReviews     },
]

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!WEBHOOK_SECRET) {
    return new Response('Server misconfigured', { status: 500 })
  }

  if (!BOT_TOKEN) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await consumeUserRateLimit('discord-init-channels', 'manual-webhook', 1, 300)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  const results: Record<string, string> = {}

  for (const { key, fn } of INITS) {
    const channelId = CHANNELS[key]
    if (!channelId) {
      results[key] = 'pulado — ID do canal não configurado'
      continue
    }
    try {
      await fn(channelId)
      results[key] = 'ok'
    } catch {
      results[key] = 'failed'
    }
  }

  return jsonResponse(req, results)
})
