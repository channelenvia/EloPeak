import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Briefcase, Clock, Swords, CalendarClock,
  Trophy, Target, Star, CheckCircle2, TrendingUp, Gamepad2,
} from 'lucide-react'
import { Button, Card, Skeleton, StatCard, EmptyState, ErrorAlert } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { ORDER_SAFE_COLUMNS } from '@/lib/orderColumns'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { Order, BoosterProfile } from '@/types'
import { useTranslation } from 'react-i18next'
import { CompletedOrderCard } from '@/features/booster/components/CompletedOrderCard'

export type AccountType = '__all__' | 'solo' | 'duo'

interface PerformanceSummary {
  total_matches: number
  wins: number
  losses: number
  average_kda: number | null
  avg_cs_per_min: number | null
  mvp_count: number
  review_count: number
  average_rating: number | null
}

interface PerformanceFilters {
  accountType: AccountType
  rankBucket: string // '__all__' or a specific rank_bucket value
  queueType: string // '__all__' or a specific queue_type value
}

// Reflete as combinações materializadas por refresh_booster_performance_segments
// (migration 140): account_type sozinho, ou cruzado com NO MÁXIMO um outro
// filtro (rank OU fila, nunca os dois junto) -- selecionar rank e fila ao
// mesmo tempo cai no rollup por account_type (sem filtro extra), já que essa
// combinação não é pré-calculada.
function segmentFilterFor(filters: PerformanceFilters): { rank_bucket: string; queue_type: string } {
  if (filters.rankBucket !== '__all__') return { rank_bucket: filters.rankBucket, queue_type: '__all__' }
  if (filters.queueType !== '__all__') return { rank_bucket: '__all__', queue_type: filters.queueType }
  return { rank_bucket: '__all__', queue_type: '__all__' }
}

function usePerformanceSummary(boosterId: string | undefined, filters: PerformanceFilters) {
  const segment = segmentFilterFor(filters)
  return useQuery({
    queryKey: ['booster-performance-summary', boosterId, filters.accountType, segment.rank_bucket, segment.queue_type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booster_performance_segments')
        .select('total_matches, wins, losses, average_kda, avg_cs_per_min, mvp_count, review_count, average_rating')
        .eq('booster_id', boosterId!)
        .eq('service_type', '__all__')
        .eq('account_type', filters.accountType)
        .eq('rank_bucket', segment.rank_bucket)
        .eq('queue_type', segment.queue_type)
        .maybeSingle()
      if (error) throw error
      return data as PerformanceSummary | null
    },
    enabled: !!boosterId,
  })
}

interface ChampionStat {
  champion: string
  games_played: number
  wins: number
}

function useTopChampions(boosterId: string | undefined, accountType: AccountType) {
  return useQuery({
    queryKey: ['booster-top-champions', boosterId, accountType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booster_champion_stats')
        .select('champion, games_played, wins')
        .eq('booster_id', boosterId!)
        .eq('account_type', accountType)
        .order('games_played', { ascending: false })
        .limit(3)
      if (error) throw error
      return (data ?? []) as ChampionStat[]
    },
    enabled: !!boosterId,
  })
}

// booster_profiles.total_completed já cobre o rollup geral (Geral) sem
// query extra -- só Solo/Duo precisam de uma contagem ao vivo, porque esse
// contador não é segmentado por boost_mode.
function useCompletedOrdersCount(boosterId: string | undefined, accountType: 'solo' | 'duo') {
  return useQuery({
    queryKey: ['booster-completed-orders-count', boosterId, accountType],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_booster_id', boosterId!)
        .eq('status', 'completed')
        .eq('boost_mode', accountType)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!boosterId,
  })
}

function useBoosterProfile(userId: string) {
  return useQuery({
    queryKey: ['booster-profile-full', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booster_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data as unknown as BoosterProfile | null
    },
    enabled: !!userId,
  })
}

