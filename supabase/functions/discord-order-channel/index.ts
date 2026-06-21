import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD_API     = 'https://discord.com/api/v10'
const BOT_TOKEN       = Deno.env.get('DISCORD_BOT_TOKEN')       ?? ''
const GUILD_ID        = Deno.env.get('DISCORD_GUILD_ID')        ?? ''
const ADMIN_ROLE_ID   = Deno.env.get('DISCORD_ADMIN_ROLE_ID')   ?? ''
const CATEGORY_ID     = Deno.env.get('DISCORD_CATEGORY_BOOSTS') ?? ''
const WEBHOOK_SECRET  = Deno.env.get('DISCORD_WEBHOOK_SECRET')  ?? ''

// Bit flags: VIEW_CHANNEL (1024) + CONNECT (1048576) + SPEAK (2097152)
const VOICE_ALLOW    = String(1024 + 1048576 + 2097152)
const DENY_EVERYONE  = String(1024) // deny VIEW_CHANNEL for @everyone

const TERMINAL = ['completed', 'canceled', 'refunded', 'disputed', 'drop_requested']

function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')              ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
}

async function fetchOrderProfiles(orderId: string) {
  const db = supabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, customer_id, assigned_booster_id, service_id, discord_voice_channel_id')
    .eq('id', orderId)
    .single()

  if (error || !order) throw new Error('Order not found')

  const ids = [order.customer_id, order.assigned_booster_id].filter(Boolean)
  const { data: profiles } = await db
    .from('profiles')
    .select('id, username, discord_id')
    .in('id', ids)

  return {
    order,
    customer: profiles?.find(p => p.id === order.customer_id) ?? null,
    booster:  profiles?.find(p => p.id === order.assigned_booster_id) ?? null,
  }
}

async function createVoiceChannel(orderId: string, customerDiscordId: string | null, boosterDiscordId: string | null) {
  const shortId = orderId.slice(0, 8)

  const overwrites: object[] = [
    { id: GUILD_ID, type: 0, deny: DENY_EVERYONE }, // block @everyone
  ]

  if (customerDiscordId) overwrites.push({ id: customerDiscordId, type: 1, allow: VOICE_ALLOW })
  if (boosterDiscordId)  overwrites.push({ id: boosterDiscordId,  type: 1, allow: VOICE_ALLOW })
  if (ADMIN_ROLE_ID)     overwrites.push({ id: ADMIN_ROLE_ID,     type: 0, allow: VOICE_ALLOW })

  const body: Record<string, unknown> = {
    name: `boost-${shortId}`,
    type: 2, // voice channel
    permission_overwrites: overwrites,
  }
  if (CATEGORY_ID) body.parent_id = CATEGORY_ID

  const res = await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Discord create channel ${res.status}: ${await res.text()}`)
  const channel = await res.json() as { id: string }
  return channel.id
}

async function deleteVoiceChannel(channelId: string) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  })
  // 404 = already deleted, that's fine
  if (!res.ok && res.status !== 404) {
    throw new Error(`Discord delete channel ${res.status}: ${await res.text()}`)
  }
}

async function saveChannelId(orderId: string, channelId: string | null) {
  await supabaseAdmin()
    .from('orders')
    .update({ discord_voice_channel_id: channelId })
    .eq('id', orderId)
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await req.json()

  // Supabase Database Webhooks wrap the row in { type, table, record, old_record }
  const record    = payload.record    ?? payload
  const oldRecord = payload.old_record ?? {}

  const orderId:           string        = record.id
  const newStatus:         string        = record.status
  const oldStatus:         string        = oldRecord.status ?? ''
  const existingChannelId: string | null = record.discord_voice_channel_id ?? null

  try {
    // ── Create channel when order goes in_progress ───────────────────────────
    if (newStatus === 'in_progress' && oldStatus !== 'in_progress' && !existingChannelId) {
      const { order, customer, booster } = await fetchOrderProfiles(orderId)

      if (!customer?.discord_id && !booster?.discord_id) {
        return new Response(
          JSON.stringify({ ok: false, reason: 'no discord_ids found for customer or booster' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      const channelId = await createVoiceChannel(
        order.id,
        customer?.discord_id ?? null,
        booster?.discord_id  ?? null,
      )
      await saveChannelId(orderId, channelId)

      return new Response(JSON.stringify({ ok: true, action: 'created', channelId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Delete channel when order is terminated ──────────────────────────────
    if (TERMINAL.includes(newStatus) && existingChannelId) {
      await deleteVoiceChannel(existingChannelId)
      await saveChannelId(orderId, null)

      return new Response(JSON.stringify({ ok: true, action: 'deleted' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, action: 'skipped' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
