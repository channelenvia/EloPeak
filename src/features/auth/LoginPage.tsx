import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { ThemeToggle } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useState } from 'react'

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z"/>
    </svg>
  )
}

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleDiscordLogin() {
    setLoading(true)
    setError(null)

    // Validate ?redirect= — must be a same-origin path to prevent open redirect / token leak
    const raw = searchParams.get('redirect')
    let path = '/'
    if (raw) {
      try {
        const decoded = decodeURIComponent(raw)
        if (/^\/(?![/\\])/.test(decoded)) path = decoded
      } catch { /* ignore malformed */ }
    }
    const redirectTo = `${window.location.origin}${path}`

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        scopes: 'identify email guilds.join',
        redirectTo,
      },
    })
    if (oauthError) {
      setError(oauthError.message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-brand flex items-center justify-center shadow-brand">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-ink">
              Elo<span className="text-brand">Peak</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>

        <div className="card p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-ink">{t('auth.login.title')}</h1>
            <p className="text-sm text-ink-secondary mt-1">
              Acesse sua conta com o Discord para continuar.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDiscordLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: '#5865F2' }}
          >
            <DiscordIcon className="h-5 w-5" />
            {loading ? 'Conectando...' : 'Entrar com Discord'}
          </button>

          {error && (
            <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <p className="text-xs text-ink-muted text-center">
            Ao entrar, você concorda com os nossos{' '}
            <Link to="/terms" className="text-brand hover:underline">Termos de Uso</Link>
            {' '}e{' '}
            <Link to="/privacy" className="text-brand hover:underline">Política de Privacidade</Link>.
          </p>
        </div>

      </div>
    </div>
  )
}
