import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1'
import {
  fetchRiotAccount,
  fetchMatchIdsSince,
  fetchMatchBody,
  parseMatchDetail,
  isRemakeMatch,
  fetchRankOrdinal,
  resolveMatchResult,
  rankOrdinal,
  RIOT_QUEUE_TYPE,
  type RiotMatchV5Body,
  type RankOrdinal,
} from './riotLookup.ts'
import type { RankTier, Division } from '../../../shared/pricing.ts'

// Núcleo de sync-order-matches, extraído pra ser reaproveitado por dois
// chamadores com autorização bem diferente:
//   - sync-order-matches/index.ts: usuário logado (booster/cliente/admin do
//     PEDIDO), aciona um pedido específico, autenticação e rate limit por
//     usuário já resolvidos ANTES de chegar aqui.
//   - cron-sync-order-matches/index.ts: pg_cron, autorizado por secret
//     próprio (nunca por um usuário), varre TODO pedido ativo sem sync
//     recente -- não faz sentido pedir "de quem é esse pedido" pra ele.
// Por isso este módulo não sabe nada sobre quem está chamando -- só recebe o
// pedido já carregado e devolve {status, body} (nunca um Response pronto),
// pra cada chamador decidir como embrulhar (jsonResponse com seu próprio
// `req`, ou só ler o body pra contar sucesso/falha num loop).
export interface OrderForMatchSync {
  id: string
  status: string
  riot_id: string | null
  boost_mode: string
  queue_type: string | null
  match_sync_started_at: string | null
  wins_purchased: number | null
  duo_own_riot_id: string | null
  service_type: string
  current_rank: unknown
  duo_current_rank: unknown
}

export interface OrderMatchSyncOutcome {
  status: number
  body: Record<string, unknown>
}

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
// principal por serem novas em order_matches. Mesmo teto do `count` default
// de fetchMatchIdsSince.
const DUO_BACKFILL_LOOKBACK = 20

// current_rank/duo_current_rank vêm do banco como jsonb solto -- só vira um
// checkpoint utilizável (ver resolveMatchResult abaixo) se tiver tier+lp;
// divisão fica null pra Mestre+ (NO_DIVISION_TIERS), então não entra na
// checagem de presença.
function ordinalFromRankJson(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null
  const { tier, division, lp } = json as { tier?: string; division?: string | null; lp?: number }
  if (!tier || typeof lp !== 'number') return null
  return rankOrdinal(tier as RankTier, (division ?? null) as Division | null, lp)
}

