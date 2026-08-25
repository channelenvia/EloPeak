import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import { cn, sortOrderExtras } from '@/lib/utils'
import type { OrderExtra } from '@/types'

export interface OrderInfoGridItem {
  icon: LucideIcon
  label: string
  value: React.ReactNode
}

// Grid de informações do pedido (modo, fila, Riot ID, entrega, booster,
// valor...) -- texto minimalista (ícone + label acima, valor abaixo), sem
// virar um card/badge por item (isso foi tentado e revertido: usuário
// preferia o estilo antigo mais limpo). Continua full width e responsivo
// (2/3/4 colunas conforme o espaço) pra não voltar a apertar tudo no centro.
// Extras ficam em uma subseção compacta abaixo do grid -- só nome, sem valor,
// já que o preço deles está embutido no total do pedido mostrado acima.
export function OrderInfoGrid({ items, extras }: { items: OrderInfoGridItem[]; extras?: OrderExtra[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!items.length) return null
  const sortedExtras = extras?.length ? sortOrderExtras(extras) : []
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label} className="text-center">
            <p className="text-xs text-ink-muted flex items-center justify-center gap-1">
              <Icon className="h-3 w-3 shrink-0" />{label}
            </p>
            <div className="text-sm font-semibold text-ink mt-0.5" data-tabular>{value}</div>
          </div>
        ))}
      </div>
      {sortedExtras.length > 0 && (
        <div className="mt-5 rounded-xl border border-border-subtle bg-bg-elevated/40 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            <p className="text-xs font-semibold text-ink-secondary">Adicionais</p>
            <span className="text-[10px] text-ink-muted" data-tabular>({sortedExtras.length})</span>
            <ChevronDown className={cn('ml-auto h-3.5 w-3.5 text-ink-muted transition-transform', expanded && 'rotate-180')} />
          </button>
          {expanded && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sortedExtras.map((extra) => (
                <span
                  key={extra.extra_id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand/15 bg-brand/5 px-2.5 py-1 text-xs font-medium text-ink-secondary"
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-brand/15">
                    <Check className="h-2.5 w-2.5 text-brand" />
                  </span>
                  {extra.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
