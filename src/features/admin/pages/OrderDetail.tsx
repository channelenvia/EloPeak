import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button, Card, OrderStatusBadge } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import type { Order, OrderStatus } from '@/types'

const ADMIN_STATUS_OPTIONS: OrderStatus[] = [
  'awaiting_assignment', 'assigned', 'in_progress', 'paused',
  'awaiting_customer', 'completed', 'disputed', 'refunded', 'canceled',
]

export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const currency = useCurrency()

  const { data: order } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as unknown as Order
    },
    enabled: !!id,
  })

  const updateStatus = useMutation({
    mutationFn: async (newStatus: OrderStatus) => {
      const { data, error } = await supabase.rpc('admin_override_order_status', {
        p_order_id: id!,
        p_new_status: newStatus,
      })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao atualizar status')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-order', id] }),
  })

  if (!order) return null

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link to="/admin/orders"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink">Pedido #{order.id.slice(0, 8).toUpperCase()}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-xs text-ink-muted mt-0.5">Criado em {formatDateTime(order.created_at)}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-4">Detalhes do Pedido</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['ID do Cliente', order.customer_id.slice(0, 12) + '...'],
                ['Serviço', (order.service_id as string).replace(/_/g, ' ')],
                ['Servidor', order.server],
                ['Fila', order.queue_type === 'solo_duo' ? 'Solo/Duo' : 'Flex'],
                ['Preço Base', currency(order.base_price)],
                ['Extras', currency(order.extras_price)],
                ['Total', currency(order.total_price)],
                ['Booster', order.assigned_booster_id ? order.assigned_booster_id.slice(0, 12) + '...' : 'Não atribuído'],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <p className="text-xs text-ink-muted">{l as string}</p>
                  <p className="text-sm font-semibold text-ink capitalize">{v as string}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Status override */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-ink-secondary" />
              Alterar Status
            </h3>
            <div className="space-y-1.5">
              {ADMIN_STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus.mutate(s)}
                  disabled={order.status === s || updateStatus.isPending}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    order.status === s
                      ? 'bg-brand-muted text-brand cursor-default'
                      : 'text-ink-secondary hover:bg-bg-elevated hover:text-ink'
                  }`}
                >
                  {s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          </Card>

          {/* Booster assignment */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-2">Booster</h3>
            <p className="text-xs text-ink-secondary">
              {order.assigned_booster_id ? order.assigned_booster_id.slice(0, 16) + '…' : 'Nenhum booster atribuído.'}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
