const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]

// Origin de produção conhecida — usada só como fallback de último recurso
// quando NENHUMA origem foi configurada via env (ALLOWED_ORIGINS/APP_URL),
// pra function não ficar sem CORS nenhum se o secret ainda não foi setado.
// Assim que qualquer origem explícita é configurada, esse fallback para de
// ser confiado incondicionalmente.
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

  // Mesmo padrão de dev-bypass do mercadopago-webhook: origens de
  // localhost só entram fora de produção, nunca hardcoded incondicional.
  const devOrigins = Deno.env.get('DENO_ENV') === 'development' ? DEFAULT_DEV_ORIGINS : []

  const hasExplicitConfig = explicit.length > 0 || !!appUrl
  const prodFallback = hasExplicitConfig ? [] : DEFAULT_PROD_ORIGINS

  return [...explicit, appUrl, vercelUrl, ...prodFallback, ...devOrigins]
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
