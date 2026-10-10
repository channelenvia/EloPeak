import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { getOrderRankAssessment } from '@/api/orders'
import { queryKeys } from '@/api/core/queryKeys'
import { RANK_TIER_LABEL } from '@/lib/utils'
import type { Order, OrderRankAssessment } from '@/types'

type Viewer = 'customer' | 'booster' | 'admin'

const ASSESSMENT_LABEL: Record<OrderRankAssessment['status'], { text: string; tone: string }> = {
  consistent: { text: 'Compatível com o elo declarado', tone: 'text-success' },
  suspicious: { text: 'Suspeito: não bate com o elo declarado', tone: 'text-danger' },
  inconclusive: { text: 'Inconclusivo (poucos dados na Riot)', tone: 'text-warning' },
}

// Avaliacao do proprio sistema (so o admin ve; a tabela tem RLS de admin).
function AssessmentDetails({ orderId }: { orderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.orders.rankAssessment(orderId),
    queryFn: () => getOrderRankAssessment(orderId),
  })
  if (isLoading) return <p className="text-xs text-ink-muted mt-2">Conferindo o elo na Riot…</p>
  if (!data) return <p className="text-xs text-ink-muted mt-2">Verificação do sistema ainda em andamento ou indisponível.</p>
  const label = ASSESSMENT_LABEL[data.status]
  const s = data.summary
  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="rank-assessment">
      <p className={`font-semibold ${label.tone}`}>Verificação do sistema: {label.text}</p>
      <p className="text-ink-secondary">
        Elo estimado pelas partidas: <span className="font-semibold text-ink">{s.estimated_tier ? RANK_TIER_LABEL[s.estimated_tier] : '—'}</span>
        {' · '}Partidas ranqueadas encontradas: {s.ranked_games_found}
        {' · '}Jogadores amostrados: {s.sampled_players}
        {s.summoner_level != null && <> · Nível da conta: {s.summoner_level}</>}
      </p>
      {s.notes.map((note) => <p key={note} className="text-ink-muted">{note}</p>)}
    </div>
  )
}

// Aviso especial quando o elo NAO veio da Riot (a API nao achou rank) e foi informado pelo cliente.
export function DeclaredRankBanner({ order, viewer }: { order: Pick<Order, 'id' | 'rank_source' | 'service_type'>; viewer: Viewer }) {
  if (order.rank_source !== 'client_declared') return null
  const pastSeason = order.service_type === 'md5'

  if (viewer === 'customer') {
    return (
      <div className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-ink-secondary flex items-start gap-2" data-testid="declared-rank-banner">
        <ShieldCheck className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <p>O elo deste pedido foi informado por você{pastSeason ? ' (elo da temporada passada)' : ''}. Nossa equipe confere no seu Riot ID.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border-2 border-warning/40 bg-warning/10 px-3 py-2.5 text-xs" data-testid="declared-rank-banner">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-ink">Elo não encontrado pela API — preenchido pelo cliente</p>
          <p className="text-ink-secondary mt-0.5">
            {pastSeason
              ? 'Elo da temporada passada informado pelo cliente (a Riot não expõe esse dado). Confira no Riot ID antes de iniciar.'
              : 'A Riot não retornou rank para esta conta. Confira o elo no Riot ID antes de iniciar.'}
          </p>
          {viewer === 'admin' && <AssessmentDetails orderId={order.id} />}
        </div>
      </div>
    </div>
  )
}
