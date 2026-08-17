import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { fetchWithTimeout, HttpError, readJsonBody } from '../_shared/http.ts'

const DISCORD_API = 'https://discord.com/api/v10'
const GUILD_ID = Deno.env.get('DISCORD_GUILD_ID') ?? ''
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''

const bodySchema = z.object({
  discord_access_token: z.string().min(1).max(4096),
}).strict()

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

function discordErrorCode(body: Record<string, unknown> | null) {
  const code = body?.code
  return typeof code === 'number' ? code : undefined
}

function discordErrorMessage(body: Record<string, unknown> | null) {
  const message = body?.message
  return typeof message === 'string' ? message : undefined
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)
    if (!GUILD_ID || !BOT_TOKEN) {
      return errorResponse(req, 'Server misconfigured', 500)
    }

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)

    const rateLimit = await consumeUserRateLimit('discord-join-server', auth.user.id, 3, 300)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req, 8 * 1024)

    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return jsonResponse(req, {
        success: false,
        code: 'DISCORD_TOKEN_MISSING',
        error: 'Body inválido',
        issues: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }, 400)
    }

    const { discord_access_token } = parsedBody.data

    // Resolve Discord user ID from the access token
    const meRes = await fetchWithTimeout(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${discord_access_token}` },
    })
    if (!meRes.ok) {
      const body = await safeJson(meRes)
      console.error('Discord /users/@me failed', {
        status: meRes.status,
        discord_code: discordErrorCode(body),
        discord_message: discordErrorMessage(body),
      })
      return errorResponse(
        req,
        meRes.status === 401 ? 'Discord token expired or invalid' : 'Invalid Discord token',
        meRes.status === 401 ? 401 : 400,
        meRes.status === 401 ? 'DISCORD_TOKEN_EXPIRED' : 'DISCORD_TOKEN_INVALID',
      )
    }
    const { id: discordUserId } = await meRes.json() as { id: string }

    // Compara contra TODAS as identidades Discord vinculadas (não só a
    // primeira via .find()) — um usuário que já tinha uma conta Discord
    // vinculada e logou de novo com outra (ou tem múltiplas identidades
    // linkadas) fazia .find() pegar a identidade errada e disparar um 403
    // de "mismatch" mesmo com um token válido e pertencente ao usuário.
    //
    // BUG real (causa raiz do mismatch acontecer sempre, pra qualquer
    // usuário): identity.identity_id é o uuid interno da tabela
    // auth.identities (mesmo formato de identity.id), nunca o snowflake do
    // Discord -- o snowflake de verdade vive dentro de identity_data
    // (colunas provider_id/sub), confirmado direto na tabela auth.identities
    // do banco. Comparar identity_id contra o id retornado por
    // discord.com/users/@me nunca bate, pra ninguém -- por isso o join no
    // servidor do Discord nunca funcionava.
    const discordIdentities = auth.user.identities?.filter((identity) => identity.provider === 'discord') ?? []
    const identityDiscordId = (identity: typeof discordIdentities[number]) =>
      String(identity.identity_data?.provider_id ?? identity.identity_data?.sub ?? '')
    const matchesLinkedIdentity = discordIdentities.some((identity) => identityDiscordId(identity) === discordUserId)
    const matchesMetadataFallback = discordIdentities.length === 0 && (
      String(auth.user.user_metadata?.provider_id ?? '') === discordUserId
      || String(auth.user.user_metadata?.sub ?? '') === discordUserId
    )
    if (!matchesLinkedIdentity && !matchesMetadataFallback) {
      // IDs do Discord (snowflakes) não são segredo — inclusos na resposta só
      // pra diagnosticar esse mismatch sem precisar puxar os logs da function.
      console.error('Discord identity mismatch', {
        token_discord_id: discordUserId,
        linked_identity_ids: discordIdentities.map(identityDiscordId),
        metadata_provider_id: auth.user.user_metadata?.provider_id,
        metadata_sub: auth.user.user_metadata?.sub,
      })
      return errorResponse(req, 'Discord identity mismatch', 403, 'DISCORD_IDENTITY_MISMATCH', {
        token_discord_id: discordUserId,
        linked_identity_ids: discordIdentities.map(identityDiscordId),
      })
    }

    // Add user to the guild (bot must already be in the server)
    const joinRes = await fetchWithTimeout(`${DISCORD_API}/guilds/${GUILD_ID}/members/${discordUserId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: discord_access_token }),
    })

    // 201 = joined, 204 = already a member — both are success
    if (joinRes.status === 201) return jsonResponse(req, { success: true, joined: true })
    if (joinRes.status === 204) return jsonResponse(req, { success: true, joined: true, already_member: true, code: 'DISCORD_ALREADY_MEMBER' })

    if (!joinRes.ok) {
      const body = await safeJson(joinRes)
      const retryAfter = Number(joinRes.headers.get('Retry-After') ?? body?.retry_after ?? 0)
      console.error('Discord join failed', {
        status: joinRes.status,
        discord_code: discordErrorCode(body),
        discord_message: discordErrorMessage(body),
        retry_after: Number.isFinite(retryAfter) ? retryAfter : undefined,
      })

      if (joinRes.status === 429) {
        const response = rateLimitResponse(req, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5)
        response.headers.set('X-Discord-Error-Code', 'DISCORD_RATE_LIMITED')
        return response
      }

      const code = discordErrorCode(body)
      if (joinRes.status === 404 || code === 10004) {
        return errorResponse(req, 'Discord guild invalid', 502, 'DISCORD_GUILD_INVALID')
      }
      if (joinRes.status === 403) {
        const message = (discordErrorMessage(body) ?? '').toLowerCase()
        const internalCode = message.includes('missing access') || code === 50001
          ? 'DISCORD_SCOPE_MISSING'
          : code === 50013
            ? 'DISCORD_BOT_NOT_IN_GUILD'
            : 'DISCORD_JOIN_FORBIDDEN'
        return errorResponse(req, 'Discord refused to add user to guild', 403, internalCode)
      }

      return errorResponse(req, 'Unable to join Discord server', 502, 'DISCORD_JOIN_FAILED')
    }

    return jsonResponse(req, { success: true, joined: true })
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    console.error('discord-join-server error')
    return errorResponse(req, 'Internal server error', 500)
  }
})
