import { useState } from 'react'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { Landmark, Plus } from 'lucide-react'
import { Button, Card, EmptyState, FilterTabs, Pagination, SearchInput, ErrorAlert, SkeletonList } from '@/components/ui'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import { DuoAccountCard } from '@/features/admin/components/DuoAccountCard'
import { DuoAccountFormModal } from '@/features/admin/components/DuoAccountFormModal'
import type { DuoFormModalState } from '@/features/admin/components/DuoAccountFormModal'
import { DuoAccountHistoryModal } from '@/features/admin/components/DuoAccountHistoryModal'
import { DeleteDuoAccountModal, ReleaseDuoReservationModal } from '@/features/admin/components/DuoAccountConfirmModals'
import { useDuoAccountsPage } from '@/features/admin/components/useDuoAccountsPage'

export function AdminDuoAccountsPage() {
  const [modal, setModal] = useState<DuoFormModalState | null>(null)
  const [historyTarget, setHistoryTarget] = useState<AdminDuoAccount | null>(null)
  const p = useDuoAccountsPage()

  function renderList() {
    if (p.isLoading) {
      return (
        <CardGrid cols={4}>
          <SkeletonList count={4} className="h-56 w-full rounded-2xl" />
        </CardGrid>
      )
    }
    if (p.isError) {
      return <Card padding="md"><ErrorAlert message={p.accountsError instanceof Error ? p.accountsError.message : 'Não foi possível carregar as contas Duo.'} /></Card>
    }
    if (!p.filtered.length) {
      return (
        <Card padding="none">
          <EmptyState
            icon={Landmark}
            title={p.accounts?.length ? 'Nenhuma conta encontrada' : 'Nenhuma conta cadastrada'}
            description={p.accounts?.length ? 'Tente outro filtro ou termo de busca.' : 'Adicione contas para que boosters possam usá-las em Duo Boost.'}
          />
        </Card>
      )
    }
    return (
      <>
        <CardGrid cols={4}>
          {p.pageItems.map((a) => (
            <DuoAccountCard
              key={a.id}
              account={a}
              reveal={p.reveal.revealed[a.id]}
              isTogglingActive={p.toggleActive.isPendingFor(a.id)}
              isReleasing={p.release.isPendingFor(a.id)}
              onToggleActive={p.toggleActive.mutate}
              onToggleReveal={(acc) => void p.reveal.toggle(acc.id)}
              onEdit={(acc) => setModal({ mode: 'edit', account: acc })}
              onDelete={p.remove.setTarget}
              onRelease={p.release.setTarget}
              onHistory={setHistoryTarget}
            />
          ))}
        </CardGrid>
        <Pagination page={p.page} hasNextPage={p.hasNextPage} onPrev={p.onPrev} onNext={p.onNext} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Contas Duo Boost" description="Pool de contas smurf da empresa disponibilizadas aos boosters." actions={<><Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModal({ mode: 'create' })}>
          Adicionar conta
        </Button></>} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder="Buscar por Riot ID…"
          aria-label="Buscar por Riot ID"
          value={p.search}
          onChange={(e) => p.setSearch(e.target.value)}
        />
        <FilterTabs
          value={p.statusFilter}
          onChange={p.setStatusFilter}
          options={[
            { value: 'all', label: 'Todas', count: p.countFor('all') },
            { value: 'active', label: 'Ativas', count: p.countFor('active') },
            { value: 'inactive', label: 'Inativas', count: p.countFor('inactive') },
            { value: 'reserved', label: 'Reservadas', count: p.countFor('reserved') },
          ]}
        />
      </div>

      {renderList()}

      <DuoAccountFormModal modal={modal} onClose={() => setModal(null)} />
      <DuoAccountHistoryModal account={historyTarget} onClose={() => setHistoryTarget(null)} />
      <DeleteDuoAccountModal
        target={p.remove.target}
        isPending={p.remove.isPending}
        isError={p.remove.isError}
        error={p.remove.error}
        onClose={() => p.remove.setTarget(null)}
        onConfirm={p.remove.mutate}
      />
      <ReleaseDuoReservationModal
        target={p.release.target}
        isPending={p.release.isPending}
        onClose={() => p.release.setTarget(null)}
        onConfirm={p.release.mutate}
      />
    </div>
  )
}
