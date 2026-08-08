import type { LucideIcon } from 'lucide-react'

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
export function OrderInfoGrid({ items }: { items: OrderInfoGridItem[] }) {
  if (!items.length) return null
  return (
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
  )
}
