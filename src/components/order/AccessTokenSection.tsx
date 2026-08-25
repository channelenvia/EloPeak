import { useEffect, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { Button, ErrorAlert } from '@/components/ui'
import { useRevealOrderCredentials } from '@/api/orders'
import type { Order } from '@/types'

export function AccessTokenSection({ order }: { order: Order }) {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [tokenSecondsLeft, setTokenSecondsLeft] = useState(0)
  const [tokenCopied, setTokenCopied] = useState(false)
  const revealAccessToken = useRevealOrderCredentials()

  function doRevealToken() {
    revealAccessToken.mutate(order.id, {
      onSuccess: (result) => {
        setAccessToken(result.access_token ?? null)
        setTokenExpiresAt(result.expires_at ?? null)
      },
    })
  }

  useEffect(() => {
    if (!tokenExpiresAt) { setTokenSecondsLeft(0); return }
    function tick() {
      const secondsLeft = Math.max(0, Math.round((new Date(tokenExpiresAt!).getTime() - Date.now()) / 1000))
      setTokenSecondsLeft(secondsLeft)
      if (secondsLeft <= 0) { setAccessToken(null); setTokenExpiresAt(null) }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [tokenExpiresAt])

  async function copyAccessToken() {
    if (!accessToken) return
    await navigator.clipboard.writeText(accessToken)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 1500)
  }

  return (
    <div>
      <p className="text-xs text-ink-secondary mb-3">
        Uso único, válido por 5 minutos. Login e senha não são exibidos.
      </p>

      {!order.credentials_set ? (
        <div className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
          O cliente ainda não cadastrou as credenciais de acesso.
        </div>
      ) : accessToken ? (
        <div className="space-y-2">
          <textarea readOnly value={accessToken} className="input-base w-full min-h-[96px] text-[11px] font-mono resize-none" spellCheck={false} />
          <p className="text-[11px] text-ink-muted text-center">
            Expira em {Math.floor(tokenSecondsLeft / 60)}:{String(tokenSecondsLeft % 60).padStart(2, '0')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="w-full" variant="ghost" leftIcon={<KeyRound className="h-3.5 w-3.5" />} loading={revealAccessToken.isPending} onClick={doRevealToken}>
              Gerar outro token
            </Button>
            <Button size="sm" className="w-full" variant={tokenCopied ? 'success' : 'secondary'} leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyAccessToken()}>
              {tokenCopied ? 'Copiado' : 'Copiar token'}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="w-full" leftIcon={<KeyRound className="h-3.5 w-3.5" />} loading={revealAccessToken.isPending} onClick={doRevealToken}>
          Criar token
        </Button>
      )}

      {revealAccessToken.isError && (
        <ErrorAlert message={revealAccessToken.error instanceof Error ? revealAccessToken.error.message : 'Erro ao buscar token'} className="mt-2" />
      )}
    </div>
  )
}
