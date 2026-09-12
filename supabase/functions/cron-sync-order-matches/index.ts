import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { syncOrderMatches, type OrderForMatchSync } from '../_shared/orderMatchSync.ts'

const WEBHOOK_SECRET = Deno.env.get('CRON_SYNC_ORDER_MATCHES_SECRET') ?? ''
const SYNC_INTERVAL_MS = 30 * 60 * 1000

// ponytail: teto de pedidos processados por tick -- prioriza os com sync
// mais velho (nullsFirst pega quem nunca sincronizou primeiro). Se algum dia
// houver mais de 200 pedidos ativos simultâneos sem sync recente, o excesso
// só entra no próximo tick (cron roda de 30 em 30 min, ver migration de
// agendamento) -- upgrade: paginar ou encurtar o intervalo do cron.
const MAX_ORDERS_PER_RUN = 200

// Varre TODO pedido em status sincronizável sem sync há mais de 30min (ou
// nunca sincronizado) e roda o mesmo core de sync-order-matches/index.ts pra
// cada um -- backstop server-side do polling client-side de 30min em
// JobDetail.tsx (AUTO_SYNC_INTERVAL_MS em src/lib/matchSync.ts), que só roda
// enquanto alguém tem a tela do pedido aberta. Sem isso, wins_played/
// losses_played podem ficar defasados por horas se ninguém abrir a tela --
// e são exatamente os contadores que apply_order_drop usa pra calcular
// penalidade de drop (ver migration 20260906240000).
serve(async (req) => {
  const auth = await verifyWebhookRequest(req, {
    scope: 'cron-sync-order-matches',
    webhookSecret: WEBHOOK_SECRET,
    limit: 2,
    windowSeconds: 300,
  })
  if (!auth.ok) return auth.response

  const db = supabaseAdmin()
  const cutoffIso = new Date(Date.now() - SYNC_INTERVAL_MS).toISOString()

  const { data: dueOrders, error } = await db
    .from('orders')
    .select('id, status, riot_id, boost_mode, queue_type, match_sync_started_at, wins_purchased, duo_own_riot_id, service_type, current_rank, duo_current_rank')
    .in('status', ['in_progress', 'paused', 'drop_requested'])
    .not('riot_id', 'is', null)
    .or(`last_match_synced_at.is.null,last_match_synced_at.lt.${cutoffIso}`)
    .order('last_match_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_ORDERS_PER_RUN)

  if (error) {
    console.error('cron-sync-order-matches: failed to load due orders', error.message)
    return jsonResponse(req, { error: 'failed_to_load_due_orders' }, 500)
  }

  let synced = 0
  let skipped = 0
  const failures: string[] = []
  let abortedByRiotRateLimit = false

  for (const order of (dueOrders ?? []) as OrderForMatchSync[]) {
    try {
      const outcome = await syncOrderMatches(order, db)
      if (outcome.status === 503) {
        // Riot rate-limitou -- todo próximo pedido desta leva ia falhar do
        // mesmo jeito. Para o run inteiro em vez de gastar o resto da fila
        // em chamadas fadadas a 503; o próximo tick (30min) retoma pelos
        // mais antigos de novo, ver order acima.
        console.error('cron-sync-order-matches: Riot rate limited, aborting run', order.id)
        abortedByRiotRateLimit = true
        break
      }
      if (outcome.status === 200) synced += 1
      else skipped += 1
    } catch (err) {
      console.error('cron-sync-order-matches: failed for order', order.id, err instanceof Error ? err.message : err)
      failures.push(order.id)
    }
  }

  return jsonResponse(req, {
    ok: true,
    checked: (dueOrders ?? []).length,
    synced,
    skipped,
    failed: failures.length,
    aborted_by_riot_rate_limit: abortedByRiotRateLimit,
  })
})
