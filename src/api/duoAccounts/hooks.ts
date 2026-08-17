import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import { getDuoAccountReservationHistory, listAdminDuoAccounts, listDuoAccounts, lookupDuoAccountRiotRank } from './queries'
import {
  adminDeleteDuoAccount, adminReleaseDuoAccount, adminSaveDuoAccount, adminSetDuoAccountActive,
  clearDuoOwnRiotId, getDuoAccountAccessToken, releaseDuoAccountReservation, reserveDuoAccount,
  setDuoOwnRiotId, updateDuoAccountRank,
} from './mutations'
import type { AdminDuoAccount, BoosterVisibleDuoAccount } from './types'

export function useBoosterDuoAccounts() {
  const query = useQuery({
    queryKey: queryKeys.duoAccounts.list(),
    queryFn: () => listDuoAccounts<BoosterVisibleDuoAccount>(),
    refetchInterval: 15_000,
  })
  useRealtimeInvalidate({
    channel: 'booster-duo-accounts',
    table: 'duo_account_events',
    event: 'INSERT',
    queryKeys: [queryKeys.duoAccounts.list()],
  })
  return query
}

export function useAdminDuoAccounts() {
  const query = useQuery({
    queryKey: queryKeys.duoAccounts.adminList(),
    queryFn: listAdminDuoAccounts,
    refetchInterval: 15_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-duo-accounts',
    table: 'duo_account_events',
    event: 'INSERT',
    queryKeys: [queryKeys.duoAccounts.adminList()],
  })
  return query
}

export function useDuoAccountReservationHistory(accountId: string | undefined) {
  return useQuery({
    queryKey: ['duo-accounts', 'reservation-history', accountId],
    queryFn: () => getDuoAccountReservationHistory(accountId!),
    enabled: !!accountId,
  })
}

export function useReserveDuoAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: reserveDuoAccount,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.duoAccounts.list() }),
  })
}

export function useReleaseDuoAccountReservation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: releaseDuoAccountReservation,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.duoAccounts.list() }),
  })
}

export function useGetDuoAccountAccessToken() {
  return useMutation({ mutationFn: getDuoAccountAccessToken })
}

// duo_own_riot_id mora em orders, não em duo_accounts -- invalida o detalhe
// do pedido (é de lá que JobDetail lê o campo), não a lista de contas.
export function useSetDuoOwnRiotId() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setDuoOwnRiotId,
    onSuccess: (_data, variables) => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(variables.orderId) }),
  })
}

export function useClearDuoOwnRiotId() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clearDuoOwnRiotId,
    onSuccess: (_data, orderId) => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) }),
  })
}

export function useAdminSaveDuoAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminSaveDuoAccount,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.duoAccounts.adminList() }),
  })
}

export function useAdminSetDuoAccountActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminSetDuoAccountActive,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.duoAccounts.adminList() }),
  })
}

export function useAdminReleaseDuoAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminReleaseDuoAccount,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.duoAccounts.adminList() }),
  })
}

export function useAdminDeleteDuoAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminDeleteDuoAccount,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.duoAccounts.adminList() }),
  })
}

// Ao detectar que uma conta acabou de ser liberada (reserved_by transiciona
// de não-nulo pra nulo entre duas leituras), busca o rank atual na Riot e
// grava -- mantém o pool sempre com rank atualizado sem depender de um admin
// atualizar manualmente. Compartilhado entre a tela do booster e a do admin.
export function useDuoAccountAutoRefresh(accounts: BoosterVisibleDuoAccount[] | AdminDuoAccount[] | undefined) {
  const previouslyReserved = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!accounts) return
    const justReleased = accounts.filter((a) => previouslyReserved.current.has(a.id) && !a.reserved_by)
    previouslyReserved.current = new Set(accounts.filter((a) => a.reserved_by).map((a) => a.id))

    for (const account of justReleased) {
      if (!account.riot_id) continue
      void (async () => {
        try {
          const rank = await lookupDuoAccountRiotRank(account.riot_id!)
          if (rank.found && rank.ranked && rank.tier) {
            await updateDuoAccountRank({ accountId: account.id, tier: rank.tier, division: rank.division ?? null })
          }
        } catch {
          // Falha silenciosa por design -- é um refresh best-effort em
          // segundo plano, não deve interromper o fluxo do usuário.
        }
      })()
    }
  }, [accounts])
}
