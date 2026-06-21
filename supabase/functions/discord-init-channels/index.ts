import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

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
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`)
}

// ─── Mensagens de cada canal ──────────────────────────────────────────────────

async function initSobreNos(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: '🏔️ Sobre a EloPeak',
      description:
        'Somos uma plataforma especializada em serviços para **League of Legends**, conectando jogadores a boosters aprovados de forma prática, transparente e segura.\n\n' +
        '*Nosso objetivo é oferecer uma experiência profissional, rápida e segura para todos os clientes.*',
      color: 0x22C55E,
      fields: [
        {
          name: '🎮 Nossos Serviços',
          value:
            '• **Elo Boost** — um profissional joga na sua conta para alcançar o elo desejado.\n' +
            '• **Duo Boost** — jogue ao lado de um booster experiente durante a subida.\n' +
            '• **Partidas Ranqueadas (MD5)** — realizamos suas partidas de colocação.\n' +
            '• **Pacotes de Vitórias** — contrate uma quantidade específica de wins.\n' +
            '• **Coach** — acompanhamento personalizado para melhorar sua gameplay, tomada de decisões e mecânicas.',
          inline: false,
        },
        {
          name: '🔒 Segurança e Tecnologia',
          value:
            '• Acesso protegido — o booster não recebe sua senha diretamente.\n' +
            '• Código temporário de autenticação para cada pedido.\n' +
            '• Acompanhamento em tempo real e suporte 24 horas.',
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
      title: '📋 Regras da Comunidade',
      description:
        'Ao participar deste servidor, você concorda em respeitar todas as diretrizes abaixo.\n' +
        'O não cumprimento poderá resultar em advertência, silenciamento temporário ou **remoção permanente** da comunidade.',
      color: 0xE74C3C,
      fields: [
        {
          name: '🤝 Respeito e Convivência',
          value:
            '• Mantenha um comportamento respeitoso com todos os membros.\n' +
            '• Comentários ofensivos, preconceituosos, discriminatórios ou qualquer forma de assédio não serão tolerados.\n' +
            '• Sem discussões, ataques pessoais ou provocações excessivas.',
          inline: false,
        },
        {
          name: '💬 Mensagens e Divulgação',
          value:
            '• É proibido enviar mensagens repetidas, flood ou qualquer forma de spam.\n' +
            '• Não promova plataformas, serviços ou comunidades concorrentes.\n' +
            '• Sem divulgação de links, redes sociais ou projetos pessoais não permitidos.',
          inline: false,
        },
        {
          name: '🔐 Segurança',
          value:
            '• Nunca publique informações sensíveis, como senhas, logins ou dados pessoais.\n' +
            '• O compartilhamento de credenciais relacionadas aos pedidos deve ocorrer apenas pelos sistemas oficiais da plataforma.\n' +
            '• Nenhum membro da equipe solicitará dados confidenciais por mensagem privada. Em caso de suspeita, entre em contato com os donos.',
          inline: false,
        },
        {
          name: '🎟️ Pedidos e Atendimento',
          value:
            '• Dúvidas, problemas ou solicitações relacionadas a pedidos devem ser tratadas através do sistema de tickets.\n' +
            '• Negociações diretas entre membros não são recomendadas nem possuem suporte da plataforma.\n' +
            '• A EloPeak não se responsabiliza por transações realizadas fora dos canais oficiais.',
          inline: false,
        },
        {
          name: '🚫 Conteúdo Proibido',
          value:
            '• É proibido compartilhar conteúdo ilegal, impróprio ou que infrinja os Termos de Serviço do Discord.\n' +
            '• Acusações falsas, difamação ou tentativas de prejudicar membros, clientes ou a empresa poderão resultar em banimento permanente.',
          inline: false,
        },
        {
          name: '⚖️ Disposições Gerais',
          value:
            '• A equipe de moderação reserva-se o direito de agir em situações não previstas nestas regras para preservar a organização e a segurança da comunidade.\n' +
            '• O desconhecimento das regras não isenta nenhum usuário de suas responsabilidades.',
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
      title: '📣 Canal de Anúncios',
      description:
        'Bem-vindo ao canal oficial de anúncios da **EloPeak**.\n\n' +
        'Este espaço é reservado exclusivamente para comunicações da equipe e da plataforma. Aqui você encontrará todas as informações importantes relacionadas aos nossos serviços e à comunidade.',
      color: 0x3498DB,
      fields: [
        {
          name: '📌 O que será publicado aqui?',
          value:
            '• Atualizações da plataforma e novos recursos\n' +
            '• Promoções, cupons e ofertas especiais\n' +
            '• Lançamento de serviços e funcionalidades\n' +
            '• Eventos e campanhas da comunidade\n' +
            '• Informações sobre manutenção e instabilidades\n' +
            '• Alterações em regras, sistemas ou processos\n' +
            '• Comunicados oficiais dos donos',
          inline: false,
        },
        {
          name: '⚠️ Importante',
          value:
            '• Este canal possui apenas foco informativo.\n' +
            '• Recomendamos manter as notificações ativadas para acompanhar todas as novidades em primeira mão.\n' +
            '• Em caso de dúvidas, utilize os canais de suporte ou abra um ticket.',
          inline: false,
        },
      ],
      footer: { text: 'Fique atento às publicações para não perder nenhuma atualização.' },
    }],
  })
}

async function initComoComprar(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: '🛒 Como Comprar na EloPeak',
      description: 'Comprar é simples, seguro e transparente. Siga o passo a passo:',
      color: 0x9B59B6,
      fields: [
        {
          name: '📝 Passo a Passo',
          value:
            '**1️⃣ Crie sua conta** — Acesse nossa plataforma e cadastre-se gratuitamente com Discord.\n' +
            '**2️⃣ Escolha o serviço** — Selecione entre Elo Boost, Duo Boost, MD5, Pacotes de Vitórias ou Coach.\n' +
            '**3️⃣ Configure seu pedido** — Informe seu rank atual, rank desejado, servidor e os adicionais que desejar.\n' +
            '**4️⃣ Realize o pagamento** — Pague com segurança via Pix ou cartão de crédito.\n' +
            '**5️⃣ Acompanhe em tempo real** — Um booster aprovado será atribuído ao seu pedido. Acompanhe tudo pelo painel.\n' +
            '**6️⃣ Receba o resultado** — Após a conclusão, avalie o serviço e aproveite!',
          inline: false,
        },
        {
          name: '🔒 Sua segurança em primeiro lugar',
          value:
            'Você **nunca** precisa compartilhar sua senha.\n' +
            'O acesso do booster é feito por **código temporário** gerado pela plataforma para cada pedido.',
          inline: false,
        },
        {
          name: '❓ Ainda tem dúvidas?',
          value: 'Abra um ticket no canal de suporte ou entre em contato com nossa equipe. Estamos disponíveis 24 horas.',
          inline: false,
        },
      ],
      footer: { text: 'EloPeak — do pedido ao resultado, com segurança.' },
    }],
  })
}

async function initReviews(channelId: string) {
  await send(channelId, {
    embeds: [{
      title: '⭐ Canal de Reviews',
      description:
        'Este canal é dedicado às avaliações dos **compradores** que utilizaram nossos serviços.\n\n' +
        'Se você comprou um serviço na **EloPeak**, compartilhe aqui como foi sua experiência. ' +
        'Sua opinião ajuda outros jogadores a tomarem a melhor decisão e nos motiva a continuar melhorando.',
      color: 0xF1C40F,
      fields: [
        {
          name: '💬 O que você pode compartilhar',
          value:
            '• Como foi a experiência com o booster\n' +
            '• Qualidade e velocidade do serviço\n' +
            '• Sugestões para melhorarmos',
          inline: false,
        },
        {
          name: '📌 Regra do canal',
          value:
            'Este canal é **exclusivo para compradores**. Apenas quem realizou um pedido pode deixar review aqui.\n' +
            'Avaliações falsas ou de membros que não utilizaram os serviços serão removidas.',
          inline: false,
        },
      ],
      footer: { text: 'Obrigado por confiar na EloPeak! 🏆' },
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

  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

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
    } catch (err) {
      results[key] = (err as Error).message
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
