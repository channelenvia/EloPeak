import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import {
  fetchRiotAccount,
  fetchMatchIdsSince,
  fetchMatchBody,
  parseMatchDetail,
  fetchLeagueEntries,
  RIOT_QUEUE_TYPE,
  RIOT_TIER_MAP,
  RIOT_DIVISION_MAP,
  NO_DIVISION_TIERS,
  type RiotMatchV5Body,
} from '../_shared/riotLookup.ts'

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY') ?? ''
const REGIONAL_ROUTE = 'americas'
// Brasil-only hoje (orders.server nunca é de fato trocado na UI) -- mesmo
// roteamento fixo usado em verify-order-rank/orderPricing.ts.
const PLATFORM_ROUTE = 'br1'
// Serviços cujo current_rank é tier+divisão (elo_boost/win_boost/md5) --
// Clash não tem rank (usa clash_tier fixo) e Coaching/Placement Matches não
// dependem de current_rank pra nada que este sync alimente.
const RANK_TRACKED_SERVICE_TYPES = new Set(['elo_boost', 'win_boost', 'md5'])
// Backfill de atribuição duo: quantas das últimas partidas do CLIENTE
// checamos em busca da conta duo, além das que já entraram no loop
// principal por serem novas em order_matches. Cobre o caso "booster jogou
// primeiro, só depois cadastrou a conta duo" -- sem isso, essas partidas
// nunca seriam atribuídas ao booster (já estariam em order_matches, então
// nunca cairiam em newMatchIds de novo).
const DUO_BACKFILL_LOOKBACK = 5

const bodySchema = z.object({
  order_id: z.string().uuid(),
}).strict()

