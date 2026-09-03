import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import { adminAssignPendingReviewOrder, adminCancelPendingReviewOrder, adminSetPendingReviewLock } from '@/api/orders/mutations'
import { getAdminDashboardStats, listAdminDropRequests, listAdminPayments, listAdminRefunds, listAdminReviewCases, listPendingReviewOrders } from './queries'
import { adminAdjustBoosterBalance, resolveDropRequest } from './mutations'

export function useAdminReviewCases() {
  const query = useQuery({
    queryKey: queryKeys.admin.reviewCases(),
    queryFn: listAdminReviewCases,
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-review-cases',
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: [queryKeys.admin.reviewCases()],
  })
  return query
}

export function useAdminAdjustBoosterBalance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminAdjustBoosterBalance,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.reviewCases() }),
  })
}

export function usePendingReviewOrders() {
  const query = useQuery({
    queryKey: queryKeys.admin.pendingReview(),
    queryFn: listPendingReviewOrders,
    refetchInterval: 10_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-pending-review',
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: [queryKeys.admin.pendingReview()],
  })
  return query
}

export function useAdminSetPendingReviewLock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminSetPendingReviewLock,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingReview() }),
  })
}

export function useAdminCancelPendingReviewOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminCancelPendingReviewOrder,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingReview() }),
  })
}

export function useAdminAssignPendingReviewOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminAssignPendingReviewOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingReview() })
      void queryClient.invalidateQueries({ queryKey: ['booster-slots'] })
      void queryClient.invalidateQueries({ queryKey: ['boosters', 'with-slots'] })
    },
  })
}

export function useAdminDashboardStats() {
  const query = useQuery({
    queryKey: queryKeys.admin.dashboardStats(),
    queryFn: getAdminDashboardStats,
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-dashboard-stats',
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: [queryKeys.admin.dashboardStats()],
  })
  return query
}

export function useAdminRefunds() {
  const query = useQuery({
    queryKey: queryKeys.admin.refunds(),
    queryFn: () => listAdminRefunds(),
    refetchInterval: 20_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-refunds',
    table: 'refunds',
    queryKeys: [queryKeys.admin.refunds()],
  })
  return query
}

export function useAdminPayments() {
  const query = useQuery({
    queryKey: queryKeys.admin.payments(),
    queryFn: () => listAdminPayments(),
    refetchInterval: 20_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-payments',
    table: 'payments',
    queryKeys: [queryKeys.admin.payments()],
  })
  return query
}

export function useAdminDropRequests() {
  const query = useQuery({
    queryKey: queryKeys.admin.drops(),
    queryFn: () => listAdminDropRequests(),
    refetchInterval: 15_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-drop-requests',
    table: 'order_drop_requests',
    queryKeys: [queryKeys.admin.drops()],
  })
  return query
}

export function useResolveDropRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: resolveDropRequest,
    // Além da própria fila de drops, invalida a lista de pedidos do admin e
    // qualquer pedido/solicitação de drop pendente em cache -- sem isso, só
    // o order_status_events (que já propaga pra cliente/booster via
    // realtime) refletia a mudança; a própria tela do admin que acabou de
    // aprovar/rejeitar só se atualizava no próximo poll de 30s, parecendo
    // que o pedido "sumiu" ou não voltou pra listagem certa até F5.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.drops() })
      void queryClient.invalidateQueries({ queryKey: ['orders', 'admin'] })
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes('drop-request') })
    },
  })
}

