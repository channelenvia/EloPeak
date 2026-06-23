import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, MessageCircle, Send, Clock } from 'lucide-react'
import { Button, Card, OrderStatusBadge, Avatar } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime, timeAgo, getServiceLabel, ORDER_STATUS_LABEL } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import type { Order, OrderStatus, OrderMessage, OrderStatusHistory } from '@/types'

const ADMIN_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'awaiting_assignment', label: 'Esperando Booster' },
  { value: 'assigned',            label: 'Booster Atribuído' },
  { value: 'in_progress',        label: 'Em Andamento' },
  { value: 'paused',             label: 'Pausado' },
  { value: 'awaiting_customer',  label: 'Aguardando Cliente' },
  { value: 'completed',          label: 'Concluído' },
  { value: 'disputed',           label: 'Disputado' },
  { value: 'refunded',           label: 'Reembolsado' },
  { value: 'canceled',           label: 'Cancelado' },
]

const CLOSED_STATUSES: OrderStatus[] = ['completed', 'canceled', 'refunded', 'disputed']

export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()
  const currency = useCurrency()
  const [message, setMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: order } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as unknown as Order
    },
    enabled: !!id,
    refetchInterval: 15000,
  })

  const { data: messages } = useQuery({
    queryKey: ['admin-order-messages', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_messages')
        .select('*')
        .eq('order_id', id!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as OrderMessage[]
    },
    enabled: !!id,
    refetchInterval: 5000,
  })

  const { data: history } = useQuery({
    queryKey: ['admin-order-history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_status_history')
        .select('*')
        .eq('order_id', id!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as OrderStatusHistory[]
    },
    enabled: !!id,
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-order', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-order-history', id] })
    },
  })

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.from('order_messages').insert({
        order_id: id!,
        sender_id: profile!.id,
        sender_role: profile!.role,
        content,
        is_read: false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMessage('')
      queryClient.invalidateQueries({ queryKey: ['admin-order-messages', id] })
    },
  })

  if (!order) return null

  const isClosed = CLOSED_STATUSES.includes(order.status)

  return (
    <div className="max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/admin/orders"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink">Pedido #{order.id.slice(0, 8).toUpperCase()}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-xs text-ink-muted mt-0.5">Criado em {formatDateTime(order.created_at)}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Main — detalhes + chat */}
        <div className="lg:col-span-2 space-y-5">
          {/* Detalhes */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-4">Detalhes do Pedido</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Cliente', order.customer_id.slice(0, 12) + '...'],
                ['Serviço', getServiceLabel(order.service_id as string)],
                ['Servidor', order.server],
                ['Fila', order.queue_type === 'solo_duo' ? 'Solo/Duo' : 'Flex'],
                ['Modo', order.boost_mode === 'duo' ? 'Duo Boost' : 'Solo Boost'],
                ['Base', currency(order.base_price)],
                ['Extras', currency(order.extras_price)],
                ['Total', currency(order.total_price)],
                ['Booster', order.assigned_booster_id ? order.assigned_booster_id.slice(0, 12) + '...' : 'Não atribuído'],
                ['Pag.', order.payment_status ?? '—'],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <p className="text-xs text-ink-muted">{l as string}</p>
                  <p className="text-sm font-semibold text-ink">{v as string}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Chat ao vivo (pedidos ativos) ou Transcript (pedidos encerrados) */}
          <Card padding="none" className="flex flex-col">
            <div className="flex items-center gap-2 p-4 border-b border-bg-elevated">
              <MessageCircle className="h-4 w-4 text-brand" />
              <h3 className="text-sm font-semibold text-ink">
                {isClosed ? 'Transcript do Pedido' : 'Chat ao Vivo'}
              </h3>
              <span className="ml-auto text-[10px] text-ink-muted">
                {messages?.length ?? 0} mensagens
              </span>
              {!isClosed && (
                <div className="flex items-center gap-1 text-[10px] text-success">
                  <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  ao vivo
                </div>
              )}
            </div>

            {/* Mensagens */}
            <div className={`overflow-y-auto p-4 space-y-3 ${isClosed ? 'max-h-[500px]' : 'min-h-[280px] max-h-[380px]'}`}>
              {!messages?.length ? (
                <p className="text-xs text-ink-muted text-center py-8">Sem mensagens neste pedido.</p>
              ) : isClosed ? (
                /* Transcript: lista compacta para pedidos encerrados */
                messages.map((msg) => {
                  const senderLabel =
                    msg.sender_role === 'admin' ? '[Admin]' :
                    msg.sender_role === 'booster' ? '[Booster]' : '[Cliente]'
                  return (
                    <div key={msg.id} className="flex gap-3 text-xs border-b border-bg-elevated pb-2 last:border-0">
                      <span className="text-ink-muted shrink-0 w-24">{timeAgo(msg.created_at)}</span>
                      <span className={`font-bold shrink-0 w-14 ${
                        msg.sender_role === 'admin' ? 'text-accent' :
                        msg.sender_role === 'booster' ? 'text-brand' : 'text-ink-secondary'
                      }`}>{senderLabel}</span>
                      <span className="text-ink flex-1">{msg.content}</span>
                    </div>
                  )
                })
              ) : (
                /* Chat ao vivo: bolhas para pedidos ativos */
                messages.map((msg) => {
                  const isMe = msg.sender_id === profile?.id
                  const senderLabel =
                    msg.sender_role === 'admin' ? 'Admin' :
                    msg.sender_role === 'booster' ? 'Booster' : 'Cliente'
                  return (
                    <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <Avatar name={senderLabel} size="xs" />
                      <div className={`max-w-[75%] flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-ink-muted px-1">{senderLabel}</span>
                        <div className={`px-3 py-2 rounded-2xl text-sm ${
                          isMe
                            ? 'bg-brand text-white rounded-tr-sm'
                            : msg.sender_role === 'admin'
                              ? 'bg-accent/20 text-ink rounded-tl-sm border border-accent/30'
                              : 'bg-bg-elevated text-ink rounded-tl-sm'
                        }`}>
                          {msg.content}
                        </div>
                        <span className="text-[10px] text-ink-muted">{timeAgo(msg.created_at)}</span>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input — só em pedidos ativos */}
            {!isClosed && (
              <div className="border-t border-bg-elevated p-3 flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && message.trim()) {
                      e.preventDefault()
                      sendMessage.mutate(message.trim())
                    }
                  }}
                  placeholder="Mensagem como admin (visível para cliente e booster)..."
                  className="input-base flex-1 py-2 text-sm"
                />
                <Button
                  size="icon"
                  onClick={() => message.trim() && sendMessage.mutate(message.trim())}
                  loading={sendMessage.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar — controles + histórico */}
        <div className="space-y-4">
          {/* Alterar status */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-ink-secondary" />
              Alterar Status
            </h3>
            <div className="space-y-1.5">
              {ADMIN_STATUS_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => updateStatus.mutate(value)}
                  disabled={order.status === value || updateStatus.isPending}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    order.status === value
                      ? 'bg-brand/10 text-brand cursor-default'
                      : 'text-ink-secondary hover:bg-bg-elevated hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {updateStatus.isError && (
              <p className="text-xs text-danger mt-2">
                {updateStatus.error instanceof Error ? updateStatus.error.message : 'Erro'}
              </p>
            )}
          </Card>

          {/* Histórico de status */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-ink-secondary" />
              Histórico de Status
            </h3>
            {!history?.length ? (
              <p className="text-xs text-ink-muted">Sem histórico.</p>
            ) : (
              <div className="space-y-3">
                {history.map((entry) => (
                  <div key={entry.id} className="flex gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-ink-muted mt-1.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        {ORDER_STATUS_LABEL[entry.to_status] ?? entry.to_status}
                      </p>
                      <p className="text-[10px] text-ink-muted">{timeAgo(entry.created_at)}</p>
                      {entry.reason && (
                        <p className="text-[10px] text-ink-secondary mt-0.5">{entry.reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Booster */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-2">Booster</h3>
            <p className="text-xs text-ink-secondary">
              {order.assigned_booster_id
                ? order.assigned_booster_id.slice(0, 16) + '…'
                : 'Nenhum booster atribuído.'}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
