import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD_API = 'https://discord.com/api/v10'
const GUILD_ID = Deno.env.get('DISCORD_GUILD_ID') ?? ''
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) throw new Error('Unauthorized')

    const { discord_access_token } = await req.json()
    if (!discord_access_token) throw new Error('Missing discord_access_token')

    // Resolve Discord user ID from the access token
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${discord_access_token}` },
    })
    if (!meRes.ok) throw new Error('Failed to fetch Discord user')
    const { id: discordUserId } = await meRes.json() as { id: string }

    // Add user to the guild (bot must already be in the server)
    const joinRes = await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/members/${discordUserId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: discord_access_token }),
    })

    // 201 = joined, 204 = already a member — both are success
    if (!joinRes.ok && joinRes.status !== 201 && joinRes.status !== 204) {
      const body = await joinRes.text()
      throw new Error(`Discord API error ${joinRes.status}: ${body}`)
    }

    return new Response(JSON.stringify({ joined: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
