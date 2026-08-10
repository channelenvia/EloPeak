import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Briefcase, History, Lock, Search, Sparkles, Swords, Users } from 'lucide-react'
import { Button, Card, EmptyState, Skeleton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { timeAgo, boosterEarningsShare, getOrderServiceName, getOrderModeType } from '@/lib/utils'
import type { Order } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAvailableJobs, useBoosterSlotInfo, useAcceptBoostOrder } from '@/api/orders'
import { OrderSoundSettings } from '@/features/booster/components/OrderSoundSettings'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'


interface SlotInfo {
  solo_count: number
  duo_count: number
  total_count: number
  max_total: number
  is_top3: boolean
  exclusive_slot_used: boolean
  max_exclusive: number
}

function SlotIndicator({ slots }: { slots: SlotInfo }) {
  const { solo_count, duo_count, total_count, max_total, is_top3, exclusive_slot_used } = slots
  const remaining = max_total - total_count
  const color = remaining === 0 ? 'text-danger' : remaining === 1 ? 'text-warning' : 'text-success'

  return (
    <div className="flex items-center gap-3 bg-bg-surface/80 backdrop-blur-sm border border-bg-elevated rounded-xl px-4 py-2.5">
      {is_top3 && (
        <span className="text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2 py-0.5 uppercase tracking-wide">
          TOP 3
        </span>
      )}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-ink-muted">Slots:</span>
        <span className={`font-bold ${color}`}>{total_count}/{max_total}</span>
      </div>
      <div className="h-3 w-px bg-bg-elevated" />
      <div className="flex items-center gap-2 text-[11px] text-ink-secondary">
        <span className="flex items-center gap-1">
          <Swords className="h-3 w-3" />
          Solo: {solo_count}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          Duo: {duo_count}
        </span>
      </div>
      <div className="h-3 w-px bg-bg-elevated" />
      <span className={`flex items-center gap-1 text-[11px] font-medium ${exclusive_slot_used ? 'text-ink-muted' : 'text-accent'}`}>
        <Sparkles className="h-3 w-3" />
        Exclusivo: {exclusive_slot_used ? 1 : 0}/1
      </span>
    </div>
  )
}