function badRequest(req: Request, message: string) {
  return errorResponse(req, message, 400)
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)
    if (!RIOT_API_KEY) return errorResponse(req, 'Server misconfigured', 500)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)
    const { user, client: userClient } = auth

    // Reduzido de 20 -> 6 chamadas/5min: o sync automático (JobDetail, a
    // cada 30 min por pedido) cobre o caso comum, então o limite aqui só
    // precisa segurar cliques manuais repetidos, não sustentar polling.
    const rateLimit = await consumeUserRateLimit('sync-order-matches', user.id, 6, 300)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req)
    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) return badRequest(req, 'Body inválido')
    const { order_id: orderId } = parsedBody.data

    // RLS (orders_customer_read/booster/admin) já restringe a leitura ao
    // cliente dono, ao booster designado ou a um admin — a checagem de
    // identidade abaixo é defesa em profundidade, mesmo padrão da
    // verify-order-rank. O botão "Sincronizar" agora aparece nas 3 telas de
    // detalhe do pedido (cliente/booster/admin), então a autorização precisa
    // aceitar qualquer um dos três, não só o booster.
    const { data: order, error: orderErr } = await userClient
      .from('orders')
      .select('id, status, customer_id, assigned_booster_id, riot_id, boost_mode, queue_type, match_sync_started_at, wins_purchased, duo_own_riot_id, service_type')
      .eq('id', orderId)
      .maybeSingle()
    if (orderErr) return errorResponse(req, 'Failed to load order', 500)
    if (!order) return errorResponse(req, 'Order not found', 404)
    // Capturado fora do closure de attributeDuoMatch abaixo -- o TS não
    // preserva o narrowing de "order não é null" dentro de uma função
    // aninhada definida bem depois do guard clause acima.
    const assignedBoosterId = order.assigned_booster_id

    const serviceClient = supabaseAdmin()

    const isBooster = order.assigned_booster_id === user.id
    const isCustomer = order.customer_id === user.id
    let isAdmin = false
    if (!isBooster && !isCustomer) {
      const { data: profile } = await serviceClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
      isAdmin = profile?.role === 'admin'
    }
    if (!isBooster && !isCustomer && !isAdmin) {
      return errorResponse(req, 'Order not found', 404)
    }

    if (!['in_progress', 'paused', 'drop_requested'].includes(order.status as string)) {
      return badRequest(req, 'Pedido não está em um status sincronizável')
    }

    // order_matches (histórico/progresso DO PEDIDO) é SEMPRE a conta do
    // cliente, solo ou duo -- é a conta sendo entregue, quem determina se o
    // objetivo foi atingido. Em Duo Boost, o booster joga PARTIDO com o
    // cliente numa conta separada (pool da plataforma ou própria) -- essa
    // conta nunca alimenta order_matches, só booster_duo_matches (stats do
    // booster), resolvida abaixo.
    if (!order.riot_id) {
      return badRequest(req, 'Este pedido não tem conta Riot cadastrada para sincronizar')
    }
    const clientRiotId = String(order.riot_id)
    const clientHashIdx = clientRiotId.lastIndexOf('#')
    if (clientHashIdx < 1 || clientHashIdx === clientRiotId.length - 1) {
      return badRequest(req, 'Riot ID inválido')
    }

    // Conta duo (opcional -- pode ainda não ter sido cadastrada). Reservada
    // do pool tem prioridade se por algum motivo as duas existirem.
    let duoRiotId: string | null = null
    if (order.boost_mode === 'duo') {
      const { data: duoAccount, error: duoErr } = await serviceClient
        .from('duo_accounts')
        .select('riot_id')
        .eq('reserved_order_id', orderId)
        .maybeSingle()
      if (duoErr) return errorResponse(req, 'Failed to load duo account', 500)
      duoRiotId = duoAccount?.riot_id ?? (order.duo_own_riot_id as string | null) ?? null
    }

    const startTimeEpochSeconds = order.match_sync_started_at
      ? Math.floor(new Date(order.match_sync_started_at as string).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 60 * 60 * 24

    // ── Account-V1: Riot ID → puuid (cliente + duo, em paralelo) ─────────────
    // As duas chamadas são independentes -- disparar em paralelo evita pagar
    // a latência de duas rodadas sequenciais à Riot a cada sync de pedido duo.
    const [clientAccountResult, duoAccountResult] = await Promise.all([
      fetchRiotAccount(clientRiotId, RIOT_API_KEY, REGIONAL_ROUTE),
      duoRiotId ? fetchRiotAccount(duoRiotId, RIOT_API_KEY, REGIONAL_ROUTE) : Promise.resolve(null),
    ])

    if (!clientAccountResult.ok) {
      if (clientAccountResult.reason === 'not_found') return jsonResponse(req, { synced: false, reason: 'account_not_found' })
      if (clientAccountResult.reason === 'rate_limited') return errorResponse(req, 'Sincronização indisponível no momento, tente novamente em instantes', 503)
      console.error('Riot account-v1 error (client)', clientAccountResult.status)
      return errorResponse(req, 'Falha ao consultar conta Riot', 502)
    }
    const clientPuuid = clientAccountResult.account.puuid

    // Reverifica o rank atual do cliente via League-V4 (mesma fonte de
    // verdade que verify-order-rank usa pra gate de finalização) e atualiza
    // orders.current_rank se mudou -- mantém o filtro de +-1 divisão de
    // contas duo reserváveis (DuoAccountSection) e a estimativa de progresso
    // em cima do rank real, não de uma foto do dia da criação do pedido.
    // Best-effort: nunca aborta o sync de partidas por causa disso.
    if (RANK_TRACKED_SERVICE_TYPES.has(order.service_type as string)) {
      const leagueResult = await fetchLeagueEntries(clientPuuid, RIOT_API_KEY, PLATFORM_ROUTE)
      if (leagueResult.ok) {
        const leagueQueue = RIOT_QUEUE_TYPE[order.queue_type as 'solo_duo' | 'flex'].leagueQueue
        const entry = leagueResult.entries.find((e) => e.queueType === leagueQueue)
        const verifiedTier = entry?.tier ? RIOT_TIER_MAP[entry.tier] ?? null : null
        if (verifiedTier) {
          const verifiedDivision = NO_DIVISION_TIERS.includes(verifiedTier)
            ? null
            : entry?.rank ? RIOT_DIVISION_MAP[entry.rank] ?? null : null
          if (NO_DIVISION_TIERS.includes(verifiedTier) || verifiedDivision) {
            const { error: rankErr } = await serviceClient.rpc('update_order_current_rank', {
              p_order_id: orderId,
              p_tier: verifiedTier,
              p_division: verifiedDivision,
              p_lp: Math.max(0, Number(entry?.leaguePoints ?? 0)),
            })
            if (rankErr) console.error('update_order_current_rank failed', orderId, rankErr.message)
          }
        }
      } else if (leagueResult.reason !== 'rate_limited') {
        console.error('Riot league-v4 error (rank sync)', leagueResult.status)
      }
    }

    // Conta duo: best-effort. Se falhar (não encontrada, rate limit), não
    // aborta a sincronização inteira -- o histórico do pedido (lado do
    // cliente) continua funcionando normalmente, só a atribuição de stats
    // pro booster fica pra próxima tentativa.
    let duoPuuid: string | null = null
    if (duoAccountResult) {
      if (duoAccountResult.ok) {
        duoPuuid = duoAccountResult.account.puuid
      } else if (duoAccountResult.reason !== 'not_found') {
        console.error('Riot account-v1 error (duo)', duoAccountResult.status)
      }
    }

    // Clash usa a fila de torneio própria da Riot (700). Elo Boost,
    // Vitórias e MD5 seguem a fila ranqueada escolhida no pedido.
    const matchQueueId = order.service_type === 'clash'
      ? 700
      : RIOT_QUEUE_TYPE[order.queue_type as 'solo_duo' | 'flex'].matchQueueId

    const idsResult = await fetchMatchIdsSince(clientPuuid, RIOT_API_KEY, REGIONAL_ROUTE, matchQueueId, startTimeEpochSeconds)
    if (!idsResult.ok) {
      if (idsResult.reason === 'rate_limited') return errorResponse(req, 'Sincronização indisponível no momento, tente novamente em instantes', 503)
      console.error('Riot match-v5 ids error', idsResult.status)
      return errorResponse(req, 'Falha ao consultar partidas na Riot', 502)
    }

    // Riot devolve mais recente primeiro -- guarda essa ordem pro backfill
    // duo abaixo (só olha as últimas N), antes de reverter pro loop
    // principal (mais antiga primeiro, pro histórico evoluir em ordem real).
    const idsMostRecentFirst = idsResult.matchIds

    // Não reprocessa partidas já registradas — evita gastar chamadas da Riot
    // com detalhe de partidas que já sabemos ter contabilizado.
    const { data: existingMatches } = await serviceClient
      .from('order_matches')
      .select('external_match_id')
      .eq('order_id', orderId)
    const alreadyRecorded = new Set((existingMatches ?? []).map((m) => m.external_match_id as string))
    const newMatchIds = idsMostRecentFirst.filter((id) => !alreadyRecorded.has(id))
    newMatchIds.reverse()

    const recorded: Array<{ external_match_id: string; result: 'win' | 'loss'; champion: string | null }> = []
    const duoCheckedIds = new Set<string>()
    let duoRecordedCount = 0

    async function attributeDuoMatch(body: RiotMatchV5Body, matchId: string): Promise<void> {
      duoCheckedIds.add(matchId)
      if (!duoPuuid) return
      const duoDetail = parseMatchDetail(body, duoPuuid, matchId)
      // ok: false aqui só significa que a conta duo não estava NESSA partida
      // específica (ex.: o cliente jogou uma sozinho) -- não é um erro.
      if (!duoDetail.ok) return
      const d = duoDetail.detail
      // .select() faz a diferença aqui: com ignoreDuplicates, um conflito
      // vira um no-op que a Supabase reporta como sucesso (error: null) --
      // sem checar se alguma linha voltou, duoRecordedCount subiria mesmo
      // reprocessando uma partida já gravada (ex.: loop principal parou em
      // 'invalid_status' e a mesma partida volta em newMatchIds na próxima
      // chamada), disparando um refresh_booster_performance_segments à toa.
      const { data: upserted, error } = await serviceClient
        .from('booster_duo_matches')
        .upsert({
          order_id: orderId,
          booster_id: assignedBoosterId,
          external_match_id: d.externalMatchId,
          result: d.result,
          champion: d.champion,
          kills: d.kills,
          deaths: d.deaths,
          assists: d.assists,
          queue_id: d.queueId,
          duration_seconds: d.durationSeconds,
          played_at: d.playedAt,
          minions_killed: d.minionsKilled,
          neutral_minions_killed: d.neutralMinionsKilled,
          is_mvp: d.isMvp,
          vision_score: d.visionScore,
        }, { onConflict: 'order_id,external_match_id', ignoreDuplicates: true })
        .select('id')
      if (error) console.error('booster_duo_matches upsert failed', matchId, error.message)
      else if (upserted && upserted.length > 0) duoRecordedCount += 1
    }

    for (const matchId of newMatchIds) {
      const bodyResult = await fetchMatchBody(matchId, RIOT_API_KEY, REGIONAL_ROUTE)
      if (!bodyResult.ok) {
        if (bodyResult.reason === 'rate_limited') break
        console.error('Riot match-v5 detail error', matchId, bodyResult.status)
        continue
      }

      const clientDetail = parseMatchDetail(bodyResult.body, clientPuuid, matchId)
      if (clientDetail.ok) {
        const { data: recordResult, error: recordErr } = await serviceClient.rpc('record_order_match', {
          p_order_id: orderId,
          p_external_match_id: clientDetail.detail.externalMatchId,
          p_result: clientDetail.detail.result,
          p_champion: clientDetail.detail.champion,
          p_kills: clientDetail.detail.kills,
          p_deaths: clientDetail.detail.deaths,
          p_assists: clientDetail.detail.assists,
          p_queue_id: clientDetail.detail.queueId,
          p_duration_seconds: clientDetail.detail.durationSeconds,
          p_played_at: clientDetail.detail.playedAt,
          p_minions_killed: clientDetail.detail.minionsKilled,
          p_neutral_minions_killed: clientDetail.detail.neutralMinionsKilled,
          p_is_mvp: clientDetail.detail.isMvp,
          p_vision_score: clientDetail.detail.visionScore,
        })
        const result = recordResult as { success?: boolean; inserted?: boolean; error?: string } | null
        if (recordErr || !result?.success) {
          console.error('record_order_match failed', result?.error ?? recordErr?.message)
          // Pedido pode ter saído de in_progress/paused durante a
          // sincronização (ex: booster marcou concluído em outra aba) —
          // para sem corromper o que já foi contabilizado até aqui.
          if (result?.error === 'invalid_status') break
        } else if (result.inserted) {
          recorded.push({
            external_match_id: clientDetail.detail.externalMatchId,
            result: clientDetail.detail.result,
            champion: clientDetail.detail.champion,
          })
        }
      }

      if (duoPuuid) await attributeDuoMatch(bodyResult.body, matchId)
    }

    // Backfill: partidas jogadas ANTES do booster cadastrar a conta duo já
    // estariam em order_matches (não passam por newMatchIds de novo), então
    // nunca seriam checadas pra atribuição duo sem isso. Olha só as últimas
    // DUO_BACKFILL_LOOKBACK do cliente, pulando as que o loop acima já
    // checou ou que já têm linha em booster_duo_matches.
    if (duoPuuid) {
      const backfillCandidates = idsMostRecentFirst
        .slice(0, DUO_BACKFILL_LOOKBACK)
        .filter((id) => !duoCheckedIds.has(id))

      // Uma consulta batched pros até DUO_BACKFILL_LOOKBACK candidatos, em
      // vez de um SELECT sequencial por candidato -- mesmo resultado, só sem
      // pagar N round-trips ao banco antes de decidir se vale a pena buscar
      // na Riot.
      const alreadyInDuoMatches = backfillCandidates.length > 0
        ? new Set(
            (await serviceClient
              .from('booster_duo_matches')
              .select('external_match_id')
              .eq('order_id', orderId)
              .in('external_match_id', backfillCandidates)
            ).data?.map((m) => m.external_match_id as string) ?? [],
          )
        : new Set<string>()

      for (const matchId of backfillCandidates) {
        if (alreadyInDuoMatches.has(matchId)) continue

        const bodyResult = await fetchMatchBody(matchId, RIOT_API_KEY, REGIONAL_ROUTE)
        if (!bodyResult.ok) {
          if (bodyResult.reason === 'rate_limited') break
          console.error('Riot match-v5 detail error (duo backfill)', matchId, bodyResult.status)
          continue
        }
        await attributeDuoMatch(bodyResult.body, matchId)
      }
    }

    const { error: markSyncError } = await serviceClient.rpc('mark_order_match_sync', { p_order_id: orderId })
    if (markSyncError) console.error('mark_order_match_sync failed', orderId, markSyncError.message)

    // Um recálculo ao final do lote, não por partida — sync-order-matches
    // pode registrar várias partidas numa única chamada. Usa o booster REAL
    // do pedido (order.assigned_booster_id), não user.id — o chamador pode
    // ser o cliente ou um admin disparando o sync manualmente, não só o
    // próprio booster.
    if (recorded.length > 0 || duoRecordedCount > 0) {
      const { error: refreshError } = await serviceClient.rpc('refresh_booster_performance_segments', { p_booster_id: order.assigned_booster_id })
      if (refreshError) console.error('refresh_booster_performance_segments failed', order.assigned_booster_id, refreshError.message)
    }

    return jsonResponse(req, {
      synced: true,
      new_matches: recorded.length,
      matches: recorded,
    })
  } catch (err) {
    console.error('sync-order-matches error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
