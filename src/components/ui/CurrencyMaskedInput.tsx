import { useEffect, useRef, type ChangeEvent } from 'react'
import { cn } from '@/lib/utils'

interface CurrencyMaskedInputProps {
  /** Valor em centavos (inteiro) -- nunca ponto flutuante em reais, pra não acumular erro de arredondamento. */
  valueCents: number
  onChangeCents: (cents: number) => void
  maxCents?: number
  disabled?: boolean
  className?: string
  autoFocus?: boolean
  'aria-label'?: string
}

// Máscara de "caixa registradora": o campo sempre mostra 0,00 e o dígito
// digitado entra pela direita (centavos), empurrando o resto pra esquerda --
// nunca deixa o usuário digitar letra ou símbolo num campo de valor
// monetário, nem produz "R$ ,50" ou outro estado intermediário inválido.
export function CurrencyMaskedInput({
  valueCents, onChangeCents, maxCents, disabled, className, autoFocus, 'aria-label': ariaLabel,
}: CurrencyMaskedInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const display = (valueCents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const digitsOnly = event.target.value.replace(/\D/g, '')
    // Zeros à esquerda somem sozinhos ao virar inteiro -- "000" -> 0, "007" -> 7.
    let cents = digitsOnly === '' ? 0 : parseInt(digitsOnly, 10)
    if (maxCents != null) cents = Math.min(cents, maxCents)
    onChangeCents(cents)
  }

  // O cursor sempre no fim -- edição no meio do valor não faz sentido nesse
  // formato (o próximo dígito sempre entra nos centavos), então trava o
  // ponto de edição em vez de deixar o usuário "editar" um lugar que muda de
  // posição a cada tecla.
  useEffect(() => {
    const el = inputRef.current
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [display])

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onKeyDown={(e) => { if (e.currentTarget.selectionStart !== e.currentTarget.value.length) e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length) }}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      data-tabular
      className={cn('input-base', className)}
    />
  )
}
