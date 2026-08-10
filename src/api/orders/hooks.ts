import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import type { OrderStatus, ServiceType } from '@/types'
import { secondsRemaining } from './cooldown'
import {
  getBoosterOrder, getBoosterSlotInfo, getCustomerOrderState, getOrder, getOrderCustomerNickname, getOrderDuoPartnerRiotId, getPendingDropRequest,
  listAdminOrders, listAvailableJobs, listBoosterOrdersPage, listCustomerOrders, listOrderCoachingTopics,
  listOrderMatches, listOrderStatusHistory,
} from './queries'
import {
  acceptBoostOrder, addOrderCoachingTopic, adminCreateManualRefund, adminDropOrder, adminOverrideOrderStatus, cancelPendingOrder,
  confirmOrderCompletion, disputeOrderCompletion, generatePix, requestCustomerOrderDrop, requestOrderDrop,
  requestOrderSupport, revealOrderCredentials, setOrderCoachingTopicDone, setOrderCredentials, syncOrderMatches,
  updateOrderStatus, verifyOrderRank,
} from './mutations'
import type { BoosterOrdersTab } from './types'

// Pedido individual: Realtime + fallback conservador (30s) no lugar do
// polling agressivo de 4-15s que existia em cada página antes desta camada.
// Assina order_status_events (não orders diretamente) -- orders nunca entra
// na publicação supabase_realtime pra não transmitir a linha inteira (preço,
// notas, dados do cliente) pra quem estiver com o canal aberto (ver migration
// 042/088); o evento mínimo só dispara um refetch normal, que já respeita RLS.
export function useOrder(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.detail(orderId ?? ''),
    queryFn: () => getOrder(orderId!),
    enabled: !!orderId,
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: `order-${orderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.detail(orderId)] : [],
    enabled: !!orderId,
  })
  return query
}

export function useOrderDuoPartnerRiotId(orderId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.duoPartnerRiotId(orderId ?? ''),
    queryFn: () => getOrderDuoPartnerRiotId(orderId!),
    enabled: !!orderId && enabled,
  })
}

export function useOrderCustomerNickname(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.customerNickname(orderId ?? ''),
    queryFn: () => getOrderCustomerNickname(orderId!),
    enabled: !!orderId,
  })
}

export function useBoosterOrder(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.detail(orderId ?? ''),
    queryFn: () => getBoosterOrder(orderId!),
    enabled: !!orderId,
    refetchInterval: 15_000,
  })
  useRealtimeInvalidate({
    channel: `booster-order-${orderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.detail(orderId)] : [],
    enabled: !!orderId,
  })
  return query
}

export function useCustomerOrders(customerId: string | undefined, limit?: number) {
  const query = useQuery({
    queryKey: queryKeys.orders.customerList(customerId ?? '', { limit }),
    queryFn: () => listCustomerOrders(customerId!, limit),
    enabled: !!customerId,
    refetchInterval: 30_000,
  })
  // Sem filter= aqui de propósito -- order_status_events não tem coluna
  // customer_id pra filtrar na assinatura. RLS da própria tabela (migration
  // 088) já restringe o que este cliente recebe às linhas dos pedidos dele.
  useRealtimeInvalidate({
    channel: `customer-orders-${customerId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: customerId ? [queryKeys.orders.customerList(customerId, { limit })] : [],
    enabled: !!customerId,
  })
  return query
}

export function useAvailableJobs() {
  const query = useQuery({
    queryKey: queryKeys.orders.availableJobs(),
    queryFn: () => listAvailableJobs(),
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'available-jobs',
    table: 'booster_order_events',
    event: 'INSERT',
    queryKeys: [queryKeys.orders.availableJobs()],
  })
  return query
}

export function useBoosterOrdersInfinite(boosterId: string | undefined, tab: BoosterOrdersTab, pageSize: number) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.orders.boosterList(boosterId ?? '', { tab, pageSize }),
    queryFn: ({ pageParam }) => listBoosterOrdersPage({ boosterId: boosterId!, tab, offset: pageParam, pageSize }),
    enabled: !!boosterId,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    refetchInterval: 30_000,
  })
  // Sem isso, a lista "Meus pedidos" do booster (diferente da tela de
  // detalhe de UM pedido, que já tem sua própria assinatura) só refletia
  // status/drop mudando após até 30s de poll -- ex.: admin aprova/rejeita um
  // drop e o pedido não reaparecia/mudava de coluna na lista sem F5 ou essa
  // espera. RLS de order_status_events já restringe ao que este booster pode ver.
  useRealtimeInvalidate({
    channel: `booster-orders-list-${boosterId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: boosterId ? [queryKeys.orders.boosterList(boosterId, { tab, pageSize })] : [],
    enabled: !!boosterId,
  })
  return query
}

export function useAdminOrders(status?: OrderStatus | 'all', serviceType?: ServiceType | 'all') {
  const query = useQuery({
    queryKey: queryKeys.orders.adminList({ status, serviceType }),
    queryFn: () => listAdminOrders(status, serviceType),
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-orders',
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: [queryKeys.orders.adminList({ status, serviceType })],
  })
  return query
}

export function useOrderStatusHistory(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.detail(orderId ?? '').concat(['history']),
    queryFn: () => listOrderStatusHistory(orderId!),
    enabled: !!orderId,
  })
  useRealtimeInvalidate({
    channel: `order-history-${orderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.detail(orderId).concat(['history'])] : [],
    enabled: !!orderId,
  })
  return query
}

export function useOrderMatches(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.matches(orderId ?? ''),
    queryFn: () => listOrderMatches(orderId!),
    enabled: !!orderId,
  })
}

export function useOrderCoachingTopics(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.topics(orderId ?? ''),
    queryFn: () => listOrderCoachingTopics(orderId!),
    enabled: !!orderId,
  })

  useRealtimeInvalidate({
    channel: `order-coaching-topics-${orderId ?? 'none'}`,
    table: 'order_coaching_topics',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.topics(orderId)] : [],
    enabled: !!orderId,
  })

  return query
}

export function useAddOrderCoachingTopic(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => addOrderCoachingTopic({ orderId, content }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.topics(orderId) }),
  })
}

export function useSetOrderCoachingTopicDone(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ topicId, done }: { topicId: string; done: boolean }) => setOrderCoachingTopicDone({ orderId, topicId, done }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.topics(orderId) }),
  })
}

export function usePendingDropRequest(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.detail(orderId ?? '').concat(['drop-request']),
    queryFn: () => getPendingDropRequest(orderId!),
    enabled: !!orderId,
    refetchInterval: 30_000,
  })
  // Sem isso, o banner "pedido travado" ficava até 30s desatualizado depois
  // do admin aprovar/rejeitar -- order_drop_requests não tinha nenhuma
  // assinatura própria aqui, só o refetchInterval genérico.
  useRealtimeInvalidate({
    channel: `order-drop-request-${orderId ?? 'none'}`,
    table: 'order_drop_requests',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.detail(orderId).concat(['drop-request'])] : [],
    enabled: !!orderId,
  })
  return query
}

export function useCustomerOrderState(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.state(orderId ?? ''),
    queryFn: () => getCustomerOrderState(orderId),
    enabled: !!orderId,
    refetchInterval: 30_000,
  })
  // can_confirm_completion/requires_credentials só eram recalculados por
  // mutations locais (ex.: o próprio cliente confirmando) -- sem isso, o
  // botão "Confirmar conclusão" só aparecia depois de recarregar a página
  // quando era o BOOSTER quem disparava a mudança (ex.: finalizar pedido).
  useRealtimeInvalidate({
    channel: `order-state-${orderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.state(orderId)] : [],
    enabled: !!orderId,
  })
  return query
}