// orders.assigned_booster_id FKs to profiles.id (the auth uid), which is
// booster_profiles.user_id — NOT booster_profiles.id. Must filter by the
// auth uid, never by the booster_profiles row's own primary key.
function useAssignedOrders(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: ['booster-assigned-orders', boosterUserId],
    enabled: !!boosterUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SAFE_COLUMNS)
        .eq('assigned_booster_id', boosterUserId!)
        .in('status', ['assigned', 'in_progress', 'paused', 'awaiting_customer'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Order[]
    },
    refetchInterval: 15000,
  })
}

export function BoosterDashboard() {
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const { data: boosterProfile, isLoading: profileLoading, isError: profileError } = useBoosterProfile(profile?.id ?? '')
  const { data: activeOrders, isError: activeOrdersError } = useAssignedOrders(profile?.id)

  const [accountTab, setAccountTab] = useState<AccountType>('__all__')
  const [rankFilter, setRankFilter] = useState('__all__')
  const [queueFilter, setQueueFilter] = useState('__all__')

  const filters: PerformanceFilters = { accountType: accountTab, rankBucket: rankFilter, queueType: queueFilter }
  const { data: performance, isLoading: loadingPerformance, isError: performanceError } = usePerformanceSummary(
    boosterProfile?.status === 'approved' ? profile?.id : undefined,
    filters,
  )
  const { data: topChampions } = useTopChampions(
    boosterProfile?.status === 'approved' ? profile?.id : undefined,
    accountTab,
  )
  const { data: segmentCompletedCount } = useCompletedOrdersCount(
    boosterProfile?.status === 'approved' && accountTab !== '__all__' ? profile?.id : undefined,
    accountTab === '__all__' ? 'solo' : accountTab,
  )
  const completedCount = accountTab === '__all__' ? (boosterProfile?.total_completed ?? 0) : (segmentCompletedCount ?? 0)

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: monthOrders, isLoading: loadingMonthOrders, isError: monthOrdersError } = useQuery({
    queryKey: ['booster-month-orders', profile?.id, monthStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SAFE_COLUMNS)
        .eq('assigned_booster_id', profile!.id)
        .eq('status', 'completed')
        .gte('completed_at', monthStart)
        .order('completed_at', { ascending: false })
      if (error) throw error
      return data as unknown as Order[]
    },
    enabled: !!profile?.id && boosterProfile?.status === 'approved',
    refetchInterval: 30000,
  })

  if (profileLoading) return <Skeleton className="h-64 w-full" />
  if (profileError) return <ErrorAlert message="Não foi possível carregar seu perfil de booster. Tente recarregar a página." />

  // If not yet approved, show onboarding notice
  if (boosterProfile?.status !== 'approved') {
    return (
      <div className="max-w-xl">
        <Card padding="lg" variant="brand" className="text-center">
          <div className="h-14 w-14 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
            <Clock className="h-7 w-7 text-warning" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">{t('booster.dashboard.pending.title')}</h2>
          <p className="text-ink-secondary text-sm">
            {t('booster.dashboard.pending.desc')}
          </p>
          <p className="mt-3 text-xs text-ink-muted">{t('booster.dashboard.pending.statusLabel')} <strong className="text-warning">{boosterProfile?.status ?? 'pending'}</strong></p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('booster.nav.dashboard')}</h1>
          <p className="text-ink-secondary mt-1">
            {activeOrdersError
              ? 'Não foi possível carregar seus pedidos ativos.'
              : activeOrders?.length
                ? t('booster.dashboard.activeCount', { count: activeOrders.length })
                : t('booster.dashboard.noActive')}
          </p>
        </div>
        <Button asChild>
          <Link to="/booster/jobs">
            <Briefcase className="h-4 w-4" />
            {t('booster.dashboard.browseJobs')}
          </Link>
        </Button>
      </div>

      {/* Performance */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-ink-muted" />
            Performance
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-border p-0.5">
              {(['__all__', 'solo', 'duo'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setAccountTab(tab); setRankFilter('__all__'); setQueueFilter('__all__') }}
                  className={cn(
                    'px-3 py-1 text-xs font-semibold rounded-lg transition',
                    accountTab === tab ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink',
                  )}
                >
                  {tab === '__all__' ? 'Geral' : tab === 'solo' ? 'Solo' : 'Duo'}
                </button>
              ))}
            </div>
            <select
              value={rankFilter}
              onChange={(e) => { setRankFilter(e.target.value); setQueueFilter('__all__') }}
              className="text-xs rounded-lg border border-border bg-bg px-2 py-1"
            >
              <option value="__all__">Todos os ranks</option>
              <option value="gold_minus">Ouro e abaixo</option>
              <option value="plat_diamond">Platina/Diamante</option>
              <option value="master_plus">Mestre+</option>
            </select>
            <select
              value={queueFilter}
              onChange={(e) => { setQueueFilter(e.target.value); setRankFilter('__all__') }}
              className="text-xs rounded-lg border border-border bg-bg px-2 py-1"
            >
              <option value="__all__">Todas as filas</option>
              <option value="solo_duo">SoloQ</option>
              <option value="flex">Flex</option>
            </select>
          </div>
        </div>
        {loadingPerformance ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
          </div>
        ) : performanceError ? (
          <ErrorAlert message="Não foi possível carregar suas estatísticas de performance." />
        ) : !performance || performance.total_matches === 0 ? (
          <Card padding="md">
            <EmptyState
              icon={Trophy}
              title="Ainda sem estatísticas suficientes"
              description="Complete seus primeiros pedidos para ver win rate, KDA e avaliações aqui."
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                label="Win rate"
                icon={Target}
                color="text-success bg-success/10"
                value={`${((performance.wins / performance.total_matches) * 100).toFixed(1)}%`}
              />
              <StatCard
                label="KDA médio"
                icon={Swords}
                color="text-brand bg-brand/10"
                value={performance.average_kda != null ? performance.average_kda.toFixed(1) : 'Não disponível'}
              />
              <StatCard
                label="Avaliação"
                icon={Star}
                color="text-warning bg-warning/10"
                value={performance.average_rating != null ? `${performance.average_rating.toFixed(1)} (${performance.review_count})` : 'Sem avaliações'}
              />
              <StatCard
                label="Serviços concluídos"
                icon={CheckCircle2}
                color="text-accent bg-accent/10"
                value={completedCount}
              />
              <StatCard
                label="Farm/min"
                icon={Gamepad2}
                color="text-brand bg-brand/10"
                value={performance.avg_cs_per_min != null ? performance.avg_cs_per_min.toFixed(1) : 'Não disponível'}
              />
              <StatCard
                label="MVPs"
                icon={Trophy}
                color="text-warning bg-warning/10"
                value={performance.mvp_count}
              />
            </div>
            {topChampions && topChampions.length > 0 && (
              <Card padding="md" className="mt-4">
                <h3 className="text-sm font-semibold text-ink mb-3">Melhores campeões</h3>
                <div className="space-y-2">
                  {topChampions.map((c, i) => (
                    <div key={c.champion} className="flex items-center justify-between text-sm">
                      <span className="text-ink-secondary">{i + 1}. {c.champion}</span>
                      <span className="text-ink-muted text-xs" data-tabular>
                        {c.games_played} partida{c.games_played === 1 ? '' : 's'} · {Math.round((c.wins / c.games_played) * 100)}% WR
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Serviços concluídos este mês */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-ink-muted" />
          Serviços concluídos este mês
        </h3>
        {loadingMonthOrders ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
          </div>
        ) : monthOrdersError ? (
          <ErrorAlert message="Não foi possível carregar os serviços concluídos deste mês." />
        ) : !monthOrders?.length ? (
          <Card padding="md">
            <p className="text-sm text-ink-muted text-center py-4">Nenhum serviço concluído neste mês ainda.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {monthOrders.map((order) => <CompletedOrderCard key={order.id} order={order} isTop3={boosterProfile?.is_top3} />)}
          </div>
        )}
      </div>

    </div>
  )
}
