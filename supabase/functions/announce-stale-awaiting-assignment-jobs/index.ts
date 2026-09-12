import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import {
  CHANNEL_JOBS, fetchOrderProfiles, buildPublicJobEmbed, buildExclusiveJobDM, sendChannelMessage, sendDirectMessage,
} from '../_shared/discordJobAnnounce.ts'

// Rede de segurança pro anúncio normal de discord-order-channel (Database
// Webhook fire-and-forget, sem retry próprio) -- mesmo padrão de
// announce-expired-exclusive-jobs, secret dedicado só pro cron interno.
const CRON_SECRET = Deno.env.get('DISCORD_AWAITING_ASSIGNMENT_CRON_SECRET') ?? ''

const BATCH_LIMIT = 25

// Janela de graça: dá tempo do caminho normal (webhook síncrono, poucos
// segundos) terminar antes de considerar um pedido "sem anúncio confirmado"
// -- evita competir com a tentativa em andamento na transição normal.
const GRACE_PERIOD_MS = 2 * 60 * 1000

// Pedido que entrou em awaiting_assignment (updated_at reflete a última
// transição de status, setado por toda RPC que muda o pedido) e ainda não
// teve o anúncio deste ciclo confirmado (awaiting_assignment_announced_at é
// zerado por discord-order-channel antes de cada tentativa -- ver migration
// 20260911010000).
async function findStaleAwaitingAssignmentOrders(db: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await db
    .from('orders')
    .select('id')
    .eq('status', 'awaiting_assignment')
    .is('awaiting_assignment_announced_at', null)
    .lte('updated_at', new Date(Date.now() - GRACE_PERIOD_MS).toISOString())
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) throw new Error(`Failed to load stale awaiting_assignment orders: ${error.message}`)
  return (data ?? []).map((row) => row.id as string)
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!CRON_SECRET) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await consumeUserRateLimit('announce-stale-awaiting-assignment-jobs', 'cron', 2, 300)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  const db = supabaseAdmin()
  let announced = 0
  const failures: string[] = []

  try {
    const orderIds = await findStaleAwaitingAssignmentOrders(db)

    // Sequencial, não Promise.all -- mesmo motivo de announce-expired-
    // exclusive-jobs: cada item chama a API do Discord de verdade, e vários
    // pedidos travados ao mesmo tempo é raro o bastante pra não precisar de
    // paralelismo aqui.
    for (const orderId of orderIds) {
      try {
        const { order, preferredBooster } = await fetchOrderProfiles(orderId)
        // Reconfere contra o banco -- o lote foi montado no início da
        // invocação, o pedido pode ter mudado de status ou já ter sido
        // anunciado com sucesso nesse meio-tempo.
        if (order.status !== 'awaiting_assignment' || order.awaiting_assignment_announced_at) continue

        if (order.preferred_booster_id) {
          if (preferredBooster?.discord_id) {
            await sendDirectMessage(preferredBooster.discord_id, buildExclusiveJobDM(order))
          }
        } else if (CHANNEL_JOBS) {
          await sendChannelMessage(CHANNEL_JOBS, buildPublicJobEmbed(order))
        }

        const { error: markError } = await db
          .from('orders')
          .update({ awaiting_assignment_announced_at: new Date().toISOString() })
          .eq('id', orderId)
        if (markError) throw new Error(markError.message)

        announced += 1
      } catch (err) {
        // Um pedido falhando não pode travar o resto do lote --
        // awaiting_assignment_announced_at continua null pra esse, a
        // próxima rodada do cron tenta de novo.
        console.error('announce-stale-awaiting-assignment-jobs: failed for order', orderId, err)
        failures.push(orderId)
      }
    }

    return jsonResponse(req, { ok: true, announced, checked: orderIds.length, failures })
  } catch (err) {
    console.error('announce-stale-awaiting-assignment-jobs error:', err)
    return jsonResponse(req, { error: 'announce_stale_awaiting_assignment_jobs_error' }, 500)
  }
})
