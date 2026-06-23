import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Briefcase, Lock, Swords, Users } from 'lucide-react'
import { Button, Card, EmptyState, Skeleton, RankBadge } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { timeAgo, formatRank } from '@/lib/utils'
import type { Order, QueueType, RankTier } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'


interface SlotInfo {
  solo_count: number
  duo_count: number
  total_count: number
  max_total: number
  max_duo: number
  is_top5: boolean
}

function SlotIndicator({ slots }: { slots: SlotInfo }) {
  const { solo_count, duo_count, total_count, max_total, max_duo, is_top5 } = slots
  const remaining = max_total - total_count
  const color = remaining === 0 ? 'text-danger' : remaining === 1 ? 'text-warning' : 'text-success'

  return (
    <div className="flex items-center gap-3 bg-bg-surface border border-bg-elevated rounded-xl px-4 py-2.5">
      {is_top5 && (
        <span className="text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2 py-0.5 uppercase tracking-wide">
          TOP 5
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
          Duo: {duo_count}/{max_duo}
        </span>
      </div>
    </div>
  )
}

export function AvailableJobsPage() {
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()
  const [queue, setQueue] = useState<QueueType | 'all'>('all')
  const { t } = useTranslation()
  const currency = useCurrency()

  const QUEUE_OPTIONS: { label: string; value: QueueType | 'all' }[] = [
    { label: 'Todas as Filas', value: 'all' },
    { label: t('booster.jobs.soloQueue'), value: 'solo_duo' },
    { label: t('booster.jobs.flexQueue'), value: 'flex' },
  ]

  const { data: boosterProfile } = useQuery({
    queryKey: ['booster-profile', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('booster_profiles')
        .select('status, is_top5, user_id')
        .eq('user_id', profile!.id)
        .maybeSingle()
      return data
    },
    enabled: !!profile?.id,
  })

  // Real-time slot counts via DB function
  const { data: slotInfo } = useQuery({
    queryKey: ['booster-slots', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('can_booster_accept_order', {
          p_booster_user_id: profile!.id,
          p_boost_mode: 'solo', // dummy mode — we just want slot counts
        })
      if (error) throw error
      const result = data as unknown as SlotInfo & { allowed: boolean }
      return {
        solo_count: result.solo_count ?? 0,
        duo_count: result.duo_count ?? 0,
        total_count: result.total_count ?? 0,
        max_total: result.max_total ?? 2,
        max_duo: result.max_duo ?? 1,
        is_top5: result.is_top5 ?? false,
      } as SlotInfo
    },
    enabled: !!profile?.id && boosterProfile?.status === 'approved',
    refetchInterval: 10000,
  })

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['available-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'awaiting_assignment')
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return data as unknown as Order[]
    },
    refetchInterval: 15000,
  })

  const acceptJob = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc('accept_boost_order', {
        p_order_id: orderId,
        p_booster_user_id: profile!.id,
      })
      if (error) throw error
      const result = data as unknown as { success: boolean; error?: string; details?: SlotInfo }
      if (!result.success) {
        const messages: Record<string, string> = {
          order_no_longer_available: 'Este pedido já foi aceito por outro booster.',
          slot_limit_reached: 'Você atingiu o limite de pedidos ativos.',
          duo_slot_limit_reached: 'Você atingiu o limite de slots Duo.',
          booster_not_approved: 'Sua conta de booster não está aprovada.',
          unauthorized: 'Ação não autorizada.',
        }
        throw new Error(messages[result.error ?? ''] ?? result.error ?? 'Erro ao aceitar pedido.')
      }
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['booster-assigned-orders'] })
      queryClient.invalidateQueries({ queryKey: ['booster-slots'] })
    },
  })

  const canAcceptJob = (job: Order): boolean => {
    if (!slotInfo) return false
    if (slotInfo.total_count >= slotInfo.max_total) return false
    if (job.boost_mode === 'duo' && slotInfo.duo_count >= slotInfo.max_duo) return false
    return true
  }

  const filtered = jobs?.filter((j) => {
    if (queue !== 'all' && j.queue_type !== queue) return false
    return true
  }) ?? []

  if (boosterProfile && boosterProfile.status !== 'approved') {
    const statusMessages: Record<string, { title: string; desc: string }> = {
      pending:      { title: t('booster.jobs.locked.pending'), desc: t('booster.jobs.locked.pendingDesc') },
      under_review: { title: t('booster.jobs.locked.under_review'), desc: t('booster.jobs.locked.under_reviewDesc') },
      suspended:    { title: t('booster.jobs.locked.suspended'), desc: t('booster.jobs.locked.suspendedDesc') },
    }
    const msg = statusMessages[boosterProfile.status] ?? { title: t('booster.jobs.locked.default'), desc: t('booster.jobs.locked.defaultDesc') }
    return (
      <div className="max-w-4xl">
        <EmptyState icon={Lock} title={msg.title} description={msg.desc} />
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
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
        </div>
      </div>

      {/* Slots full warning */}
      {slotInfo && slotInfo.total_count >= slotInfo.max_total && (
        <div className="bg-warning/10 border border-warning/20 rounded-xl px-4 py-3 text-sm text-warning font-medium">
          Você atingiu o limite de {slotInfo.max_total} pedidos ativos. Conclua um pedido para liberar um slot.
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="flex gap-1 bg-bg-surface border border-bg-elevated rounded-xl p-1">
          {QUEUE_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setQueue(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                queue === value ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Jobs */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
      ) : !filtered.length ? (
        <EmptyState icon={Briefcase} title={t('booster.jobs.empty')} description={t('booster.jobs.emptyDesc')} />
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => {
            const isDuo = job.boost_mode === 'duo'
            const blocked = slotInfo && !canAcceptJob(job)
            const duoBlocked = slotInfo && isDuo && slotInfo.duo_count >= slotInfo.max_duo && slotInfo.total_count < slotInfo.max_total

            return (
              <Card key={job.id} className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-mono text-ink-muted">#{job.id.slice(0, 8).toUpperCase()}</span>
                    <span className="text-xs bg-bg-elevated text-ink-secondary px-2 py-0.5 rounded-lg">{job.server}</span>
                    <span className="text-xs bg-bg-elevated text-ink-secondary px-2 py-0.5 rounded-lg">
                      {job.queue_type === 'solo_duo' ? t('booster.jobs.soloQueue') : t('booster.jobs.flexQueue')}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide ${
                      isDuo
                        ? 'bg-brand/10 text-brand border border-brand/20'
                        : 'bg-bg-elevated text-ink-muted'
                    }`}>
                      {isDuo ? 'Duo Boost' : 'Solo Boost'}
                    </span>
                  </div>
                  {job.current_rank && job.target_rank && (
                    <div className="flex items-center gap-2 mt-1">
                      <RankBadge
                        tier={(job.current_rank as { tier: RankTier }).tier}
                        division={(job.current_rank as { division: string }).division}
                        size="xs"
                        showLabel={false}
                      />
                      <span className="text-xs font-medium text-ink-secondary">
                        {formatRank((job.current_rank as { tier: RankTier }).tier, (job.current_rank as { division: string }).division)}
                      </span>
                      <span className="text-ink-muted text-xs">→</span>
                      <RankBadge
                        tier={(job.target_rank as { tier: RankTier }).tier}
                        division={(job.target_rank as { division: string }).division}
                        size="xs"
                        showLabel={false}
                      />
                      <span className="text-xs font-medium text-ink-secondary">
                        {formatRank((job.target_rank as { tier: RankTier }).tier, (job.target_rank as { division: string }).division)}
                      </span>
                    </div>
                  )}
                  {duoBlocked && (
                    <p className="text-[10px] text-warning mt-0.5">Slot Duo cheio — libere um slot duo para aceitar.</p>
                  )}
                  <p className="text-xs text-ink-muted mt-0.5">{t('booster.jobs.posted', { time: timeAgo(job.created_at) })}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-success">{currency(job.total_price * 0.75)}</p>
                    <p className="text-[10px] text-ink-muted">{t('booster.jobs.yourCut')}</p>
                  </div>
                  <div className="flex flex-col gap-1">
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
                      <p className="text-[10px] text-danger text-center max-w-[120px]">
                        {acceptJob.error instanceof Error ? acceptJob.error.message : 'Erro'}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
