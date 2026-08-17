import type { ReactNode, Ref } from 'react'
import { ClipboardList, History } from 'lucide-react'
import { Card } from '@/components/ui'
import { ClashDetailsBlock } from './ClashDetailsBlock'
import { OrderAccountSection } from './OrderAccountSection'
import { OrderChat } from './OrderChat'
import { OrderCoachingTopics } from './OrderCoachingTopics'
import { OrderDetailWidget } from './OrderDetailWidget'
import { OrderInfoGrid, type OrderInfoGridItem } from './OrderInfoGrid'
import { OrderMatchHistory } from './OrderMatchHistory'
import { OrderProgress } from './OrderProgress'
import { OrderRankSummary } from './OrderRankSummary'
import { OrderTimeline } from './OrderTimeline'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { getOrderMatchSyncGate } from '@/lib/utils'
import type { useSyncOrderMatches } from '@/api/orders'
import type { Order, OrderStatusHistory } from '@/types'

type CoachPackage = {
  title: string
  description: string | null
  lanes: string[] | null
  champions: string[] | null
  specialties: string[] | null
  tempo: string | null
} | null | undefined

const COACHING_STATUSES = ['assigned', 'in_progress', 'paused', 'awaiting_customer', 'completed']
const MATCH_HISTORY_LOCKED_MESSAGE = 'O histórico de partidas fica disponível quando o booster iniciar o pedido.'
const COACHING_LOCKED_MESSAGE = 'Disponível quando o pedido for aceito.'

interface OrderDetailShellProps {
  order: Order
  viewerRole: 'customer' | 'booster' | 'admin'
  detailsTitle: string
  history: OrderStatusHistory[] | undefined
  coachPackage: CoachPackage
  infoItems: OrderInfoGridItem[]
  notesLabel: string
  syncMatches: ReturnType<typeof useSyncOrderMatches>
  accountLockedMessage: string | undefined
  accountContent: ReactNode
  /** Deep-link #credentials (customer, pós-pagamento) rola até esta coluna. */
  accountSectionRef?: Ref<HTMLDivElement>
  /** Customer esconde a trilha de progresso fora de um subconjunto de status
   * (mesmo com order.target_rank/wins_purchased presentes); admin/booster
   * sempre mostram quando o próprio OrderProgress decide que há dado
   * aplicável. Default true preserva o comportamento admin/booster. */
  showProgress?: boolean
}

/**
 * Layout compartilhado das 3 páginas de detalhe de pedido (customer/admin/
 * booster) -- antes cada uma reimplementava esse mesmo esqueleto (card de
 * detalhes + chat sempre visível, depois tópicos de coaching OU histórico de
 * partidas + conta) de forma independente, com ~300 linhas quase idênticas
 * em cada arquivo. O que continua fora daqui (e por bom motivo, já que a
 * regra de negócio difere de verdade por papel): infoItems, a mensagem/
 * conteúdo da seção de conta, e tudo do cabeçalho (OrderPageHeader), que já
 * era parametrizado por prop antes desse refactor.
 */
export function OrderDetailShell({
  order, viewerRole, detailsTitle, history, coachPackage, infoItems, notesLabel,
  syncMatches, accountLockedMessage, accountContent, accountSectionRef, showProgress = true,
}: OrderDetailShellProps) {
  const { started, syncable } = getOrderMatchSyncGate(order)

  return (
    <>
      {/* Detalhes do pedido (60%) + chat sempre visível (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card padding="lg" className="lg:col-span-3 h-[450px] overflow-y-auto">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-brand" />
              <h3 className="text-base font-semibold text-ink">{detailsTitle}</h3>
            </div>
            <OrderDetailWidget icon={History} label="Histórico do Pedido" compact>
              <OrderTimeline history={history} bare />
            </OrderDetailWidget>
          </div>

          {order.service_type === 'coaching' && coachPackage && (
            <div className="mb-4 pb-4 border-b border-border-subtle space-y-3">
              <p className="text-base font-bold text-ink">{coachPackage.title}</p>
              {coachPackage.description && (
                <p className="text-sm text-ink-secondary leading-relaxed">{coachPackage.description}</p>
              )}
              <ServiceTagPills lanes={coachPackage.lanes} champions={coachPackage.champions} specialties={coachPackage.specialties} />
              {coachPackage.tempo && (
                <p className="text-xs text-ink-muted">Duração: <span className="font-semibold text-ink">{coachPackage.tempo}</span></p>
              )}
            </div>
          )}

          {order.service_type === 'clash' && order.clash_tier && (
            <ClashDetailsBlock
              viewerRole={viewerRole}
              boostMode={order.boost_mode}
              clashTier={order.clash_tier}
              clashDay={order.clash_day}
              createdAt={order.created_at}
            />
          )}

          <OrderRankSummary order={order} />
          {showProgress && <OrderProgress order={order} hideRankBadges />}

          <div className="mt-5">
            <OrderInfoGrid items={infoItems} extras={order.extras} />
          </div>

          {order.customer_notes && (
            <div className="mt-5 bg-bg-elevated rounded-xl p-3">
              <p className="text-xs text-ink-muted mb-1">{notesLabel}</p>
              <p className="text-sm text-ink-secondary">{order.customer_notes}</p>
            </div>
          )}
        </Card>

        <div className="lg:col-span-2 h-[450px]">
          <OrderChat orderId={order.id} viewerRole={viewerRole} orderStatus={order.status} />
        </div>
      </div>

      {/* Coaching: tópicos ocupam a linha inteira, sem conta/credenciais (não há acesso à conta nessa modalidade) */}
      {order.service_type === 'coaching' ? (
        <div className="h-[350px]">
          {COACHING_STATUSES.includes(order.status) ? (
            <OrderCoachingTopics orderId={order.id} />
          ) : (
            <Card padding="md" className="h-full flex items-center justify-center">
              <p className="text-xs text-ink-muted text-center">{COACHING_LOCKED_MESSAGE}</p>
            </Card>
          )}
        </div>
      ) : (
        /* Histórico de partidas (60%) + conta do pedido (40%) */
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 h-[350px]">
            <OrderMatchHistory
              orderId={order.id}
              boostMode={order.boost_mode}
              locked={!started ? MATCH_HISTORY_LOCKED_MESSAGE : undefined}
              sync={syncable || !started ? {
                onSync: () => syncMatches.mutate(),
                syncing: syncMatches.isPending,
                cooldownSeconds: syncMatches.cooldownSeconds,
                error: syncMatches.isError ? (syncMatches.error instanceof Error ? syncMatches.error.message : 'Erro ao sincronizar partidas') : null,
                resultMessage: syncMatches.data
                  ? (syncMatches.data.synced
                    ? (syncMatches.data.new_matches ? `${syncMatches.data.new_matches} nova(s) partida(s) registrada(s).` : 'Nenhuma partida nova encontrada.')
                    : 'Conta Riot não encontrada. Confira o Riot ID cadastrado no pedido.')
                  : null,
              } : undefined}
              pdlEstimate={order.service_type === 'elo_boost'
                ? { gain: order.avg_pdl_gain, loss: order.avg_pdl_loss, label: order.pdl_bracket ? 'PDL' : 'LP' }
                : null}
            />
          </div>

          <div ref={accountSectionRef} className="lg:col-span-2 h-[350px]">
            <OrderAccountSection lockedMessage={accountLockedMessage}>
              {accountContent}
            </OrderAccountSection>
          </div>
        </div>
      )}
    </>
  )
}
