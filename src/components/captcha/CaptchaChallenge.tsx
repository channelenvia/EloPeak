import { useCallback, useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { issueAcceptChallenge, verifyAcceptChallenge, type AcceptChallenge } from '@/api/orders'

// Verificacao de seguranca do aceite (RN-12): o campeao e sorteado e validado NO SERVIDOR. O navegador so ve a
// imagem mascarada (endpoint com id opaco) e envia o texto digitado; a resposta correta nunca chega aqui.
// A comparacao ignora maiusculas, acentos e apostrofos (Kai'Sa == kaisa).
interface CaptchaChallengeProps {
  open: boolean
  orderId: string | null
  onOpenChange: (open: boolean) => void
  onSuccess: (challengeId: string) => void
}

export function CaptchaChallenge({ open, orderId, onOpenChange, onSuccess }: CaptchaChallengeProps) {
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (open) setNonce((n) => n + 1)
  }, [open])

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Verificação de segurança"
      description="Digite o nome do campeão da imagem (maiúsculas, acentos e apóstrofos não importam) para confirmar o aceite."
      maxWidth="sm"
    >
      {orderId && (
        <ChampionCaptcha
          key={`${orderId}-${nonce}`}
          orderId={orderId}
          onSuccess={(challengeId) => { onOpenChange(false); onSuccess(challengeId) }}
        />
      )}
    </Modal>
  )
}

function ChampionCaptcha({ orderId, onSuccess }: { orderId: string; onSuccess: (challengeId: string) => void }) {
  const [challenge, setChallenge] = useState<AcceptChallenge | null>(null)
  const [value, setValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setChallenge(null)
    setValue('')
    setLoadError(null)
    try {
      setChallenge(await issueAcceptChallenge(orderId))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o desafio.')
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!challenge || !value.trim() || busy) return
    setBusy(true)
    try {
      const result = await verifyAcceptChallenge(challenge.challenge_id, value)
      if (result.success) {
        onSuccess(challenge.challenge_id)
        return
      }
      if (result.error === 'wrong_answer' && (result.attempts_left ?? 0) > 0) {
        setMessage(`Nome incorreto. Você ainda tem ${result.attempts_left} tentativa(s) nesta imagem.`)
        setValue('')
      } else {
        setMessage('Nome incorreto. Aqui vai uma nova imagem.')
        await load()
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível verificar agora.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-sm text-danger">{loadError}</p>
        <Button variant="secondary" onClick={() => void load()}>Tentar de novo</Button>
      </div>
    )
  }

  if (!challenge) {
    return (
      <div className="py-10 flex items-center justify-center">
        <span className="text-sm text-ink-secondary">Carregando desafio…</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="w-40 h-40 mx-auto rounded-xl overflow-hidden border border-border-subtle bg-bg-raised select-none">
        <img src={challenge.image_url} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
      </div>
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setMessage(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        placeholder="Nome do campeão"
        className={cn('input-base w-full text-center font-semibold', message && 'border-danger')}
        maxLength={40}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      {message && <p className="text-xs text-danger text-center">{message}</p>}
      <Button className="w-full" onClick={() => void submit()} disabled={!value.trim() || busy} loading={busy}>Confirmar</Button>
    </div>
  )
}
