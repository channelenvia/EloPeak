import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getClientIp } from '../_shared/rateLimit.ts'
import { fetchChampionIcon, getChampionCatalog } from '../_shared/championCatalog.ts'
import { maskChampionImage } from '../_shared/captchaImage.ts'

// Serve a imagem mascarada do desafio. <img> nao envia Authorization, entao o endpoint e publico
// (verify_jwt = false), mas so atende ids de desafio abertos (nao resolvidos, nao expirados), que sao
// UUIDs aleatorios entregues apenas ao booster que os pediu. O nome do campeao nunca aparece na URL.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'GET') return errorResponse(req, 'Method not allowed', 405)
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!UUID.test(id)) return errorResponse(req, 'Not found', 404)

    const db = supabaseAdmin()
    const { data: limit } = await db.rpc('consume_edge_rate_limit', {
      p_scope: 'accept-challenge-image', p_subject: getClientIp(req), p_limit: 60, p_window_seconds: 60,
    })
    if ((limit as { allowed?: boolean } | null)?.allowed !== true) {
      return rateLimitResponse(req, Number((limit as { retry_after?: number } | null)?.retry_after ?? 60))
    }

    const { data, error } = await db.rpc('get_accept_challenge_image_data', { p_challenge_id: id })
    if (error) {
      console.error('get_accept_challenge_image_data error', error.message)
      return errorResponse(req, 'Internal server error', 500)
    }
    const row = data as { champion_id?: string; seed?: number } | null
    if (!row?.champion_id || typeof row.seed !== 'number') return errorResponse(req, 'Not found', 404)

    const catalog = await getChampionCatalog()
    const icon = await fetchChampionIcon(catalog.version, row.champion_id)
    const png = await maskChampionImage(icon, row.seed)
    return new Response(png.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-site' },
    })
  } catch (err) {
    console.error('accept-challenge-image error', err instanceof Error ? err.name : 'unknown')
    return errorResponse(req, 'Internal server error', 500)
  }
})
