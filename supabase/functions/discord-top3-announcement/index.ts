import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { eloPeakFooter } from '../_shared/discordRankFormat.ts'

const DISCORD_API = 'https://discord.com/api/v10'
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? 'https://elo-peak.vercel.app/boosters').replace(/\/$/, '')
// Secret dedicado pra esse endpoint só ser chamável pelo cron interno
// (pg_cron -> pg_net), nunca por qualquer request externa -- mesmo padrão
// x-webhook-secret já usado em discord-order-channel/discord-init-channels,
// só que com um secret PRÓPRIO em vez de reaproveitar o deles (o cron não
// tem acesso ao valor configurado lá, e não devia -- superfícies de auth
// separadas por integração).
const CRON_SECRET = Deno.env.get('DISCORD_CRON_SECRET') ?? ''
// IDs de canal não são credenciais -- não precisam de secret/env, só o
// bot precisa ter sido convidado com permissão de enviar mensagem neles.
const CHANNEL_TOP3 = '1531134555015086293'

interface TopBoosterRow {
  booster_id: string
  display_name: string
  win_rate_pct: number | null
  average_kda: number | null
  average_rating: number | null
  review_count: number | null
  performance_score: number | null
  total_matches: number | null
  completed_orders: number | null
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!CRON_SECRET || !BOT_TOKEN) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Defesa em profundidade contra vazamento do secret (mesmo padrão de
  // discord-init-channels) -- não é a defesa principal (isso é o secret),
  // só limita o dano de um secret comprometido.
  const rateLimit = await consumeUserRateLimit('discord-top3-announcement', 'cron', 2, 300)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  try {
    const db = supabaseAdmin()

    // Recalcula o ranking antes de anunciar -- sem isso, o cron podia
    // anunciar com base num score de dias atrás em vez do estado atual.
    const { error: refreshError } = await db.rpc('refresh_top3_boosters')
    if (refreshError) {
      console.error('refresh_top3_boosters failed', refreshError.message)
      return jsonResponse(req, { error: 'refresh_failed' }, 500)
    }

    // Lê o resultado do refresh direto de is_top3 + booster_performance_segments
    // (linha __all__/__all__/__all__/__all__, o agregado geral) em vez de
    // get_top_boosters -- essa RPC é genérica (usada pelas páginas públicas
    // BoostersPage/HomePage com outros filtros de service_type/rank_bucket) e
    // NÃO aplica o portão de "mínimo de pedidos concluídos" do Top 3, então
    // podia mostrar um booster diferente do que refresh_top3_boosters de fato
    // promoveu. Consultar is_top3 direto garante que a mensagem sempre
    // reflete exatamente quem está com a comissão de Top 3 (55% -> 60%).
    const { data: top3Profiles, error: profilesError } = await db
      .from('booster_profiles')
      .select('user_id, display_name')
      .eq('is_top3', true)
    if (profilesError) {
      console.error('fetch is_top3 profiles failed', profilesError.message)
      return jsonResponse(req, { error: 'fetch_top3_failed' }, 500)
    }
    const boosterIds = (top3Profiles ?? []).map((p) => p.user_id as string)
    if (boosterIds.length === 0) {
      return jsonResponse(req, { ok: true, action: 'skipped_no_boosters' })
    }

    const { data: segments, error: segmentsError } = await db
      .from('booster_performance_segments')
      .select('booster_id, total_matches, wins, average_kda, review_count, average_rating, performance_score, completed_orders')
      .in('booster_id', boosterIds)
      .eq('service_type', '__all__')
      .eq('rank_bucket', '__all__')
      .eq('account_type', '__all__')
      .eq('queue_type', '__all__')
    if (segmentsError) {
      console.error('fetch top3 performance segments failed', segmentsError.message)
      return jsonResponse(req, { error: 'fetch_segments_failed' }, 500)
    }

    const displayNameByBoosterId = new Map((top3Profiles ?? []).map((p) => [p.user_id as string, p.display_name as string]))
    const boosters: TopBoosterRow[] = (segments ?? [])
      .map((s) => ({
        booster_id: s.booster_id as string,
        display_name: displayNameByBoosterId.get(s.booster_id as string) ?? 'Booster EloPeak',
        win_rate_pct: s.total_matches ? Math.round((s.wins as number / (s.total_matches as number)) * 1000) / 10 : null,
        average_kda: s.average_kda as number | null,
        average_rating: s.average_rating as number | null,
        review_count: s.review_count as number | null,
        performance_score: s.performance_score as number | null,
        total_matches: s.total_matches as number | null,
        completed_orders: s.completed_orders as number | null,
      }))
      .sort((a, b) => (b.performance_score ?? 0) - (a.performance_score ?? 0))

    const { data: profiles } = await db
      .from('profiles')
      .select('id, discord_id')
      .in('id', boosters.map((b) => b.booster_id))
    const discordIdByBoosterId = new Map(
      (profiles ?? []).map((p) => [p.id as string, p.discord_id as string | null]),
    )

    const medals = ['🥇', '🥈', '🥉']

    // Cada booster vira um field cheio (não inline) com as métricas que a
    // fórmula de score realmente usa (refresh_booster_performance_segments,
    // migration 20260814120000) -- deixa claro pros outros boosters o PORQUÊ
    // desses 3 em vez de só o nome. Ordem sequencial (1º, depois 2º, depois
    // 3º), de cima pra baixo -- mesma ordem que get_top_boosters já devolve
    // (performance_score desc).
    const boosterField = (b: TopBoosterRow, place: number) => {
      const discordId = discordIdByBoosterId.get(b.booster_id)
      const mention = discordId ? `<@${discordId}>` : `**${b.display_name}**`
      const winRate = b.win_rate_pct != null ? `${b.win_rate_pct.toFixed(1)}%` : '—'
      const kda = b.average_kda != null ? b.average_kda.toFixed(2) : '—'
      const rating = b.average_rating != null ? `${b.average_rating.toFixed(1)}★ (${b.review_count ?? 0} avaliações)` : '—'
      const score = b.performance_score != null ? `${b.performance_score.toFixed(1)}/100` : '—'
      const matches = b.total_matches ?? 0
      const completed = b.completed_orders ?? 0

      // Menção do booster vai no `value`, nunca no `name` -- Discord NÃO
      // resolve <@id> dentro do título/name de um field de embed (renderiza
      // como texto cru do ID em vez de virar a "pill" clicável do usuário),
      // só dentro de title/description/field.value.
      return {
        name: `${medals[place - 1] ?? '🏅'} ${place}º Lugar${place === 1 ? ' 👑' : ''}`,
        value: `${mention}\n📈 Win Rate: **${winRate}**  •  ⚔️ KDA: **${kda}**\n✅ Pedidos Concluídos: **${completed}**  •  🎮 Partidas: **${matches}**\n⭐ Nota: **${rating}**\n🏆 Score Geral: **${score}**`,
        inline: false,
      }
    }

    // Campo separador (não-inline, invisível) entre cada booster -- sem ele,
    // o Discord empilha os blocos de 1º/2º/3º com a margem mínima padrão
    // entre fields, apertado demais entre eles. Diferente dos campos
    // inline de coreServiceFields (discordRankFormat.ts), que já saem no
    // tamanho certo pro empacotamento automático do Discord (até 3 por
    // linha) -- aqui cada booster é um bloco cheio (não-inline) por
    // natureza, então um separador não-inline entre eles só adiciona
    // espaço vertical, sem afetar largura de coluna nenhuma.
    const fields: { name: string; value: string; inline?: boolean }[] = []
    boosters.forEach((b, i) => {
      if (i > 0) fields.push({ name: '​', value: '​', inline: false })
      fields.push(boosterField(b, i + 1))
    })

    // Tudo dentro do embed (sem `content` solto acima) -- a mensagem inteira
    // fica contida numa única "badge".
    const discordRes = await fetchWithTimeout(`${DISCORD_API}/channels/${CHANNEL_TOP3}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '🏆 Top 3 Boosters atualizado!',
          url: APP_URL,
          description: 'Ranking recalculado automaticamente: **45% Win Rate + 30% KDA + 15% Pedidos Concluídos + 10% Avaliações** (mínimo de 10 pedidos concluídos pra entrar).',
          color: 0xFACC15,
          fields,
          footer: eloPeakFooter(APP_URL),
        }],
        allowed_mentions: { parse: ['users'] },
      }),
    })

    if (!discordRes.ok) {
      console.error('Discord send message failed', discordRes.status, await discordRes.text())
      return jsonResponse(req, { error: 'discord_send_failed' }, 502)
    }

    return jsonResponse(req, { ok: true, action: 'announced', count: boosters.length })
  } catch (err) {
    console.error('discord-top3-announcement error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
