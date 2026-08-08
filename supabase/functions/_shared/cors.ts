const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]

// Origin de produção conhecida — mantida como fallback além de ALLOWED_ORIGINS/APP_URL
// para que a function funcione mesmo se o secret ainda não tiver sido configurado no Supabase.
const DEFAULT_PROD_ORIGINS = [
  'https://elo-peak.vercel.app',
]

function configuredOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? ''
  const explicit = raw.split(',').map((origin) => origin.trim()).filter(Boolean)

  const appUrl = Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? ''
  const vercelUrl = Deno.env.get('VERCEL_URL')
    ? `https://${Deno.env.get('VERCEL_URL')}`
    : ''

  return [...explicit, appUrl, vercelUrl, ...DEFAULT_PROD_ORIGINS, ...DEFAULT_DEV_ORIGINS]
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, ''))
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin')
  const allowed = configuredOrigins()
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }

  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}

export function handleCors(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response('ok', { headers: corsHeaders(req) })
}