export async function syncOrderMatches(
  order: OrderForMatchSync,
  serviceClient: SupabaseClient,
): Promise<OrderMatchSyncOutcome> {
  const orderId = order.id

  if (!RIOT_API_KEY) return { status: 500, body: { error: 'Server misconfigured' } }

  if (!['in_progress', 'paused', 'drop_requested'].includes(order.status)) {
    return { status: 400, body: { error: 'Pedido não está em um status sincronizável' } }
  }

  // queue_type alimenta RIOT_QUEUE_TYPE[...] mais abaixo (Elo Boost/
  // Vitórias/MD5 -- Clash usa a fila de torneio fixa 700, não passa por
  // aqui). Um valor malformado no banco lançaria TypeError ao indexar
  // RIOT_QUEUE_TYPE e cairia num 500 genérico sem contexto -- validado aqui.
  if (order.service_type !== 'clash' && order.queue_type !== 'solo_duo' && order.queue_type !== 'flex') {
    console.error('syncOrderMatches: queue_type inválido', orderId, order.queue_type)
    return { status: 500, body: { error: 'Pedido com fila inválida -- contate o suporte' } }
  }

  // order_matches (histórico/progresso DO PEDIDO) é SEMPRE a conta do
  // cliente, solo ou duo -- é a conta sendo entregue, quem determina se o
  // objetivo foi atingido. Em Duo Boost, o booster joga PARTIDO com o
  // cliente numa conta separada (pool da plataforma ou própria) -- essa
  // conta nunca alimenta order_matches, só booster_duo_matches (stats do
  // booster), resolvida abaixo.
  if (!order.riot_id) {
    return { status: 400, body: { error: 'Este pedido não tem conta Riot cadastrada para sincronizar' } }
  }
  const clientRiotId = String(order.riot_id)
  const clientHashIdx = clientRiotId.lastIndexOf('#')
  if (clientHashIdx < 1 || clientHashIdx === clientRiotId.length - 1) {
    return { status: 400, body: { error: 'Riot ID inválido' } }
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
    if (duoErr) return { status: 500, body: { error: 'Failed to load duo account' } }
    duoRiotId = duoAccount?.riot_id ?? (order.duo_own_riot_id as string | null) ?? null
  }

  // match_sync_started_at é setado (coalesce) por accept_boost_order/
  // update_order_status sempre que o pedido entra em in_progress -- se
  // estiver null aqui apesar do status já ter passado pelo check acima, é
  // um estado de dados inválido, não um "pedido antigo sem o campo". Cair
  // pra "últimas 24h" nesse caso puxaria partidas de ANTES do boost pro
  // progresso/atribuição do pedido. Falha alto e claro em vez disso.
  if (!order.match_sync_started_at) {
    console.error('syncOrderMatches: match_sync_started_at ausente em pedido sincronizável', orderId)
    return { status: 500, body: { error: 'Pedido sem marca de início de sincronização -- contate o suporte' } }
  }
  const startTimeEpochSeconds = Math.floor(new Date(order.match_sync_started_at).getTime() / 1000)

  // ── Account-V1: Riot ID → puuid (cliente + duo, em paralelo) ─────────────
  const [clientAccountResult, duoAccountResult] = await Promise.all([
    fetchRiotAccount(clientRiotId, RIOT_API_KEY, REGIONAL_ROUTE),
    duoRiotId ? fetchRiotAccount(duoRiotId, RIOT_API_KEY, REGIONAL_ROUTE) : Promise.resolve(null),
  ])

  if (!clientAccountResult.ok) {
    if (clientAccountResult.reason === 'not_found') return { status: 200, body: { synced: false, reason: 'account_not_found' } }
    if (clientAccountResult.reason === 'rate_limited') {
      return { status: 503, body: { error: 'Sincronização indisponível no momento, tente novamente em instantes' } }
    }
    console.error('Riot account-v1 error (client)', clientAccountResult.status)
    return { status: 502, body: { error: 'Falha ao consultar conta Riot' } }
  }
  const clientPuuid = clientAccountResult.account.puuid

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

  // Defesa contra "duo self-match": se a conta duo cadastrada resolver pro
  // MESMO puuid da conta do cliente, ela "participaria" trivialmente de
  // toda partida do cliente, contando progresso do pedido sem nenhum
  // segundo jogador real. Trata como se nenhuma conta duo estivesse
  // cadastrada -- mesmo efeito de not_found.
  if (duoPuuid && duoPuuid === clientPuuid) {
    console.error('duo account puuid matches client puuid (self-match)', orderId)
    duoPuuid = null
  }

  const isRankTracked = RANK_TRACKED_SERVICE_TYPES.has(order.service_type)
  const leagueQueue = isRankTracked ? RIOT_QUEUE_TYPE[order.queue_type as 'solo_duo' | 'flex'].leagueQueue : null

  async function persistClientRank(ordinal: RankOrdinal): Promise<void> {
    const { error } = await serviceClient.rpc('update_order_current_rank', {
      p_order_id: orderId, p_tier: ordinal.tier, p_division: ordinal.division, p_lp: ordinal.lp,
    })
    if (error) console.error('update_order_current_rank failed', orderId, error.message)
  }
  async function persistDuoRank(ordinal: RankOrdinal): Promise<void> {
    const { error } = await serviceClient.rpc('update_order_duo_current_rank', {
      p_order_id: orderId, p_tier: ordinal.tier, p_division: ordinal.division, p_lp: ordinal.lp,
    })
    if (error) console.error('update_order_duo_current_rank failed', orderId, error.message)
  }

  // Checkpoint de PDL/LP de cada lado -- resolveMatchResult (partida a
  // partida, mais abaixo) usa isso pra decidir remake comparando antes/
  // depois em vez de confiar só em timePlayed. Semeado SÓ com o último
  // valor conhecido no banco (de ANTES desta chamada), de propósito.
  const clientOrdinal: { value: number | null } = { value: ordinalFromRankJson(order.current_rank) }
  const duoOrdinal: { value: number | null } = { value: ordinalFromRankJson(order.duo_current_rank) }

  // allowPdlDelta é setado mais abaixo, depois que newMatchIds é conhecido
  // -- resolveClientResult/resolveDuoResult só usam a comparação de PDL/LP
  // quando há NO MÁXIMO UMA partida nova pra processar neste lado.
  let allowPdlDelta = false

  function resolveClientResult(body: RiotMatchV5Body, isRemake: boolean, rawResult: 'win' | 'loss') {
    return resolveMatchResult({
      isRankTracked: isRankTracked && allowPdlDelta, isRemake, rawResult, body, puuid: clientPuuid,
      tracker: clientOrdinal,
      fetchOrdinal: () => fetchRankOrdinal(clientPuuid, RIOT_API_KEY, PLATFORM_ROUTE, leagueQueue!),
      persist: persistClientRank,
    })
  }
  function resolveDuoResult(body: RiotMatchV5Body, isRemake: boolean, rawResult: 'win' | 'loss') {
    return resolveMatchResult({
      isRankTracked: isRankTracked && allowPdlDelta, isRemake, rawResult, body, puuid: duoPuuid!,
      tracker: duoOrdinal,
      fetchOrdinal: () => fetchRankOrdinal(duoPuuid!, RIOT_API_KEY, PLATFORM_ROUTE, leagueQueue!),
      persist: persistDuoRank,
    })
  }

  // Clash usa a fila de torneio própria da Riot (700). Elo Boost, Vitórias
  // e MD5 seguem a fila ranqueada escolhida no pedido.
  const matchQueueId = order.service_type === 'clash'
    ? 700
    : RIOT_QUEUE_TYPE[order.queue_type as 'solo_duo' | 'flex'].matchQueueId

  const idsResult = await fetchMatchIdsSince(clientPuuid, RIOT_API_KEY, REGIONAL_ROUTE, matchQueueId, startTimeEpochSeconds)
  if (!idsResult.ok) {
    if (idsResult.reason === 'rate_limited') {
      return { status: 503, body: { error: 'Sincronização indisponível no momento, tente novamente em instantes' } }
    }
    console.error('Riot match-v5 ids error', idsResult.status)
    return { status: 502, body: { error: 'Falha ao consultar partidas na Riot' } }
  }

  // Riot devolve mais recente primeiro -- guarda essa ordem pro backfill duo
  // abaixo, antes de reverter pro loop principal (mais antiga primeiro).
  const idsMostRecentFirst = idsResult.matchIds

  // Não reprocessa partidas já registradas. Inclui order_ignored_matches
  // (partidas duo já verificadas e descartadas) -- sem isso, essas partidas
  // nunca ficam "resolvidas" e voltariam em newMatchIds pra sempre.
  const [{ data: existingMatches }, { data: ignoredMatches }] = await Promise.all([
    serviceClient.from('order_matches').select('external_match_id').eq('order_id', orderId),
    serviceClient.from('order_ignored_matches').select('external_match_id').eq('order_id', orderId),
  ])
  const alreadyRecorded = new Set([
    ...(existingMatches ?? []).map((m) => m.external_match_id as string),
    ...(ignoredMatches ?? []).map((m) => m.external_match_id as string),
  ])
  const newMatchIds = idsMostRecentFirst.filter((id) => !alreadyRecorded.has(id))
  newMatchIds.reverse()

  // Só dá pra comparar "PDL antes" vs "PDL depois" com confiança quando
  // existe NO MÁXIMO UMA partida nova neste lote -- com 2+, ativa abaixo só
  // durante o loop principal; o backfill duo sempre processa um histórico
  // de até DUO_BACKFILL_LOOKBACK partidas de uma vez, nunca "uma partida
  // isolada", e por isso nunca usa a comparação de PDL.
  allowPdlDelta = newMatchIds.length <= 1

  const recorded: Array<{ external_match_id: string; result: 'win' | 'loss' | 'remake'; champion: string | null }> = []
  const duoCheckedIds = new Set<string>()
  // Booster(s) que de fato receberam alguma partida CONTABILIZÁVEL nesta
  // chamada -- pode ser mais de um (ou nenhum "atual") se o pedido foi
  // reatribuído e o sync só rodou depois: record_order_match/
  // record_duo_match resolvem o booster pelo played_at (janela de
  // atribuição), não pelo atribuído agora.
  const recordedBoosterIds = new Set<string>()

  // Retorna se a conta duo participou DESSA partida específica.
  async function attributeDuoMatch(body: RiotMatchV5Body, matchId: string, remake: boolean): Promise<boolean> {
    duoCheckedIds.add(matchId)
    if (!duoPuuid) return false
    const duoDetail = parseMatchDetail(body, duoPuuid, matchId)
    if (!duoDetail.ok) return false
    const d = duoDetail.detail
    const duoFinalResult = await resolveDuoResult(body, remake, d.result)
    const { data: recordResult, error } = await serviceClient.rpc('record_duo_match', {
      p_order_id: orderId,
      p_external_match_id: d.externalMatchId,
      p_result: duoFinalResult,
      p_champion: d.champion,
      p_kills: d.kills,
      p_deaths: d.deaths,
      p_assists: d.assists,
      p_queue_id: d.queueId,
      p_duration_seconds: d.durationSeconds,
      p_played_at: d.playedAt,
      p_minions_killed: d.minionsKilled,
      p_neutral_minions_killed: d.neutralMinionsKilled,
      p_is_mvp: d.isMvp,
      p_vision_score: d.visionScore,
    })
    const result = recordResult as { success?: boolean; inserted?: boolean; error?: string; booster_id?: string } | null
    if (error || !result?.success) console.error('record_duo_match failed', matchId, result?.error ?? error?.message)
    else if (result.inserted && duoFinalResult !== 'remake' && result.booster_id) {
      recordedBoosterIds.add(result.booster_id)
    }
    return true
  }

  for (const matchId of newMatchIds) {
    const bodyResult = await fetchMatchBody(matchId, RIOT_API_KEY, REGIONAL_ROUTE)
    if (!bodyResult.ok) {
      if (bodyResult.reason === 'rate_limited') break
      console.error('Riot match-v5 detail error', matchId, bodyResult.status)
      continue
    }

    // Remake ("deu kita"): partida abortada em ~3min por AFK/queda, sem LP
    // real em jogo -- não conta pro progresso do pedido nem pro perfil do
    // booster, mas fica gravada e visível no histórico do pedido.
    const remake = isRemakeMatch(bodyResult.body)

    // Em Duo Boost checa a atribuição ANTES de chamar record_order_match --
    // o próprio banco decide se conta (p_duo_participated abaixo).
    const duoParticipated = duoPuuid ? await attributeDuoMatch(bodyResult.body, matchId, remake) : false

    const clientDetail = parseMatchDetail(bodyResult.body, clientPuuid, matchId)
    if (clientDetail.ok) {
      const clientFinalResult = await resolveClientResult(bodyResult.body, remake, clientDetail.detail.result)
      const { data: recordResult, error: recordErr } = await serviceClient.rpc('record_order_match', {
        p_order_id: orderId,
        p_external_match_id: clientDetail.detail.externalMatchId,
        p_result: clientFinalResult,
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
        // Em Duo Boost, o cliente joga PARTIDO com o booster (conta
        // separada) -- uma partida só conta pro progresso do pedido se a
        // conta duo cadastrada participou dela; o banco recusa quando
        // falso. Solo Boost não tem conta duo (parâmetro irrelevante).
        p_duo_participated: order.boost_mode === 'duo' ? duoParticipated : null,
      })
      const result = recordResult as { success?: boolean; inserted?: boolean; error?: string; skipped_reason?: string; booster_id?: string } | null
      if (recordErr || !result?.success) {
        console.error('record_order_match failed', result?.error ?? recordErr?.message)
        // Pedido pode ter saído de in_progress/paused durante a
        // sincronização (ex: booster marcou concluído em outra aba) --
        // para sem corromper o que já foi contabilizado até aqui.
        if (result?.error === 'invalid_status') break
      } else if (result.inserted) {
        recorded.push({
          external_match_id: clientDetail.detail.externalMatchId,
          result: clientFinalResult,
          champion: clientDetail.detail.champion,
        })
        if (clientFinalResult !== 'remake' && result.booster_id) recordedBoosterIds.add(result.booster_id)
      } else {
        // Não inseriu mas também não é erro (ex.: duo não participou) --
        // cacheia como ignorada pra não re-buscar essa MESMA partida na
        // Riot em nenhum sync futuro.
        const { error: ignoreErr } = await serviceClient
          .from('order_ignored_matches')
          .upsert(
            { order_id: orderId, external_match_id: clientDetail.detail.externalMatchId },
            { onConflict: 'order_id,external_match_id', ignoreDuplicates: true },
          )
        if (ignoreErr) console.error('order_ignored_matches upsert failed', matchId, ignoreErr.message)
      }
    }
  }

  // Backfill sempre revê um histórico de até DUO_BACKFILL_LOOKBACK partidas
  // de uma vez -- nunca "uma partida isolada", então desliga aqui incondicionalmente.
  allowPdlDelta = false

  // Backfill: partidas jogadas ANTES do booster cadastrar a conta duo já
  // estariam em order_matches ou order_ignored_matches, então nunca seriam
  // checadas pra atribuição duo sem isso.
  if (duoPuuid) {
    const backfillCandidates = idsMostRecentFirst
      .slice(0, DUO_BACKFILL_LOOKBACK)
      .filter((id) => !duoCheckedIds.has(id))

    const [duoMatchesResult, ignoredMatchesResult] = backfillCandidates.length > 0
      ? await Promise.all([
          serviceClient.from('booster_duo_matches').select('external_match_id').eq('order_id', orderId).in('external_match_id', backfillCandidates),
          serviceClient.from('order_ignored_matches').select('external_match_id').eq('order_id', orderId).in('external_match_id', backfillCandidates),
        ])
      : [{ data: [] as { external_match_id: string }[] | null }, { data: [] as { external_match_id: string }[] | null }]
    const alreadyInDuoMatches = new Set((duoMatchesResult.data ?? []).map((m) => m.external_match_id as string))
    const previouslyIgnored = new Set((ignoredMatchesResult.data ?? []).map((m) => m.external_match_id as string))

    for (const matchId of backfillCandidates) {
      if (alreadyInDuoMatches.has(matchId) && !previouslyIgnored.has(matchId)) continue

      const bodyResult = await fetchMatchBody(matchId, RIOT_API_KEY, REGIONAL_ROUTE)
      if (!bodyResult.ok) {
        if (bodyResult.reason === 'rate_limited') break
        console.error('Riot match-v5 detail error (duo backfill)', matchId, bodyResult.status)
        continue
      }
      const remake = isRemakeMatch(bodyResult.body)
      const duoParticipated = alreadyInDuoMatches.has(matchId) || await attributeDuoMatch(bodyResult.body, matchId, remake)

      if (duoParticipated && previouslyIgnored.has(matchId)) {
        const clientDetail = parseMatchDetail(bodyResult.body, clientPuuid, matchId)
        if (clientDetail.ok) {
          const clientFinalResult = await resolveClientResult(bodyResult.body, remake, clientDetail.detail.result)
          const { data: recordResult, error: recordErr } = await serviceClient.rpc('record_order_match', {
            p_order_id: orderId,
            p_external_match_id: clientDetail.detail.externalMatchId,
            p_result: clientFinalResult,
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
            p_duo_participated: true,
          })
          const result = recordResult as { success?: boolean; inserted?: boolean; error?: string; booster_id?: string } | null
          if (recordErr || !result?.success) {
            console.error('record_order_match failed (duo backfill)', matchId, result?.error ?? recordErr?.message)
          } else {
            if (result.inserted) {
              recorded.push({
                external_match_id: clientDetail.detail.externalMatchId,
                result: clientFinalResult,
                champion: clientDetail.detail.champion,
              })
              if (clientFinalResult !== 'remake' && result.booster_id) recordedBoosterIds.add(result.booster_id)
            }
            const { error: unignoreErr } = await serviceClient
              .from('order_ignored_matches')
              .delete()
              .eq('order_id', orderId)
              .eq('external_match_id', clientDetail.detail.externalMatchId)
            if (unignoreErr) console.error('order_ignored_matches cleanup failed (duo backfill)', matchId, unignoreErr.message)
          }
        }
      }
    }
  }

  // Reverifica o PDL/LP atual via League-V4 e atualiza orders.current_rank/
  // duo_current_rank -- desacoplado da classificação de partidas acima de
  // propósito. Roda por último, sempre com o valor mais atual possível.
  // Best-effort: nunca aborta o sync por causa disso.
  if (isRankTracked && leagueQueue) {
    const finalClientRank = await fetchRankOrdinal(clientPuuid, RIOT_API_KEY, PLATFORM_ROUTE, leagueQueue)
    if (finalClientRank.ok) await persistClientRank(finalClientRank.ordinal)
    else if (finalClientRank.reason === 'upstream_error') console.error('Riot league-v4 error (rank sync)', finalClientRank.status)

    if (duoPuuid) {
      const finalDuoRank = await fetchRankOrdinal(duoPuuid, RIOT_API_KEY, PLATFORM_ROUTE, leagueQueue)
      if (finalDuoRank.ok) await persistDuoRank(finalDuoRank.ordinal)
      else if (finalDuoRank.reason === 'upstream_error') console.error('Riot league-v4 error (duo rank sync)', finalDuoRank.status)
    }
  }

  const { error: markSyncError } = await serviceClient.rpc('mark_order_match_sync', { p_order_id: orderId })
  if (markSyncError) console.error('mark_order_match_sync failed', orderId, markSyncError.message)

  // Um recálculo por booster que de fato recebeu alguma partida nesta
  // chamada, não por order.assigned_booster_id -- depois de um reassign, um
  // sync atrasado pode gravar partidas pro booster ANTIGO.
  await Promise.all([...recordedBoosterIds].map(async (boosterId) => {
    const { error: refreshError } = await serviceClient.rpc('refresh_booster_performance_segments', { p_booster_id: boosterId })
    if (refreshError) console.error('refresh_booster_performance_segments failed', boosterId, refreshError.message)
  }))

  return {
    status: 200,
    body: { synced: true, new_matches: recorded.length, matches: recorded },
  }
}
