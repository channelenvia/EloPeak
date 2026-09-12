import { useParams, Link } from 'react-router-dom'
import { ShoppingBag, Star, Wallet, ClipboardList } from 'lucide-react'
import { Card, DetailPageHeader, Pagination, Skeleton, EmptyState, StarRating } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { formatDate, timeAgo } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminCustomerDetail, useAdminCustomerOrders, useAdminCustomerReviews } from '@/api/customers'
import { usePagedList } from '@/hooks/usePagedList'

export function AdminCustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()

  const { data: customer, isLoading } = useAdminCustomerDetail(id)
  const { data: orders, isLoading: loadingOrders } = useAdminCustomerOrders(customer?.user_id)
  const { data: reviews, isLoading: loadingReviews } = useAdminCustomerReviews(customer?.user_id)
  const ordersPage = usePagedList(orders ?? [], 20)
  const reviewsPage = usePagedList(reviews ?? [], 20)

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (!customer) return <p className="text-ink-muted">Cliente não encontrado.</p>

  return (
    <div className="space-y-6">
      <DetailPageHeader
        backHref="/admin/customers"
        title={customer.profiles?.username ?? 'Cliente'}
        subtitle={<span className="text-xs text-ink-muted">{customer.profiles?.email ?? '—'}</span>}
      />

      {/* Controle */}
      <Card padding="md">
        <h3 className="text-base font-semibold text-ink mb-3">Controle</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Pedidos', value: customer.total_orders, icon: ShoppingBag, color: 'text-brand bg-brand/10' },
            { label: 'Total Gasto', value: currency(customer.total_spent), icon: Wallet, color: 'text-success bg-success/10' },
            { label: 'Avaliações Dadas', value: reviews?.length ?? 0, icon: Star, color: 'text-warning bg-warning/10' },
            { label: 'Cliente desde', value: formatDate(customer.profiles?.created_at ?? customer.created_at), icon: ClipboardList, color: 'text-ink-secondary bg-bg-raised' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="text-center">
              <div className={`h-9 w-9 rounded-xl ${color} flex items-center justify-center mx-auto mb-2`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-base font-bold text-ink">{value}</p>
              <p className="text-[10px] text-ink-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Pedidos */}
      <div>
        <h3 className="text-base font-semibold text-ink mb-3">Pedidos</h3>
        {loadingOrders ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)}
          </div>
        ) : !orders?.length ? (
          <Card padding="none"><EmptyState icon={ShoppingBag} title="Nenhum pedido ainda" /></Card>
        ) : (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {ordersPage.pageItems.map((order) => (
              <CustomerOrderCard key={order.id} order={order} currency={currency} basePath="/admin/orders" viewerRole="admin" />
            ))}
          </div>
          <Pagination page={ordersPage.page} hasNextPage={ordersPage.hasNextPage} onPrev={ordersPage.onPrev} onNext={ordersPage.onNext} />
          </>
        )}
      </div>

      {/* Avaliações dadas */}
      <div>
        <h3 className="text-base font-semibold text-ink mb-3">Avaliações Dadas</h3>
        {loadingReviews ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
          </div>
        ) : !reviews?.length ? (
          <Card padding="none"><EmptyState icon={Star} title="Nenhuma avaliação ainda" /></Card>
        ) : (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {reviewsPage.pageItems.map((review) => (
              <Link key={review.id} to={`/admin/orders/${review.order_id}`}>
                <Card variant="interactive" padding="md" className="h-full flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <StarRating rating={review.rating} size="sm" />
                    <span className="text-[10px] text-ink-muted">{timeAgo(review.created_at)}</span>
                  </div>
                  {review.content && <p className="text-xs text-ink-secondary line-clamp-3">{review.content}</p>}
                  <span className="text-[10px] text-brand mt-auto pt-1">
                    Ver pedido #{review.order_id.slice(0, 8).toUpperCase()}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
          <Pagination page={reviewsPage.page} hasNextPage={reviewsPage.hasNextPage} onPrev={reviewsPage.onPrev} onNext={reviewsPage.onNext} />
          </>
        )}
      </div>
    </div>
  )
}
