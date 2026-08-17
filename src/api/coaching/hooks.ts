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
  const servicesKey = queryKeys.boosters.services(boosterId ?? '')
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: servicesKey }),
      queryClient.invalidateQueries({ queryKey: queryKeys.coaching.packages() }),
    ])
  }

  return {
    create: useMutation({
      mutationFn: createCoachingPackage,
      onSuccess: (created) => {
        queryClient.setQueryData(servicesKey, (current: import('@/types').BoosterService[] | undefined) =>
          current ? [...current, created] : [created],
        )
        return invalidate()
      },
    }),
    update: useMutation({
      mutationFn: updateCoachingPackage,
      onSuccess: (updated) => {
        queryClient.setQueryData(servicesKey, (current: import('@/types').BoosterService[] | undefined) =>
          current?.map(service => service.id === updated.id ? updated : service),
        )
        return invalidate()
      },
    }),
    remove: useMutation({
      mutationFn: deleteCoachingPackage,
      onSuccess: (deletedId) => {
        queryClient.setQueryData(servicesKey, (current: import('@/types').BoosterService[] | undefined) =>
          current?.filter(service => service.id !== deletedId),
        )
        return invalidate()
      },
    }),
    toggleActive: useMutation({
      mutationFn: toggleCoachingPackageActive,
      onSuccess: (updated) => {
        queryClient.setQueryData(servicesKey, (current: import('@/types').BoosterService[] | undefined) =>
          current?.map(service => service.id === updated.id ? updated : service),
        )
        return invalidate()
      },
    }),
  }
}
