import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ShoppingBag, Star, Wallet, ClipboardList } from 'lucide-react'
import { Button, Card, OrderStatusBadge, Skeleton, EmptyState, StarRating } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { formatDate, timeAgo, getOrderServiceName } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminCustomerDetail, useAdminCustomerOrders, useAdminCustomerReviews } from '@/api/customers'

export function AdminCustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()

  const { data: customer, isLoading } = useAdminCustomerDetail(id)
  const { data: orders, isLoading: loadingOrders } = useAdminCustomerOrders(customer?.user_id)
  const { data: reviews, isLoading: loadingReviews } = useAdminCustomerReviews(customer?.user_id)

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (!customer) return <p className="text-ink-muted">Cliente não encontrado.</p>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/admin/customers"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold text-ink">{customer.profiles?.username ?? 'Cliente'}</h1>
          <p className="text-xs text-ink-muted">{customer.profiles?.email ?? '—'}</p>
        </div>
      </div>

      {/* Controle */}
      <Card padding="md">
        <h3 className="text-base font-semibold text-ink mb-3">Controle</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Pedidos', value: customer.total_orders, icon: ShoppingBag, color: 'text-brand bg-brand/10' },
            { label: 'Total Gasto', value: currency(customer.total_spent), icon: Wallet, color: 'text-success bg-success/10' },
            { label: 'Avaliações Dadas', value: reviews?.length ?? 0, icon: Star, color: 'text-warning bg-warning/10' },
            { label: 'Cliente desde', value: formatDate(customer.profiles?.created_at ?? customer.created_at), icon: ClipboardList, color: 'text-ink-secondary bg-bg-elevated' },
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
      <Card padding="md">
        <h3 className="text-base font-semibold text-ink mb-3">Pedidos</h3>
        {loadingOrders ? (
          <Skeleton className="h-32 w-full" />
        ) : !orders?.length ? (
          <EmptyState icon={ShoppingBag} title="Nenhum pedido ainda" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} clickable>
                  <TableCell>
                    <Link to={`/admin/orders/${order.id}`} className="font-mono text-brand hover:underline text-xs">
                      #{order.id.slice(0, 8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink">{getOrderServiceName(order)}</TableCell>
                  <TableCell className="font-semibold text-ink">{currency(order.total_price)}</TableCell>
                  <TableCell><OrderStatusBadge order={order} /></TableCell>
                  <TableCell>{timeAgo(order.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Avaliações dadas */}
      <Card padding="md">
        <h3 className="text-base font-semibold text-ink mb-3">Avaliações Dadas</h3>
        {loadingReviews ? (
          <Skeleton className="h-24 w-full" />
        ) : !reviews?.length ? (
          <EmptyState icon={Star} title="Nenhuma avaliação ainda" />
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="border-b border-border-subtle last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <StarRating rating={review.rating} size="sm" />
                  <span className="text-[10px] text-ink-muted">{timeAgo(review.created_at)}</span>
                </div>
                {review.content && <p className="text-xs text-ink-secondary">{review.content}</p>}
                <Link to={`/admin/orders/${review.order_id}`} className="text-[10px] text-brand hover:underline mt-1 inline-block">
                  Ver pedido #{review.order_id.slice(0, 8).toUpperCase()}
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
