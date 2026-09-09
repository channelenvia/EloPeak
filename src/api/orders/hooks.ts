import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import type { OrderStatus, ServiceType } from '@/types'
import { secondsRemaining } from './cooldown'
import {
  getAdminOrderTabCounts, getBoosterOrder, getBoosterOrderTabCounts, getBoosterSlotInfo, getCustomerOrderState, getCustomerOrderTabCounts, getOrder, getOrderCustomerNickname,
  getOrderDuoAccountHistory, getOrderDuoPartnerRiotId, getOrderPaidAmount, getPendingDropRequest,
  listAdminOrders, listAvailableJobs, listBoosterOrdersPage, listCustomerOrders, listOrderBoosterDuoMatches, listOrderCoachingTopics,
  listOrderMatches, listOrderStatusHistory,
} from './queries'
import {
  acceptBoostOrder, addOrderCoachingTopic, adminCreateManualRefund, adminDropOrder, adminFlagOrderUnderReview, adminOverrideOrderStatus, adminReassignBooster, cancelPendingOrder,
  confirmOrderCompletion, generatePix, requestCustomerOrderDrop, requestOrderDrop,
  revealOrderCredentials, setOrderCoachingTopicDone, setOrderCredentials, syncOrderMatches,
  updateOrderStatus, verifyOrderRank,
} from './mutations'
import type { OrderListTab } from './types'

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

export function useOrderDuoAccountHistory(orderId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.duoAccountHistory(orderId ?? ''),
    queryFn: () => getOrderDuoAccountHistory(orderId!),
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

export function useOrderPaidAmount(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.paidAmount(orderId ?? ''),
    queryFn: () => getOrderPaidAmount(orderId!),
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

export function useCustomerOrders(customerId: string | undefined, tab: OrderListTab = 'all', limit?: number, includeCanceled = false) {
  const query = useQuery({
    queryKey: queryKeys.orders.customerList(customerId ?? '', { tab, limit, includeCanceled }),
    queryFn: () => listCustomerOrders(customerId!, tab, limit, includeCanceled),
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
    queryKeys: customerId
      ? [queryKeys.orders.customerList(customerId, { tab, limit, includeCanceled }), queryKeys.orders.customerTabCounts(customerId)]
      : [],
    enabled: !!customerId,
  })
  return query
}

// Total por aba (ver OrderStatusFilterDropdown), independente da aba
// selecionada agora -- por isso não depende de `tab` como useCustomerOrders.
export function useCustomerOrderTabCounts(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.customerTabCounts(customerId ?? ''),
    queryFn: () => getCustomerOrderTabCounts(customerId!),
    enabled: !!customerId,
    refetchInterval: 30_000,
  })
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

// page é 1-based (UI); listBoosterOrdersPage espera um offset 0-based (que
// ela mesma multiplica por pageSize internamente).
export function useBoosterOrdersPage(boosterId: string | undefined, tab: OrderListTab, page: number, pageSize: number, includeCanceled = false) {
  const query = useQuery({
    queryKey: queryKeys.orders.boosterList(boosterId ?? '', { tab, page, pageSize, includeCanceled }),
    queryFn: () => listBoosterOrdersPage({ boosterId: boosterId!, tab, offset: page - 1, pageSize, includeCanceled }),
    enabled: !!boosterId,
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
    queryKeys: boosterId
      ? [queryKeys.orders.boosterList(boosterId, { tab, page, pageSize, includeCanceled }), queryKeys.orders.boosterTabCounts(boosterId)]
      : [],
    enabled: !!boosterId,
  })
  return query
}

// Total por aba (ver OrderStatusFilterDropdown) -- independente de página/aba
// selecionada, por isso é um hook à parte de useBoosterOrdersPage.
export function useBoosterOrderTabCounts(boosterId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.boosterTabCounts(boosterId ?? ''),
    queryFn: () => getBoosterOrderTabCounts(boosterId!),
    enabled: !!boosterId,
    refetchInterval: 30_000,
  })
}

export function useAdminOrders(tab: OrderListTab = 'all', serviceType?: ServiceType | 'all', includeCanceled = false) {
  const query = useQuery({
    queryKey: queryKeys.orders.adminList({ status: tab, serviceType, includeCanceled }),
    queryFn: () => listAdminOrders(tab, serviceType, undefined, includeCanceled),
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-orders',
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: [queryKeys.orders.adminList({ status: tab, serviceType, includeCanceled }), queryKeys.orders.adminTabCounts()],
  })
  return query
}

// Total por aba (ver OrderStatusFilterDropdown), independente da aba/tipo de
// serviço selecionado agora.
export function useAdminOrderTabCounts() {
  return useQuery({
    queryKey: queryKeys.orders.adminTabCounts(),
    queryFn: getAdminOrderTabCounts,
    refetchInterval: 30_000,
  })
}

export function useOrderStatusHistory(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.history(orderId ?? ''),
    queryFn: () => listOrderStatusHistory(orderId!),
    enabled: !!orderId,
  })
  useRealtimeInvalidate({
    channel: `order-history-${orderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.history(orderId)] : [],
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

export function useOrderBoosterDuoMatches(orderId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.boosterDuoMatches(orderId ?? ''),
    queryFn: () => listOrderBoosterDuoMatches(orderId!),
    enabled: !!orderId && enabled,
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
    queryKey: queryKeys.orders.dropRequest(orderId ?? ''),
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
    queryKeys: orderId ? [queryKeys.orders.dropRequest(orderId)] : [],
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
    queryKey: queryKeys.boosters.slots(boosterId ?? ''),
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
    mutationFn: (params: { reason: string; coachingCompletionPct?: number }) => adminDropOrder({ orderId, ...params }),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}

export function useAdminReassignBooster(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { targetBoosterId: string; reason: string; coachingCompletionPct?: number }) => adminReassignBooster({ orderId, ...params }),
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.slots() })
    },
  })
}

export function useAdminFlagOrderUnderReview(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => adminFlagOrderUnderReview({ orderId, reason }),
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.reviewCases() })
      // Se havia booster ativo, ele acabou de perder um slot (apply_order_drop
      // por baixo, ver migration 20260906190000) -- mesmo motivo de
      // useAdminReassignBooster invalidar isso.
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.slots() })
    },
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.dropRequest(orderId) })
    },
  })
}

export function useRequestCustomerOrderDrop(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => requestCustomerOrderDrop({ orderId, reason }),
    onSuccess: () => {
      invalidateOrder(queryClient, orderId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.dropRequest(orderId) })
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.slots() })
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
      // Pedidos duo também gravam booster_duo_matches no mesmo sync -- sem
      // isso, o painel "Booster" do histórico ficava desatualizado até um
      // remount, enquanto o painel "Cliente" (acima) já refletia a partida
      // nova, quebrando a expectativa de carregamento simultâneo dos dois.
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.boosterDuoMatches(orderId) })
      // latestRankVerification (['orders','detail',orderId,'rank-verifications','latest'])
      // já é coberta como prefixo por invalidateOrder(...) acima (que invalida
      // ['orders','detail',orderId]) -- sem invalidação extra aqui.
    },
  })

  return { ...mutation, cooldownSeconds }
}

export function useVerifyOrderRank(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => verifyOrderRank(orderId),
    onSuccess: () => invalidateOrder(queryClient, orderId),
  })
}
