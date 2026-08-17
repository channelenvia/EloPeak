import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import {
  getAdminBoosterDetail, getAssignedBoosterProfile, getBoosterAccessState, getBoosterActiveDropWarnings, getBoosterBlockedUntil, getBoosterPerformanceByRank, getOwnBoosterDisplayName,
  getOwnBoosterTop3Status, getOwnProfessionalProfile, getPublicBooster, getTopBoosters, listAdminBoosters,
  listBoosterAdminNotes, listBoostersPerformance, listBoosterNames, listPublicBoosters,
} from './queries'
import {
  adminApproveBooster, boosterHeartbeat, expelBooster, onboardBooster, setBoosterAdminNote,
  updateProfessionalProfile,
} from './mutations'

export function useBoosterStatus(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.status(userId ?? ''),
    queryFn: () => getBoosterAccessState(userId!),
    enabled: !!userId,
  })
}

export function useAssignedBooster(boosterUserId: string | null | undefined) {
  return useQuery({
    queryKey: ['boosters', 'assigned-profile', boosterUserId ?? ''],
    queryFn: () => getAssignedBoosterProfile(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export function useOwnProfessionalProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.profile(userId ?? ''),
    queryFn: () => getOwnProfessionalProfile(userId!),
    enabled: !!userId,
  })
}

export function useOwnBoosterDisplayName(userId: string | undefined) {
  return useQuery({
    queryKey: ['boosters', 'own-display-name', userId ?? ''],
    queryFn: () => getOwnBoosterDisplayName(userId!),
    enabled: !!userId,
  })
}

export function useOwnBoosterTop3Status(userId: string | undefined) {
  return useQuery({
    queryKey: ['boosters', 'own-top3-status', userId ?? ''],
    queryFn: () => getOwnBoosterTop3Status(userId!),
    enabled: !!userId,
  })
}

export function usePublicBoosters() {
  const query = useQuery({
    queryKey: queryKeys.boosters.publicList(),
    queryFn: listPublicBoosters,
    staleTime: 60_000,
    // Refetch periódico pro badge "Online" (derivado de last_active_at, ver
    // isBoosterOnline em lib/utils.ts) refletir presença em near-real-time --
    // mesmo intervalo já usado em useAdminOrders/booster-month-orders.
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'public-boosters',
    table: 'booster_profile_events',
    event: 'INSERT',
    queryKeys: [queryKeys.boosters.publicList()],
  })
  return query
}

export function usePublicBooster(displayName: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.boosters.publicProfile(displayName ?? ''),
    queryFn: () => getPublicBooster(displayName!),
    enabled: !!displayName,
    staleTime: 60_000,
    // Mesmo refetch periódico do usePublicBoosters, pro badge "Online" do
    // perfil (derivado de last_active_at, ver isBoosterOnline em lib/utils.ts)
    // não ficar defasado em relação ao card da listagem.
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: `public-booster-${displayName ?? 'none'}`,
    table: 'booster_profile_events',
    event: 'INSERT',
    queryKeys: displayName ? [queryKeys.boosters.publicProfile(displayName)] : [],
    enabled: !!displayName,
  })
  return query
}

export function useBoostersPerformance(boosterUserIds: string[]) {
  return useQuery({
    queryKey: ['boosters', 'performance', boosterUserIds],
    queryFn: () => listBoostersPerformance(boosterUserIds),
    enabled: boosterUserIds.length > 0,
    staleTime: 60_000,
  })
}

export function useBoosterPerformanceByRank(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: ['boosters', 'performance-by-rank', boosterUserId ?? ''],
    queryFn: () => getBoosterPerformanceByRank(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export function useTopBoosters(limit: number) {
  const query = useQuery({
    queryKey: ['boosters', 'top', limit] as const,
    queryFn: () => getTopBoosters({ limit }),
    staleTime: 60_000,
  })
  useRealtimeInvalidate({
    channel: `top-boosters-${limit}`,
    table: 'booster_profile_events',
    event: 'INSERT',
    queryKeys: [['boosters', 'top', limit]],
  })
  return query
}

export function useAdminBoosters(status?: string) {
  const query = useQuery({
    queryKey: queryKeys.boosters.adminList({ status }),
    queryFn: () => listAdminBoosters(status),
    refetchInterval: 20_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-boosters',
    table: 'booster_profile_events',
    event: 'INSERT',
    queryKeys: [queryKeys.boosters.adminList({ status })],
  })
  return query
}

export function useAdminBoosterDetail(boosterId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.boosters.adminDetail(boosterId ?? ''),
    queryFn: () => getAdminBoosterDetail(boosterId!),
    enabled: !!boosterId,
    refetchInterval: 20_000,
  })
  useRealtimeInvalidate({
    channel: `admin-booster-detail-${boosterId ?? 'none'}`,
    table: 'booster_profile_events',
    event: 'INSERT',
    queryKeys: boosterId ? [queryKeys.boosters.adminDetail(boosterId)] : [],
    enabled: !!boosterId,
  })
  return query
}

export function useBoosterActiveDropWarnings(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.dropWarnings(boosterUserId ?? ''),
    queryFn: () => getBoosterActiveDropWarnings(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export function useBoosterBlockedUntil(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.blockedUntil(boosterUserId ?? ''),
    queryFn: () => getBoosterBlockedUntil(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export function useBoosterNames(boosterUserIds: string[]) {
  return useQuery({
    queryKey: ['boosters', 'names', boosterUserIds],
    queryFn: () => listBoosterNames(boosterUserIds),
    enabled: boosterUserIds.length > 0,
  })
}

export function useBoosterHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    void boosterHeartbeat()
    const onVisible = () => { if (document.visibilityState === 'visible') void boosterHeartbeat() }
    const interval = window.setInterval(onVisible, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}

export function useOnboardBooster(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: onboardBooster,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.status(userId ?? '') }),
  })
}

export function useUpdateProfessionalProfile(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateProfessionalProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.profile(userId ?? '') })
      void queryClient.invalidateQueries({ queryKey: ['boosters', 'public'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.publicList() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.top() })
    },
  })
}

export function useAdminApproveBooster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminApproveBooster,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['boosters'] }),
  })
}

export function useExpelBooster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: expelBooster,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['boosters'] }),
  })
}

export function useBoosterAdminNotes() {
  return useQuery({
    queryKey: ['boosters', 'admin-notes'] as const,
    queryFn: listBoosterAdminNotes,
  })
}

export function useSetBoosterAdminNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setBoosterAdminNote,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['boosters', 'admin-notes'] }),
  })
}
