import { useEffect, useRef, useState } from 'react'

interface PdlFieldProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled?: boolean
}

// Campo cheio (sem spinner +/-), com "PDL" como unidade visual fixa —
// nunca parte do valor numérico digitado. Não converte vazio em zero
// silenciosamente: enquanto o campo está vazio ou inválido, mostra um erro
// e NÃO chama onChange — o valor anterior válido permanece no estado.
function PdlField({ label, value, min, max, onChange, disabled }: PdlFieldProps) {
  const [raw, setRaw] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  // Rastreia o último valor que este campo mesmo enviou via onChange, para
  // distinguir "o valor mudou porque o usuário está digitando" de "o valor
  // mudou por fora" (nova busca na Riot, troca LP/PDL na fronteira Master+).
  const lastCommittedRef = useRef(value)

  useEffect(() => {
    // Um campo desabilitado nunca está sendo editado pelo usuário, então é
    // sempre seguro ressincronizar. Se habilitado, só ressincroniza quando o
    // valor externo não bate com o último valor que este campo commitou —
    // ou seja, a mudança veio de fora, não do próprio commit() do campo.
    if (disabled || value !== lastCommittedRef.current) {
      setRaw(String(value))
      setError(null)
      lastCommittedRef.current = value
    }
  }, [value, disabled])

  function commit(next: string) {
    setRaw(next)
    if (next.trim() === '') {
      setError('Informe um valor.')
      return
    }
    const parsed = Number(next)
    if (!Number.isFinite(parsed) || !/^\d+$/.test(next.trim())) {
      setError('Apenas números inteiros.')
      return
    }
    if (parsed < min) {
      setError(`Mínimo ${min}.`)
      return
    }
    if (parsed > max) {
      setError(`Máximo ${max}.`)
      return
    }
    setError(null)
    lastCommittedRef.current = parsed
    onChange(parsed)
  }

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <p className="text-[10px] font-semibold text-ink-secondary">{label}</p>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={raw}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => { if (raw.trim() === '') commit(String(value)) }}
          className="input-base w-full pr-12 disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-muted pointer-events-none">
          PDL
        </span>
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  )
}

export function PdlFieldRow({ fields }: { fields: PdlFieldProps[] }) {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      {fields.map((f) => <PdlField key={f.label} {...f} />)}
    </div>
  )
}
