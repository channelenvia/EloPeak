import { Link } from 'react-router-dom'
import { Landmark, ArrowRight } from 'lucide-react'
import { Card, EmptyState, Skeleton, RankBadge, ErrorAlert } from '@/components/ui'
import { RANK_TIER_LABEL } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useBoosterDuoAccounts, useDuoAccountAutoRefresh } from '@/api/duoAccounts'

export function BoosterAccountsPage() {
  const { profile } = useAuthStore()

  const { data: accounts, isLoading, isError, error: accountsError } = useBoosterDuoAccounts()

  useDuoAccountAutoRefresh(accounts)

  const reserved = accounts?.filter(a => a.reserved_by === profile?.id) ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Contas Duo Boost</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Contas da empresa reservadas para você em pedidos de Duo Boost em andamento. A reserva e o
          token de acesso ficam na página do próprio pedido — login e senha nunca aparecem aqui.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>
      ) : isError ? (
        <ErrorAlert message={accountsError instanceof Error ? accountsError.message : 'Não foi possível carregar as contas Duo.'} />
      ) : !reserved.length ? (
        <EmptyState
          icon={Landmark}
          title="Nenhuma conta reservada no momento"
          description="Ao aceitar um pedido de Duo Boost, reserve uma conta na página do pedido."
        />
      ) : (
        <div className="space-y-3">
          {reserved.map((a) => (
            <Card key={a.id} padding="md">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {a.current_rank && (
                    <RankBadge tier={a.current_rank.tier} division={a.current_rank.division} size="sm" showLabel={false} />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{a.riot_id ?? a.label}</p>
                    {a.current_rank && (
                      <p className="text-xs text-ink-muted">
                        {RANK_TIER_LABEL[a.current_rank.tier]}{a.current_rank.division ? ` ${a.current_rank.division}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                {a.reserved_order_id && (
                  <Link
                    to={`/booster/orders/${a.reserved_order_id}`}
                    className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline shrink-0"
                  >
                    Ver pedido <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
