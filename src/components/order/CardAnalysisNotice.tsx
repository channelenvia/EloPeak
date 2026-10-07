import { Clock } from 'lucide-react'
import { Button } from '@/components/ui'

interface CardAnalysisNoticeProps {
  actionLabel: string
  onAction: () => void
}

// Cartão aceito pelo Mercado Pago mas ainda em análise (antifraude/emissor):
// o pedido já está salvo e é liberado sozinho quando o pagamento for aprovado.
export function CardAnalysisNotice({ actionLabel, onAction }: CardAnalysisNoticeProps) {
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10">
        <Clock className="h-7 w-7 text-brand" />
      </div>
      <h2 className="text-lg font-bold text-ink">Pagamento em análise</h2>
      <p className="text-sm text-ink-secondary">
        O Mercado Pago está analisando o seu cartão. Seu pedido está salvo em <strong className="text-ink">Meus Pedidos</strong> e
        é liberado automaticamente assim que o pagamento for aprovado.
      </p>
      <Button variant="secondary" onClick={onAction}>{actionLabel}</Button>
    </div>
  )
}
