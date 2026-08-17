import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, LogoMark } from '@/components/ui'
import { PageLoader } from '@/components/ui/Spinner'
import { supabase } from '@/lib/supabase'
import { checkRateLimit, limits } from '@/lib/rateLimit'
import { LEGAL_VERSION, hasAcceptedLegal } from '@/lib/legal'
import { useAuthStore } from '@/stores/authStore'
import { useBoosterStatus } from '@/api/boosters'

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z"/>
    </svg>
  )
}

// Único caminho pra entrar no app: vincular Discord → (se já aceitou os
// termos antes) ou aceitar os termos agora → ir pro painel. Tudo na mesma
// tela, nunca em telas separadas de login/criar conta/aceite — cada etapa
// só libera quando a anterior está de fato concluída (checado a partir do
// profile real vindo do banco, nunca de um estado só do cliente).
export function LoginPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthenticated, profile, isLoading, isInitialized } = useAuthStore()
  const { data: boosterAccessState } = useBoosterStatus(profile?.id)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)

  const authenticated = isAuthenticated()
  const alreadyAccepted = !!profile && hasAcceptedLegal(profile)

  // Supabase redirects back here with ?error=...&error_description=... when
  // o provedor (Discord) recusa o login (usuário negou permissão, app
  // removido, etc.) — sem isso a tela ficava muda, parecendo que nada
  // aconteceu, e o usuário tentava de novo sem saber o motivo real.
  // URLSearchParams#get() já devolve o valor decodificado — decodificar de
  // novo aqui quebraria (URIError) se a mensagem do provedor contiver um
  // '%' literal, travando a tela que este efeito existe pra proteger.
  useEffect(() => {
    const providerError = searchParams.get('error_description') || searchParams.get('error')
    if (providerError) setError(providerError)
  }, [searchParams])

  // Perfil que já aceitou os termos antes (usuário recorrente) — marca as
  // caixinhas sozinho, refletindo o que já está gravado no banco. Um perfil
  // novo (terms_accepted_at/privacy_accepted_at nulos) começa desmarcado e
  // exige que o próprio usuário marque as duas.
  useEffect(() => {
    if (alreadyAccepted) {
      setTermsAccepted(true)
      setPrivacyAccepted(true)
    }
  }, [alreadyAccepted])

  function targetPath() {
    const raw = searchParams.get('redirect')
    if (raw) {
      try {
        const decoded = decodeURIComponent(raw)
        if (/^\/(?![/\\])/.test(decoded) && decoded !== '/login') return decoded
      } catch { /* ignore malformed redirect */ }
    }
    if (profile?.role === 'admin') return '/admin'
    if (profile?.role === 'booster') return '/booster'
    // Candidatura de booster ainda em análise (ou recusada/suspensa/
    // expulsa) -- role continua/volta pra 'customer' nesses casos (só vira
    // 'booster' quando approve_booster() aprova), então sem isso o booster
    // caía direto no dashboard de cliente, sem nenhuma indicação de status.
    const status = boosterAccessState?.state
    if (status === 'pending' || status === 'rejected' || status === 'suspended' || status === 'removed') {
      return '/apply?booster=1'
    }
    return '/dashboard'
  }

  async function handleDiscordLogin() {
    if (!checkRateLimit('discord-login', limits.auth)) {
      setError('Muitas tentativas de login. Aguarde 1 minuto.')
      return
    }
    setConnecting(true)
    setError(null)

    // redirectTo sempre volta pra /login (nunca direto pro destino final) —
    // é aqui que o restante do fluxo (marcar/aceitar termos) acontece, com o
    // ?redirect= original preservado (re-codificado) pra usar depois de aceitar.
    const redirectParam = searchParams.get('redirect')
    const redirectTo = `${window.location.origin}/login${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { scopes: 'identify email guilds.join', redirectTo },
    })
    if (oauthError) {
      setError(oauthError.message)
      setConnecting(false)
    }
  }

  async function handleContinue() {
    if (!profile) return

    if (alreadyAccepted) {
      navigate(targetPath(), { replace: true })
      return
    }

    if (!termsAccepted || !privacyAccepted) return

    setAccepting(true)
    setError(null)

    const acceptedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        terms_accepted_at: acceptedAt,
        privacy_accepted_at: acceptedAt,
        legal_version: LEGAL_VERSION,
      })
      .eq('id', profile.id)

    if (updateError) {
      setError('Não foi possível registrar o aceite. Tente novamente.')
      setAccepting(false)
      return
    }

    useAuthStore.getState().setProfile({
      ...profile,
      terms_accepted_at: acceptedAt,
      privacy_accepted_at: acceptedAt,
      legal_version: LEGAL_VERSION,
    })
    navigate(targetPath(), { replace: true })
  }

  // Sessão ainda resolvendo, ou autenticado mas o profile real (fonte da
  // verdade sobre o aceite) ainda não chegou — nunca decide os estados dos
  // controles abaixo a partir de um profile incompleto/desatualizado.
  if (!isInitialized || isLoading || (authenticated && !profile)) {
    return <PageLoader />
  }

  const canContinue = authenticated && !!profile && (alreadyAccepted || (termsAccepted && privacyAccepted))

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
      <div className="w-full max-w-sm relative">
        <div className="flex items-center mb-8">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark className="h-9 w-9" />
            <span className="text-xl font-bold text-ink">
              Elo<span className="text-brand">Peak</span>
            </span>
          </Link>
        </div>

        <div className="card p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-ink">
              {!authenticated ? 'Entrar' : alreadyAccepted ? 'Bem-vindo de volta' : 'Antes de continuar'}
            </h1>
            <p className="text-sm text-ink-secondary mt-1">
              {!authenticated
                ? 'Vincule sua conta do Discord para entrar ou criar sua conta.'
                : alreadyAccepted
                  ? 'Sua conta já está pronta — é só continuar.'
                  : 'Leia e aceite os documentos abaixo para liberar o painel.'}
            </p>
          </div>

          {/* 1. Vincular Discord */}
          <button
            type="button"
            onClick={handleDiscordLogin}
            disabled={authenticated || connecting}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: authenticated ? undefined : '#5865F2' }}
          >
            {authenticated ? (
              <span className="w-full flex items-center justify-center gap-2 text-success">
                <Check className="h-5 w-5" /> Discord vinculado
              </span>
            ) : (
              <>
                <DiscordIcon className="h-5 w-5" />
                {connecting ? 'Conectando...' : 'Vincular Discord'}
              </>
            )}
          </button>

          {/* 2. Termos — bloqueados até vincular o Discord */}
          <div className="space-y-3">
            <label
              className={`flex items-start gap-3 rounded-xl border border-border-subtle bg-bg-card/70 backdrop-blur-sm p-3 text-sm text-ink-secondary ${!authenticated ? 'opacity-50' : ''}`}
            >
              <input
                type="checkbox"
                checked={termsAccepted}
                disabled={!authenticated || alreadyAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 accent-brand"
              />
              <span>
                Li e concordo com os{' '}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                  Termos de Uso
                </Link>.
              </span>
            </label>

            <label
              className={`flex items-start gap-3 rounded-xl border border-border-subtle bg-bg-card/70 backdrop-blur-sm p-3 text-sm text-ink-secondary ${!authenticated ? 'opacity-50' : ''}`}
            >
              <input
                type="checkbox"
                checked={privacyAccepted}
                disabled={!authenticated || alreadyAccepted}
                onChange={(event) => setPrivacyAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 accent-brand"
              />
              <span>
                Li e concordo com a{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                  Política de Privacidade
                </Link>.
              </span>
            </label>
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* 3. Dashboard — só libera com Discord vinculado e termos aceitos */}
          <Button className="w-full" disabled={!canContinue} loading={accepting} onClick={handleContinue}>
            Ir para o Dashboard
          </Button>

          <p className="text-xs text-ink-muted text-center">
            Consulte os nossos{' '}
            <Link to="/terms" className="text-brand hover:underline">Termos de Uso</Link>
            {' '}e a{' '}
            <Link to="/privacy" className="text-brand hover:underline">Política de Privacidade</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
