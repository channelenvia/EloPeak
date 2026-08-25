import { useEffect, useId, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import {
  useDdragonVersion,
  useDdragonChampionIds,
  pickRandomChampion,
  championIconUrl,
  type DdragonChampion,
} from '@/lib/ddragon'

// Barreira de atenção/UX antes do aceite (booster já é autenticado e
// aprovado) -- sem chave de API própria, só o CDN público do Data Dragon
// (mesmo usado em toda a parte de campeões do produto). O ícone vem
// hachurado (SVG crosshatch + leve rotação/zoom) pra dificultar OCR/visão
// computacional; a validação exige o nome EXATO retornado pelo catálogo
// pt_BR (maiúsculas, apóstrofos, acentos -- sem normalizar nada), porque um
// booster que reconhece o campeão de vista sabe digitar certo, um bot que só
// tenta ler a imagem raramente acerta a grafia exata de primeira.
interface CaptchaChallengeProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CaptchaChallenge({ open, onOpenChange, onSuccess }: CaptchaChallengeProps) {
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (open) setNonce((n) => n + 1)
  }, [open])

  function handleSuccess() {
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Verificação de segurança"
      description="Digite o nome do campeão exatamente como aparece no jogo (maiúsculas, apóstrofos etc.) para confirmar o aceite."
      maxWidth="sm"
    >
      <ChampionCaptcha key={nonce} onSuccess={handleSuccess} />
    </Modal>
  )
}

function ChampionCaptcha({ onSuccess }: { onSuccess: () => void }) {
  const version = useDdragonVersion()
  const championIndex = useDdragonChampionIds(version)
  const [target, setTarget] = useState<DdragonChampion | undefined>(undefined)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  // Sorteia assim que o catálogo carrega; não depende de `target` no array
  // de deps de propósito -- só queremos rodar isso uma vez por abertura do
  // desafio (a troca de campeão em caso de erro é feita por reroll(), não
  // por este efeito reagindo à mudança de target).
  useEffect(() => {
    if (championIndex && !target) setTarget(pickRandomChampion(championIndex))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [championIndex])

  function reroll() {
    setTarget(pickRandomChampion(championIndex))
    setValue('')
  }

  function submit() {
    if (!target || !value.trim()) return
    if (value.trim() === target.name) {
      onSuccess()
    } else {
      setError(true)
      reroll()
    }
  }

  const iconUrl = target ? championIconUrl(target.id, version, championIndex) : null

  if (!iconUrl) {
    return (
      <div className="py-10 flex items-center justify-center">
        <span className="text-sm text-ink-secondary">Carregando desafio...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <HatchedChampionIcon key={iconUrl} src={iconUrl} />
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(false) }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        placeholder="Nome do campeão"
        className={cn('input-base w-full text-center font-semibold', error && 'border-danger')}
        maxLength={40}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      {error && <p className="text-xs text-danger text-center">Nome incorreto, tente novamente com outro campeão.</p>}
      <Button className="w-full" onClick={submit} disabled={!value.trim()}>Confirmar</Button>
    </div>
  )
}

function HatchedChampionIcon({ src }: { src: string }) {
  const patternId = useId()
  // O pai remonta este componente a cada troca de campeão (key={iconUrl}),
  // então deps vazias bastam -- rotação/zoom levemente diferentes a cada
  // tentativa, pra não virar um recorte sempre idêntico.
  const rotate = useMemo(() => Math.random() * 10 - 5, [])
  const scale = useMemo(() => 1.15 + Math.random() * 0.15, [])

  return (
    <div className="relative w-28 h-28 mx-auto rounded-xl overflow-hidden border border-border-subtle bg-bg-elevated select-none">
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ transform: `rotate(${rotate}deg) scale(${scale})`, filter: 'contrast(1.15) saturate(1.3)' }}
      />
      <svg className="absolute inset-0 w-full h-full pointer-events-none text-ink" aria-hidden="true">
        <defs>
          <pattern id={`${patternId}-a`} width="9" height="9" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="9" stroke="currentColor" strokeWidth="3" />
          </pattern>
          <pattern id={`${patternId}-b`} width="9" height="9" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="9" stroke="currentColor" strokeWidth="3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId}-a)`} opacity={0.35} />
        <rect width="100%" height="100%" fill={`url(#${patternId}-b)`} opacity={0.35} />
      </svg>
    </div>
  )
}
