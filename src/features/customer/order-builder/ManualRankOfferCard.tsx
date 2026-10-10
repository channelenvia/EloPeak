import { Info } from 'lucide-react'
import { Button } from '@/components/ui'

// A Riot nao tem rank para esta conta/fila: oferece informar o elo manualmente (o pedido vai marcado para o admin conferir).
export function ManualRankOfferCard({ onDeclare }: { onDeclare: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-info/30 bg-info/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-ink">Não encontramos o seu elo automaticamente</p>
          <p className="text-xs text-ink-secondary mt-0.5">
            Você pode informar o seu elo manualmente. Nossa equipe confere no seu Riot ID antes de iniciar o pedido,
            e informar um elo diferente do real pode levar ao cancelamento do pedido.
          </p>
        </div>
      </div>
      <Button type="button" onClick={onDeclare} variant="secondary" size="md" className="w-full">
        Informar meu elo manualmente
      </Button>
    </div>
  )
}

export function DeclaredRankNotice({ pastSeason = false }: { pastSeason?: boolean }) {
  return (
    <p className="text-xs text-warning" data-testid="declared-rank-notice">
      {pastSeason
        ? 'O elo da temporada passada não existe na API da Riot: informe o seu e nossa equipe confere no seu Riot ID antes de iniciar.'
        : 'Elo informado por você: nossa equipe confere no seu Riot ID antes de iniciar o pedido.'}
    </p>
  )
}
