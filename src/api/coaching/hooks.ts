import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import {
  getBoosterServiceById, listAllActiveCoachingPackages, listCoachBoosterInfo, listOwnCoachingPackages,
  listPublicCoachingPackages,
} from './queries'
import { createCoachingPackage, deleteCoachingPackage, toggleCoachingPackageActive, updateCoachingPackage } from './mutations'

export function useOwnCoachingPackages(boosterId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.services(boosterId ?? ''),
    queryFn: () => listOwnCoachingPackages(boosterId!),
    enabled: !!boosterId,
  })
}

export function usePublicCoachingPackages(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boosters.services(boosterUserId ?? '').concat(['public']),
    queryFn: () => listPublicCoachingPackages(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export function useAllCoachingPackages() {
  return useQuery({
    queryKey: queryKeys.coaching.packages(),
    queryFn: () => listAllActiveCoachingPackages(),
  })
}

export function useBoosterServiceDetails(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.coaching.boosterService(id ?? ''),
    queryFn: () => getBoosterServiceById(id!),
    enabled: !!id,
  })
}

export function useCoachBoosterInfo(boosterIds: string[]) {
  return useQuery({
    queryKey: queryKeys.coaching.packages({ boosterIds }),
    queryFn: () => listCoachBoosterInfo(boosterIds),
    enabled: boosterIds.length > 0,
  })
}

export function useCoachingPackageMutations(boosterId: string | undefined) {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.boosters.services(boosterId ?? '') })

  return {
    create: useMutation({ mutationFn: createCoachingPackage, onSuccess: invalidate }),
    update: useMutation({ mutationFn: updateCoachingPackage, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: deleteCoachingPackage, onSuccess: invalidate }),
    toggleActive: useMutation({ mutationFn: toggleCoachingPackageActive, onSuccess: invalidate }),
  }
}