export function useBoosterSlotInfo(boosterId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['booster-slots', boosterId ?? ''],
    queryFn: () => getBoosterSlotInfo(boosterId!),
    enabled: !!boosterId && enabled,
    refetchInterval: 20_000,
  })
}

function invalidateOrder(queryClient: ReturnType<typeof useQueryClient>, orderId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.orders.state(orderId) })
}

export function useSetOrderCredentials(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setOrderCredentials,
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useConfirmOrderCompletion(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => confirmOrderCompletion(orderId),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useDisputeOrderCompletion(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => disputeOrderCompletion({ orderId, reason }),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useUpdateOrderStatus(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (newStatus: OrderStatus) => updateOrderStatus({ orderId, newStatus }),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useAdminOverrideOrderStatus(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminOverrideOrderStatus,
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useAdminDropOrder(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => adminDropOrder({ orderId, reason }),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

// Sem orderId fixo no hook -- o admin digita o número do pedido no
// formulário (não estamos na página do pedido), então invalida usando o
// orderId que veio nas variables do próprio mutate(). A lista de reembolsos
// (queryKeys.admin.refunds()) já se atualiza sozinha via realtime.
export function useAdminCreateManualRefund() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminCreateManualRefund,
    onSuccess: (_data, variables) => invalidateOrder(queryClient, variables.orderId),
  })
}

export function useRequestOrderDrop(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => requestOrderDrop({ orderId, reason }),
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId).concat(['drop-request']) })
    },
  })
}

export function useRequestCustomerOrderDrop(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => requestCustomerOrderDrop({ orderId, reason }),
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId).concat(['drop-request']) })
    },
  })
}

export function useRevealOrderCredentials() {
  return useMutation({ mutationFn: revealOrderCredentials })
}

export function useAcceptBoostOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: acceptBoostOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.availableJobs() })
      void queryClient.invalidateQueries({ queryKey: ['booster-slots'] })
      void queryClient.invalidateQueries({ queryKey: ['orders', 'booster'] })
    },
  })
}

export function useGeneratePix(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => generatePix(orderId),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useCancelPendingOrder() {
  return useMutation({ mutationFn: cancelPendingOrder })
}

export function useSyncOrderMatches(orderId: string) {
  const queryClient = useQueryClient()
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  useEffect(() => {
    if (cooldownUntil == null) return
    const tick = () => {
      const remaining = secondsRemaining(cooldownUntil, Date.now())
      setCooldownSeconds(remaining)
      if (remaining <= 0) setCooldownUntil(null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const mutation = useMutation({
    mutationFn: () => syncOrderMatches(orderId),
    // Cooldown se aplica independente de sucesso/erro (inclusive num 503 de
    // rate limit do próprio servidor) -- o objetivo é impedir clique
    // repetido, não só comemorar sucesso.
    onSettled: () => {
      setCooldownUntil(Date.now() + 30_000)
    },
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.matches(orderId) })
      // Partidas sincronizadas podem ter mudado o resultado (wins_played,
      // vitórias/derrotas) -- o card de Progresso lê a mesma order.detail já
      // invalidada acima, mas a barra de rank (elo_boost) lê separadamente a
      // última verificação: invalida aqui também pra nunca ficar com dado velho.
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.latestRankVerification(orderId) })
    },
  })

  return { ...mutation, cooldownSeconds }
}

export function useRequestOrderSupport(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => requestOrderSupport(orderId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.supportEscalation(orderId) }),
  })
}

export function useVerifyOrderRank(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => verifyOrderRank(orderId),
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.latestRankVerification(orderId) })
    },
  })
}
