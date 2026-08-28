import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { CHANNEL_JOBS, fetchOrderProfiles, buildPublicJobEmbed, sendChannelMessage } from '../_shared/discordJobAnnounce.ts'

// Secret dedicado só pra esse endpoint ser chamável pelo cron interno
// (Supabase Cron Job -> Edge Function), nunca por qualquer request externa --
// mesmo padrão x-webhook-secret de discord-top3-announcement, com um secret
// PRÓPRIO em vez de reaproveitar o deles (auth surfaces separadas por
// integração -- ver comentário lá).
const CRON_SECRET = Deno.env.get('DISCORD_EXCLUSIVE_JOB_CRON_SECRET') ?? ''

// Um batch nunca deveria ter mais que um punhado de pedidos (pedidos
// exclusivos com booster preferido não são o caminho comum), mas um teto
// evita que uma corrida de muitos vencimentos ao mesmo tempo prenda a
// invocação por tempo demais -- os que sobrarem pegam a próxima rodada do
// cron, sem problema (exclusive_expired_announced_at continua null até lá).
const BATCH_LIMIT = 25

// Pedido "acabou de perder a exclusividade": ainda reservado a um booster
// específico (preferred_booster_id), ainda na pool (status +
// assigned_booster_id null -- ninguém aceitou), a janela já passou
// (exclusive_until <= now()) e ainda não foi anunciado publicamente. Mesma
// condição de exclusive_until <= now() que available_boost_orders (migration
// 128) já usa pra liberar o pedido pra todos os boosters -- este endpoint só
// cobre o aviso no Discord que falta pra essa transição, o acesso em si já
// funciona sozinho via a view.
async function findExpiredExclusiveOrders(db: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await db
    .from('orders')
    .select('id')
    .eq('status', 'awaiting_assignment')
    .is('assigned_booster_id', null)
    .not('preferred_booster_id', 'is', null)
    .not('exclusive_until', 'is', null)
    .lte('exclusive_until', new Date().toISOString())
    .is('exclusive_expired_announced_at', null)
    .order('exclusive_until', { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) throw new Error(`Failed to load expired exclusive orders: ${error.message}`)
  return (data ?? []).map((row) => row.id as string)
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!CRON_SECRET || !CHANNEL_JOBS) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Defesa em profundidade contra vazamento do secret (mesmo padrão de
  // discord-init-channels) -- não é a defesa principal, só limita o dano.
  const rateLimit = await consumeUserRateLimit('announce-expired-exclusive-jobs', 'cron', 2, 300)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  const db = supabaseAdmin()
  let announced = 0
  const failures: string[] = []

  try {
    const orderIds = await findExpiredExclusiveOrders(db)

    // Sequencial, não Promise.all -- cada item faz uma chamada real à API do
    // Discord (rate limit por bot), e um lote de exclusividades vencendo ao
    // mesmo tempo é raro o bastante pra não precisar de paralelismo aqui.
    for (const orderId of orderIds) {
      try {
        const { order } = await fetchOrderProfiles(orderId)
        // Reconfere contra o banco antes de postar -- o lote foi montado no
        // início da invocação, um admin pode ter cancelado/atribuído o
        // pedido manualmente nesse meio-tempo.
        if (order.status !== 'awaiting_assignment' || order.assigned_booster_id) continue

        await sendChannelMessage(CHANNEL_JOBS, buildPublicJobEmbed(order))

        const { error: markError } = await db
          .from('orders')
          .update({ exclusive_expired_announced_at: new Date().toISOString() })
          .eq('id', orderId)
        if (markError) throw new Error(markError.message)

        announced += 1
      } catch (err) {
        // Um pedido falhando (Discord fora do ar, order sumiu etc.) não pode
        // travar o resto do lote -- exclusive_expired_announced_at continua
        // null pra esse, a próxima rodada do cron tenta de novo.
        console.error('announce-expired-exclusive-jobs: failed for order', orderId, err)
        failures.push(orderId)
      }
    }

    return jsonResponse(req, { ok: true, announced, checked: orderIds.length, failures })
  } catch (err) {
    console.error('announce-expired-exclusive-jobs error:', err)
    return jsonResponse(req, { error: 'announce_expired_exclusive_jobs_error' }, 500)
  }
})
