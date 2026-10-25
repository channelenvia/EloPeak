import { useState } from 'react'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { useSearchParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { Button, Card, EmptyState, FilterTabs, Pagination, SearchInput, SkeletonList } from '@/components/ui'
import { usePagedList } from '@/hooks/usePagedList'
import type { Refund } from '@/types'
import { useAdminRefunds } from '@/api/admin'
import { useCountedFilterTabs } from '@/hooks/useCountedFilterTabs'
import { NewManualRefundModal } from '@/features/admin/components/NewManualRefundModal'
import { RefundCard } from '@/features/admin/components/RefundCard'
import { ReviewCasesSection } from '@/features/admin/components/ReviewCasesSection'
import { REFUND_STATUS_LABEL, matchesRefundSearch } from '@/features/admin/components/refundUtils'

export function AdminRefundsPage() {
  const [searchParams] = useSearchParams()
  // Chegando daqui via "Marcar pra reembolsar" na página do pedido (admin)
  // -- abre o formulário de reembolso manual já com o pedido preenchido, em
  // vez do admin precisar copiar/colar o UUID de novo.
  const prefilledOrderId = searchParams.get('order_id') ?? ''
  const [newRefundOpen, setNewRefundOpen] = useState(!!prefilledOrderId)
  const [refundOrderId, setRefundOrderId] = useState(prefilledOrderId)

  function openRefundFor(orderId: string) {
    setRefundOrderId(orderId)
    setNewRefundOpen(true)
  }

  const { data: refunds, isLoading } = useAdminRefunds()
  const [search, setSearch] = useState('')
  const { value: statusFilter, onChange: setStatusFilter, countFor, filtered: statusFiltered } = useCountedFilterTabs(
    refunds, 'all' as Refund['status'] | 'all', (r, s) => s === 'all' || r.status === s,
  )
  const filtered = statusFiltered.filter((r) => matchesRefundSearch(r, search))
  const { page, pageItems, hasNextPage, onPrev, onNext } = usePagedList(filtered, 20, `${statusFilter}:${search}`)

  return (
    <div className="space-y-6">
      <ReviewCasesSection onOpenRefund={openRefundFor} />

      <PageHeader eyebrow="Financeiro" title="A reembolsar" description="Reembolsos marcados por um admin e reembolsos processados pelo Mercado Pago. Depois de devolver o dinheiro, confirme no check: o pedido vira Reembolsado e o item continua aqui." actions={<><Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewRefundOpen(true)}>
          Marcar pra reembolsar
        </Button></>} />
      {(refunds?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 reembolsos mais recentes — pode haver mais.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder="Buscar por código do pedido…"
          aria-label="Buscar por código do pedido"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'Todos', count: countFor('all') },
            { value: 'pending', label: REFUND_STATUS_LABEL.pending, count: countFor('pending') },
            { value: 'succeeded', label: REFUND_STATUS_LABEL.succeeded, count: countFor('succeeded') },
            { value: 'failed', label: REFUND_STATUS_LABEL.failed, count: countFor('failed') },
          ]}
        />
      </div>

      {isLoading ? (
        <CardGrid cols={4}>
          <SkeletonList count={6} className="h-36 w-full rounded-2xl" />
        </CardGrid>
      ) : !filtered.length ? (
        <Card variant="operational" padding="none">
          <EmptyState icon={RefreshCw} title="Nenhum reembolso a fazer" />
        </Card>
      ) : (
        <>
        <CardGrid cols={4}>
          {pageItems.map((r) => (
            <RefundCard key={r.id} refund={r} />
          ))}
        </CardGrid>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}

      <NewManualRefundModal key={refundOrderId} open={newRefundOpen} onClose={() => setNewRefundOpen(false)} initialOrderId={refundOrderId} />
    </div>
  )
}
