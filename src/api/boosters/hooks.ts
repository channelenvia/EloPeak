import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import {
  getAdminBoosterDetail, getAssignedBoosterProfile, getBoosterAccessState, getBoosterPerformanceByRank, getOwnBoosterDisplayName,
  getOwnBoosterTop3Status, getOwnProfessionalProfile, getPublicBooster, getTopBoosters, listAdminBoosters,
  listBoosterAdminNotes, listBoostersPerformance, listBoostersWithSlots, listBoosterNames, listPublicBoosters,
  getOwnBoosterSlotEligibility, getOwnBoosterFullProfile,
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

export function useOwnBoosterSlotEligibility(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.slotEligibility(userId ?? ''),
    queryFn: () => getOwnBoosterSlotEligibility(userId!),
    enabled: !!userId,
  })
}

export function useOwnBoosterFullProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.ownFullProfile(userId ?? ''),
    queryFn: () => getOwnBoosterFullProfile(userId!),
    enabled: !!userId,
  })
}

export function useAssignedBooster(boosterUserId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.assignedProfile(boosterUserId ?? ''),
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
    queryKey: queryKeys.boosters.ownDisplayName(userId ?? ''),
    queryFn: () => getOwnBoosterDisplayName(userId!),
    enabled: !!userId,
  })
}

export function useOwnBoosterTop3Status(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.ownTop3Status(userId ?? ''),
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
    queryKey: queryKeys.boosters.performance(boosterUserIds),
    queryFn: () => listBoostersPerformance(boosterUserIds),
    enabled: boosterUserIds.length > 0,
    staleTime: 60_000,
  })
}

export function useBoosterPerformanceByRank(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.performanceByRank(boosterUserId ?? ''),
    queryFn: () => getBoosterPerformanceByRank(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export function useTopBoosters(limit: number) {
  const query = useQuery({
    queryKey: queryKeys.boosters.top(limit),
    queryFn: () => getTopBoosters({ limit }),
    staleTime: 60_000,
  })
  useRealtimeInvalidate({
    channel: `top-boosters-${limit}`,
    table: 'booster_profile_events',
    event: 'INSERT',
    queryKeys: [queryKeys.boosters.top(limit)],
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

// Picker de "Reatribuir booster" (AdminOrderDetailPage) -- só busca quando o
// modal está aberto (enabled), pra não carregar todos os boosters toda vez
// que a página de detalhes do pedido monta.
export function useBoostersWithSlots(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.boosters.slots(),
    queryFn: listBoostersWithSlots,
    enabled,
  })
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

export function useBoosterNames(boosterUserIds: string[]) {
  return useQuery({
    queryKey: queryKeys.boosters.names(boosterUserIds),
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
      // ['boosters','public'] invalidado antes daqui não corresponde a
      // nenhuma query real (a chave de fato usada pela listagem pública é
      // publicList() -- 'public-list', não 'public') -- invalidação morta
      // sobrando de um rename, removida; a chamada abaixo já cobre a lista.
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.publicList() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.top() })
    },
  })
}

export function useAdminApproveBooster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminApproveBooster,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.all }),
  })
}

export function useExpelBooster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: expelBooster,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.all }),
  })
}

export function useBoosterAdminNotes() {
  return useQuery({
    queryKey: queryKeys.boosters.adminNotes(),
    queryFn: listBoosterAdminNotes,
  })
}

export function useSetBoosterAdminNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setBoosterAdminNote,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.adminNotes() }),
  })
}
