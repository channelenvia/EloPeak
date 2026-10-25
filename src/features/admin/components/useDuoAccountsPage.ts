import { useState } from 'react'
import { usePagedList } from '@/hooks/usePagedList'
import { useCountedFilterTabs } from '@/hooks/useCountedFilterTabs'
import {
  useAdminDuoAccounts, useDuoAccountAutoRefresh, useAdminSetDuoAccountActive,
  useAdminReleaseDuoAccount, useAdminDeleteDuoAccount,
} from '@/api/duoAccounts'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import { matchesDuoSearch, matchesDuoStatus } from './duoAccountUtils'
import type { DuoStatusFilter } from './duoAccountUtils'
import { useDuoCredentialReveal } from './useDuoCredentialReveal'

export function useDuoAccountsPage() {
  const { data: accounts, isLoading, isError, error: accountsError } = useAdminDuoAccounts()
  const [search, setSearch] = useState('')
  const { value: statusFilter, onChange: setStatusFilter, countFor, filtered: statusFiltered } =
    useCountedFilterTabs(accounts, 'all' as DuoStatusFilter, matchesDuoStatus)
  const filtered = statusFiltered.filter((a) => matchesDuoSearch(a, search))
  const paging = usePagedList(filtered, 20, `${statusFilter}:${search}`)

  useDuoAccountAutoRefresh(accounts)

  const toggleActiveMutation = useAdminSetDuoAccountActive()
  const releaseMutation = useAdminReleaseDuoAccount()
  const deleteMutation = useAdminDeleteDuoAccount()
  const [releaseTarget, setReleaseTarget] = useState<AdminDuoAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminDuoAccount | null>(null)
  const reveal = useDuoCredentialReveal()

  return {
    accounts, isLoading, isError, accountsError,
    search, setSearch, statusFilter, setStatusFilter, countFor, filtered, ...paging,
    reveal,
    toggleActive: {
      isPendingFor: (id: string) => toggleActiveMutation.isPending && toggleActiveMutation.variables?.accountId === id,
      mutate: (a: AdminDuoAccount) => toggleActiveMutation.mutate({ accountId: a.id, isActive: !a.is_active }),
    },
    release: {
      target: releaseTarget,
      setTarget: setReleaseTarget,
      isPending: releaseMutation.isPending,
      isPendingFor: (id: string) => releaseMutation.isPending && releaseMutation.variables === id,
      mutate: (accountId: string) => releaseMutation.mutate(accountId, { onSuccess: () => setReleaseTarget(null) }),
    },
    remove: {
      target: deleteTarget,
      setTarget: setDeleteTarget,
      isPending: deleteMutation.isPending,
      isError: deleteMutation.isError,
      error: deleteMutation.error,
      mutate: (accountId: string) => deleteMutation.mutate(accountId, { onSuccess: () => setDeleteTarget(null) }),
    },
  }
}