// Só o booster para quem o pedido foi vinculado vê o rótulo — para todos os
// outros o pedido simplesmente não aparece (filtrado no available_boost_orders).
function exclusiveTimeLeft(job: Order, myUserId?: string): string | null {
  if (!myUserId || job.preferred_booster_id !== myUserId || !job.exclusive_until) return null
  const msLeft = new Date(job.exclusive_until).getTime() - Date.now()
  if (msLeft <= 0) return null
  const hours = Math.floor(msLeft / 3_600_000)
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`
}

export function AvailableJobsPage() {
  const { profile } = useAuthStore()
  const [search, setSearch] = useState('')
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: boosterProfile } = useQuery({
    queryKey: ['booster-profile-slots', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('booster_profiles')
        .select('status, is_top3, user_id')
        .eq('user_id', profile!.id)
        .maybeSingle()
      return data
    },
    enabled: !!profile?.id,
  })

  // Real-time slot counts via DB function
  const { data: slotInfoRaw } = useBoosterSlotInfo(profile?.id, boosterProfile?.status === 'approved')
  const slotInfo: SlotInfo | undefined = slotInfoRaw ? {
    solo_count: slotInfoRaw.solo_count ?? 0,
    duo_count: slotInfoRaw.duo_count ?? 0,
    total_count: slotInfoRaw.total_count ?? 0,
    max_total: slotInfoRaw.max_total ?? 3,
    is_top3: slotInfoRaw.is_top3 ?? false,
    exclusive_slot_used: slotInfoRaw.exclusive_slot_used ?? false,
    max_exclusive: slotInfoRaw.max_exclusive ?? 1,
  } : undefined

  const { data: jobs, isLoading } = useAvailableJobs()

  // Mensagens de erro já vêm traduzidas de src/api/orders/mutations.ts (ACCEPT_ORDER_MESSAGES).
  const acceptJobMutation = useAcceptBoostOrder()
  const acceptJob = {
    isPending: acceptJobMutation.isPending,
    isError: acceptJobMutation.isError,
    error: acceptJobMutation.error,
    mutate: (orderId: string) => acceptJobMutation.mutate({ orderId, boosterId: profile!.id }),
  }

  const canAcceptJob = (job: Order): boolean => {
    if (!slotInfo) return false
    // Pedido exclusivo pra mim, ainda dentro da janela: usa o slot bônus
    // (máx 1), independente dos 3 slots normais estarem cheios ou não.
    if (exclusiveTimeLeft(job, profile?.id)) return !slotInfo.exclusive_slot_used
    if (slotInfo.total_count >= slotInfo.max_total) return false
    return true
  }

  const serviceFilters = useServiceFilters(jobs)
  const filtered = serviceFilters.filtered.filter((j) =>
    !search || j.id.toLowerCase().includes(search.toLowerCase())
  )

  if (boosterProfile && boosterProfile.status !== 'approved') {
    const statusMessages: Record<string, { title: string; desc: string }> = {
      pending:      { title: t('booster.jobs.locked.pending'), desc: t('booster.jobs.locked.pendingDesc') },
      under_review: { title: t('booster.jobs.locked.under_review'), desc: t('booster.jobs.locked.under_reviewDesc') },
      suspended:    { title: t('booster.jobs.locked.suspended'), desc: t('booster.jobs.locked.suspendedDesc') },
    }
    const msg = statusMessages[boosterProfile.status] ?? { title: t('booster.jobs.locked.default'), desc: t('booster.jobs.locked.defaultDesc') }
    return (
      <div>
        <EmptyState icon={Lock} title={msg.title} description={msg.desc} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('booster.jobs.title')}</h1>
          <p className="text-sm text-ink-secondary mt-1">
            {t('booster.jobs.count', { count: filtered.length })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {slotInfo && <SlotIndicator slots={slotInfo} />}
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-slow" />
            {t('booster.jobs.live')}
          </div>
          <OrderSoundSettings />
        </div>
      </div>

      {/* Slots full warning */}
      {slotInfo && slotInfo.total_count >= slotInfo.max_total && (
        <div className="bg-warning/10 border border-warning/20 rounded-xl px-4 py-3 text-sm text-warning font-medium">
          Você atingiu o limite de {slotInfo.max_total} pedidos ativos. Conclua um pedido para liberar um slot.
          {!slotInfo.exclusive_slot_used && ' Você ainda pode aceitar 1 pedido exclusivo, se algum estiver vinculado a você.'}
        </div>
      )}

      {/* Filters -- busca + categoria de serviço + subfiltros, mesmo padrão de "Pedidos" (sem status aqui: todo job já é awaiting_assignment). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-48 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por código do pedido..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-base pl-8 py-1.5 text-xs"
          />
        </div>
        <ServiceFilterBar
          category={serviceFilters.category}
          onCategoryChange={serviceFilters.setCategory}
          counts={serviceFilters.counts}
          queue={serviceFilters.queue}
          onQueueChange={serviceFilters.setQueue}
          mode={serviceFilters.mode}
          onModeChange={serviceFilters.setMode}
          clashTier={serviceFilters.clashTier}
          onClashTierChange={serviceFilters.setClashTier}
          clashDay={serviceFilters.clashDay}
          onClashDayChange={serviceFilters.setClashDay}
        />
      </div>

      {/* Jobs */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <EmptyState icon={Briefcase} title={t('booster.jobs.empty')} description={t('booster.jobs.emptyDesc')} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((job) => {
            const isDuo = job.boost_mode === 'duo'
            const blocked = slotInfo && !canAcceptJob(job)
            const exclusiveLabel = exclusiveTimeLeft(job, profile?.id)

            return (
              <Card
                key={job.id}
                className={`h-full flex flex-col hover:border-brand/20 hover:shadow-card-hover transition-all ${exclusiveLabel ? 'border-accent/40' : ''}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-ink-muted">#{job.id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-sm font-semibold text-ink truncate">{getOrderServiceName(job)}</p>
                  </div>
                  {job.service_type !== 'coaching' && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide shrink-0 ${
                      isDuo
                        ? 'bg-brand/10 text-brand border border-brand/20'
                        : 'bg-bg-elevated text-ink-muted'
                    }`}>
                      {getOrderModeType(job)}
                    </span>
                  )}
                </div>

                {(exclusiveLabel || job.drop_count > 0 || job.service_type === 'elo_boost' || job.service_type === 'win_boost' || job.service_type === 'md5') && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {(job.service_type === 'elo_boost' || job.service_type === 'win_boost' || job.service_type === 'md5') && (
                      <span className="text-[10px] font-medium bg-bg-elevated text-ink-secondary px-2 py-0.5 rounded-lg">
                        {job.queue_type === 'solo_duo' ? t('booster.jobs.soloQueue') : t('booster.jobs.flexQueue')}
                      </span>
                    )}
                    {exclusiveLabel && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-accent/15 text-accent border border-accent/30">
                        <Sparkles className="h-3 w-3" />
                        Exclusivo · {exclusiveLabel}
                      </span>
                    )}
                    {job.drop_count > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30">
                        <History className="h-3 w-3" />
                        Dropado
                      </span>
                    )}
                  </div>
                )}

                <OrderCardDetails order={job} />

                <div className="flex items-center justify-between pt-3 border-t border-bg-elevated mt-auto">
                  <div>
                    <p className="text-sm font-bold text-success">{currency(job.total_price * boosterEarningsShare(slotInfo?.is_top3))}</p>
                    <p className="text-[10px] text-ink-muted">{t('booster.jobs.yourCut', { pct: Math.round(boosterEarningsShare(slotInfo?.is_top3) * 100) })}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      size="sm"
                      onClick={() => acceptJob.mutate(job.id)}
                      loading={acceptJob.isPending}
                      disabled={!!blocked}
                      title={blocked ? 'Slots cheios' : undefined}
                    >
                      {t('booster.jobs.accept')}
                    </Button>
                    {acceptJob.isError && (
                      <p className="text-[10px] text-danger text-right max-w-[140px]">
                        {acceptJob.error instanceof Error ? acceptJob.error.message : 'Erro'}
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-[10px] text-ink-muted mt-2">{t('booster.jobs.posted', { time: timeAgo(job.created_at) })}</p>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
