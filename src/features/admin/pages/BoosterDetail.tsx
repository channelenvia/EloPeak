import { useParams, Link } from 'react-router-dom'
import { Trophy, Swords, Users, ExternalLink, CheckCircle2, Wallet, Star } from 'lucide-react'
import { Card, BoosterStatusBadge, DetailPageHeader, OrderStatusBadge, Avatar, RankBadge, Skeleton } from '@/components/ui'
import { formatDate, formatRank, formatLastSeen, safeOpggUrl, getOrderServiceName } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminBoosterDetail } from '@/api/boosters'
import { useBoosterSlotInfo, useBoosterOrdersPage } from '@/api/orders'
import { RankPerformanceBreakdown } from '@/components/rank/RankPerformanceBreakdown'
import type { Division, RankTier } from '@/types'

const DAY_LABEL: Record<string, string> = { mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb', sun: 'Dom' }

export function AdminBoosterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()

  const { data: booster, isLoading } = useAdminBoosterDetail(id)
  const { data: slotInfo } = useBoosterSlotInfo(booster?.user_id, booster?.status === 'approved')
  const { data: boosterOrders, isLoading: loadingOrders } = useBoosterOrdersPage(booster?.user_id, 'in_progress', 1, 8)

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (!booster) return <p className="text-ink-muted">Booster não encontrado.</p>

  // Mesmas duas estatísticas do mini-perfil público (Concluídos + Rank
  // Máximo) -- ver BoosterPublicProfilePage.tsx, pra manter a caixa da
  // esquerda com a mesma cara/dimensão de lá.
  const statCells: {
    key: string
    label: string
    value: string
    icon?: typeof CheckCircle2
    rankTier?: RankTier
    rankDivision?: Division | null
  }[] = [
    { key: 'completed', icon: CheckCircle2, label: 'Concluídos', value: String(booster.total_completed) },
    {
      key: 'peakRank',
      label: 'Rank Máximo',
      value: booster.peak_rank ? formatRank(booster.peak_rank.tier, booster.peak_rank.division) : '—',
      rankTier: booster.peak_rank?.tier,
      rankDivision: booster.peak_rank?.division ?? null,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Aprovar/rejeitar/suspender/reativar -- só no menu "Ações" da lista
          de boosters (/admin/boosters), pra não ter o mesmo botão em dois
          lugares. Top3 é automático (refresh_top3_boosters), sem toggle manual. */}
      <DetailPageHeader
        backHref="/admin/boosters"
        title={booster.display_name}
        titleBadges={(
          <>
            <BoosterStatusBadge status={booster.status} />
            {booster.is_top3 && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2 py-0.5 uppercase tracking-wide">
                <Trophy className="h-3 w-3" /> TOP 3
              </span>
            )}
          </>
        )}
      />

      {/* Bio + dados do perfil à esquerda (comprida, sem scroll interno --
          ocupa a altura combinada das 2 linhas da direita); à direita,
          empilhado: estatísticas por faixa de elo em cima, fluxo temporal +
          uso de slots embaixo, na mesma largura da seção de estatísticas. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        <div className="lg:col-span-1 lg:row-span-2">
          <Card padding="md" className="h-full text-center space-y-3">
            <Avatar src={booster.avatar_url} name={booster.display_name} size="lg" className="mx-auto" />

            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <h2 className="text-xl font-extrabold text-ink">{booster.display_name}</h2>
                {booster.is_top3 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 px-2 py-0.5 rounded-lg uppercase tracking-wide">
                    <Trophy className="h-3 w-3" /> Top 3
                  </span>
                )}
              </div>
              <p className="text-[10px] font-medium text-ink-muted">{formatLastSeen(booster.last_active_at)}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {statCells.map(({ key, icon: Icon, label, value, rankTier, rankDivision }) => (
                <div key={key} className="rounded-xl bg-bg-raised/50 p-2.5 flex flex-col items-center gap-1">
                  {rankTier ? (
                    <RankBadge tier={rankTier} division={rankDivision ?? null} size="xs" showLabel={false} />
                  ) : Icon ? (
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-bg-raised border border-border-subtle">
                      <Icon className="h-6 w-6 text-success" />
                    </span>
                  ) : null}
                  <p className="text-xs font-bold text-ink text-center leading-tight">{value}</p>
                  <p className="text-[10px] text-ink-muted uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {safeOpggUrl(booster.opgg_link) && (
              <a
                href={safeOpggUrl(booster.opgg_link)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Ver no OP.GG
              </a>
            )}

            {booster.bio && (
              <p className="text-sm text-ink-secondary leading-relaxed">{booster.bio}</p>
            )}

            {/* Só o admin vê daqui pra baixo -- dados da candidatura
                (BoosterApplicationForm) e dados pessoais/PIX. Cada bloco em
                grid 2 colunas (label em cima, valor embaixo) pra ocupar bem
                menos altura que uma lista de linhas label/valor empilhadas. */}
            <div className="pt-3 border-t border-border-subtle text-left space-y-3">
              <div>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Dados da Candidatura</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {[
                    ['Entrou em', formatDate(booster.created_at)],
                    ['Disponibilidade', booster.available_days?.length
                      ? booster.available_days.map(d => DAY_LABEL[d] ?? d).join(', ')
                      : 'Não informado'],
                    ['Carga horária', booster.hours_per_day_min || booster.hours_per_day_max
                      ? `${booster.hours_per_day_min ?? '?'}–${booster.hours_per_day_max ?? '?'} h/dia`
                      : 'Não informado'],
                  ].map(([l, v]) => (
                    <div key={l} className="min-w-0">
                      <p className="text-[9px] text-ink-muted uppercase tracking-wide">{l}</p>
                      <p className="text-xs text-ink font-medium truncate" title={v}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Dados Pessoais / PIX</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {[
                    ['Nome completo', booster.full_name ?? '—'],
                    ['Email', booster.email ?? '—'],
                    ['CPF', booster.cpf ? booster.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—'],
                  ].map(([l, v]) => (
                    <div key={l} className="min-w-0">
                      <p className="text-[9px] text-ink-muted uppercase tracking-wide">{l}</p>
                      <p className="text-xs text-ink font-medium truncate" title={v}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Estatísticas por faixa de elo -- mesmo componente do perfil
            público e do dashboard do booster (RankPerformanceBreakdown),
            pra garantir que sejam literalmente idênticas. */}
        <div className="lg:col-span-2">
          <RankPerformanceBreakdown boosterUserId={booster.user_id} className="h-full" />
        </div>

        {/* Fluxo temporal (histórico de atividade do booster) + uso de
            slots, lado a lado, na mesma largura da seção de estatísticas. */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5">
          <Card padding="md">
            <h3 className="text-base font-semibold text-ink mb-3">Fluxo Temporal</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Pedidos', value: booster.total_completed, icon: CheckCircle2, color: 'text-success bg-success/10' },
                { label: 'Ganhos', value: currency(booster.total_earnings), icon: Wallet, color: 'text-brand bg-brand/10' },
                { label: 'Rating', value: booster.rating.toFixed(1), icon: Star, color: 'text-warning bg-warning/10' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl bg-bg-raised/40 p-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`h-7 w-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-sm font-bold text-ink truncate">{value}</p>
                  </div>
                  <p className="text-[9px] text-ink-muted mt-1 leading-tight">{label}</p>
                </div>
              ))}
            </div>
          </Card>

          {slotInfo && (
            <Card padding="md">
              <h3 className="text-base font-semibold text-ink mb-3 flex items-center gap-2">
                Uso de Slots
                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${slotInfo.is_top3 ? 'bg-warning/10 text-warning' : 'bg-bg-raised text-ink-muted'}`}>
                  {slotInfo.is_top3 ? 'Top3' : 'Regular'}
                </span>
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Solo', value: slotInfo.solo_count, icon: Swords, color: 'text-brand bg-brand/10' },
                  { label: 'Duo',  value: `${slotInfo.duo_count}`, icon: Users, color: 'text-accent bg-accent/10' },
                  { label: 'Exclusivo', value: `${slotInfo.exclusive_slot_used ? 1 : 0}/${slotInfo.max_exclusive ?? 1}`, icon: Trophy,
                    color: slotInfo.exclusive_slot_used ? 'text-danger bg-danger/10' : 'text-success bg-success/10' },
                  { label: 'Total', value: `${slotInfo.total_count}/${slotInfo.max_total}`, icon: Trophy,
                    color: (slotInfo.total_count ?? 0) >= (slotInfo.max_total ?? 3) ? 'text-danger bg-danger/10' : 'text-success bg-success/10' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl bg-bg-raised/40 p-2">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-7 w-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-sm font-bold text-ink truncate">{value}</p>
                    </div>
                    <p className="text-[9px] text-ink-muted mt-1 leading-tight">{label}</p>
                  </div>
                ))}
              </div>

              {/* Pedidos associados ativos -- clicável, leva pro detalhe do pedido. */}
              <div className="mt-4 pt-4 border-t border-border-subtle">
                <p className="text-[10px] font-semibold text-ink-muted mb-2 uppercase tracking-wide">Pedidos Associados</p>
                {loadingOrders ? (
                  <Skeleton className="h-16 w-full" />
                ) : !boosterOrders?.orders.length ? (
                  <p className="text-xs text-ink-muted text-center py-2">Nenhum pedido ativo no momento.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {boosterOrders.orders.map((order) => (
                      <Link
                        key={order.id}
                        to={`/admin/orders/${order.id}`}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg-raised text-xs"
                      >
                        <span className="font-mono text-brand shrink-0">#{order.id.slice(0, 8).toUpperCase()}</span>
                        <span className="text-ink-secondary truncate flex-1">{getOrderServiceName(order)}</span>
                        <OrderStatusBadge order={order} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
