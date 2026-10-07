import { CreditCard, QrCode } from 'lucide-react'
import type { ReactNode } from 'react'

export type PaymentMethod = 'pix' | 'card'

interface PaymentMethodPickerProps {
  onSelect: (method: PaymentMethod) => void
  disabled?: boolean
}

interface OptionProps {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}

function Option({ icon, title, description, onClick, disabled }: OptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-2 rounded-2xl border border-border-subtle bg-bg-raised p-5 text-center transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-subtle"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-ink-inverse">{icon}</span>
      <span className="text-sm font-bold text-ink">{title}</span>
      <span className="text-xs text-ink-secondary">{description}</span>
    </button>
  )
}

export function PaymentMethodPicker({ onSelect, disabled }: PaymentMethodPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Option
        icon={<CreditCard className="h-5 w-5" />}
        title="Cartão"
        description="Crédito ou débito"
        onClick={() => onSelect('card')}
        disabled={disabled}
      />
      <Option
        icon={<QrCode className="h-5 w-5" />}
        title="PIX"
        description="Instantâneo e sem taxa"
        onClick={() => onSelect('pix')}
        disabled={disabled}
      />
    </div>
  )
}
