import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, Clock, Sparkles } from 'lucide-react'
import { Button, Card, Skeleton, ErrorAlert } from '@/components/ui'
import { RankPerformanceBreakdown } from '@/components/rank/RankPerformanceBreakdown'
import { supabase } from '@/lib/supabase'
import { ORDER_SAFE_COLUMNS } from '@/lib/orderColumns'
import { useAuthStore } from '@/stores/authStore'
import type { Order, BoosterProfile } from '@/types'
import { useTranslation } from 'react-i18next'
import { CompletedOrderCard } from '@/features/booster/components/CompletedOrderCard'

// Fila de prioridade: pedidos em andamento primeiro, depois concluídos mais
// recentes -- uma fila só, não duas seções separadas (ativos / concluídos do
// mês).
const PRIORITY_GROUP: Record<string, number> = {
  in_progress: 0, paused: 0, awaiting_customer: 0, assigned: 0,
  completed: 1,
}

function orderTimestamp(order: Order): number {
  const ref = order.status === 'completed' && order.completed_at ? order.completed_at : order.created_at
  return new Date(ref).getTime()
}

function sortByPriority(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    const groupDiff = (PRIORITY_GROUP[a.status] ?? 2) - (PRIORITY_GROUP[b.status] ?? 2)
    if (groupDiff !== 0) return groupDiff
    return orderTimestamp(b) - orderTimestamp(a)
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
  if (profileError) return <ErrorAlert message="Não foi possível carregar seu perfil de booster." />

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

  const queue = sortByPriority([...(activeOrders ?? []), ...(monthOrders ?? [])])
  const queueLoading = loadingMonthOrders

  return (
    <div className="space-y-6">
      {/* Mesmo tratamento do header em customer/pages/Dashboard.tsx (glow +
          nome em gradiente) -- os dois "welcome" de dashboard eram idênticos
          em estrutura, então ficavam inconsistentes se só um ganhasse o
          glamour. */}
      <div className="relative overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface/60 px-6 py-5">
        <div className="absolute inset-0 bg-hero-glow opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">
              {t('booster.dashboard.welcome')}, <span className="text-gradient-brand">{profile?.username}</span>
              <Sparkles className="ml-2 inline h-5 w-5 text-accent align-[-2px]" />
            </h1>
            <p className="text-sm text-ink-secondary mt-1">
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
      </div>

      <RankPerformanceBreakdown boosterUserId={profile?.id} />

      {/* Fila de pedidos: em andamento -> concluídos mais recentes */}
      <div>
        <h3 className="text-base font-semibold text-ink mb-3">Fila de pedidos</h3>
        {queueLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
          </div>
        ) : activeOrdersError || monthOrdersError ? (
          <ErrorAlert message="Não foi possível carregar seus pedidos." />
        ) : !queue.length ? (
          <Card padding="md">
            <p className="text-sm text-ink-muted text-center py-4">Nenhum pedido em andamento ou concluído neste mês ainda.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {queue.slice(0, 9).map((order) => <CompletedOrderCard key={order.id} order={order} isTop3={boosterProfile?.is_top3} />)}
          </div>
        )}
      </div>
    </div>
  )
}
