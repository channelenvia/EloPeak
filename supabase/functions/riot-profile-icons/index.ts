import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { getProfileIcons } from '../_shared/ddragon.ts'
import { consumeUserRateLimit, getClientIp } from '../_shared/rateLimit.ts'

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'GET') return errorResponse(req, 'Method not allowed', 405)

    // Endpoint público (sem login) — limita por IP só pra não sobrar
    // invocação/custo à toa; o resultado em si já é cacheado 6h em memória
    // (ver _shared/ddragon.ts), então isso nunca vira consulta repetida à
    // Riot/CommunityDragon, só protege a function em si. Ver getClientIp em
    // _shared/rateLimit.ts pro racional de qual header é confiável.
    const clientIp = getClientIp(req)
    const rateLimit = await consumeUserRateLimit('riot-profile-icons', clientIp, 30, 60)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const { version, icons, stale } = await getProfileIcons()
    return jsonResponse(req, { version, icons, stale })
  } catch (err) {
    console.error('riot-profile-icons error', err instanceof Error ? err.message : 'unknown')
    return errorResponse(req, 'Não foi possível carregar os ícones de perfil agora.', 502)
  }
})
