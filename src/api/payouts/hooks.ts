import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import {
  fetchAdminPayoutRequests, fetchBoosterPayoutRequests, fetchBoosterPayoutTotals, fetchPayoutRequestBreakdown,
} from './queries'
import {
  adminMarkPayoutPaid, adminReviewPayoutRequest, cancelPayoutRequest, requestPayout,
} from './mutations'
import type { PayoutRequestRow } from './types'

export function useBoosterPayoutTotals(boosterId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payouts.totals(boosterId ?? ''),
    queryFn: () => fetchBoosterPayoutTotals(boosterId!),
    enabled: !!boosterId,
  })
}

export function useBoosterPayoutRequests(boosterId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.payouts.requests(boosterId ?? ''),
    queryFn: () => fetchBoosterPayoutRequests(boosterId!),
    enabled: !!boosterId,
  })

  useRealtimeInvalidate({
    channel: `payout-requests-booster-${boosterId ?? 'none'}`,
    table: 'payout_requests',
    filter: boosterId ? `booster_id=eq.${boosterId}` : undefined,
    queryKeys: boosterId
      ? [queryKeys.payouts.requests(boosterId), queryKeys.payouts.totals(boosterId)]
      : [],
    enabled: !!boosterId,
  })

  return query
}

export function useAdminPayoutRequests(status?: PayoutRequestRow['status']) {
  const query = useQuery({
    queryKey: queryKeys.payouts.adminList({ status }),
    queryFn: () => fetchAdminPayoutRequests(status),
  })

  useRealtimeInvalidate({
    channel: 'payout-requests-admin',
    table: 'payout_requests',
    queryKeys: [queryKeys.payouts.adminList({ status })],
  })

  return query
}

export function usePayoutRequestBreakdown(requestId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payouts.breakdown(requestId ?? ''),
    queryFn: () => fetchPayoutRequestBreakdown(requestId!),
    enabled: !!requestId,
  })
}

export function useRequestPayout(boosterId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestPayout,
    onSuccess: () => {
      if (!boosterId) return
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.totals(boosterId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.requests(boosterId) })
    },
  })
}

export function useCancelPayoutRequest(boosterId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cancelPayoutRequest,
    onSuccess: () => {
      if (!boosterId) return
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.totals(boosterId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.requests(boosterId) })
    },
  })
}

export function useAdminReviewPayoutRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminReviewPayoutRequest,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payouts'] }),
  })
}

export function useAdminMarkPayoutPaid() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminMarkPayoutPaid,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payouts'] }),
  })
}
