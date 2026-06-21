import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Send, Play, Pause, CheckCircle2, Trophy, XCircle, AlertTriangle } from 'lucide-react'
import { Button, Card, OrderStatusBadge } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatRank } from '@/lib/utils'
import type { Order, OrderMessage, OrderStatus, OrderDropRequest } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [dropReason, setDropReason] = useState('')
  const [showDropModal, setShowDropModal] = useState(false)
  const { t } = useTranslation()
  const currency = useCurrency()

  const STATUS_ACTIONS: { from: OrderStatus[]; to: OrderStatus; label: string; icon: React.ElementType; variant: 'primary' | 'secondary' | 'success' | 'danger' }[] = [
    { from: ['assigned'], to: 'in_progress', label: t('booster.job.startOrder'), icon: Play, variant: 'primary' },
    { from: ['in_progress'], to: 'paused', label: t('booster.job.pause'), icon: Pause, variant: 'secondary' },
    { from: ['paused'], to: 'in_progress', label: t('booster.job.resume'), icon: Play, variant: 'primary' },
    { from: ['in_progress', 'paused'], to: 'awaiting_customer', label: t('booster.job.markComplete'), icon: CheckCircle2, variant: 'success' as const },
  ]

  const { data: order } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as unknown as Order
    },
    enabled: !!id,
  })

  const { data: pendingDrop } = useQuery({
    queryKey: ['drop-request', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_drop_requests')
        .select('*')
        .eq('order_id', id!)
        .eq('status', 'pending')
        .maybeSingle()
      if (error) throw error
      return data as OrderDropRequest | null
    },
    enabled: !!id,
  })

  const { data: messages } = useQuery({
    queryKey: ['order-messages', id],
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const updateStatus = useMutation({
    mutationFn: async (newStatus: OrderStatus) => {
      const { data, error } = await supabase.rpc('update_order_status', {
        p_order_id: id!,
        p_new_status: newStatus,
      })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao atualizar status')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
    },
  })

  const logMatchResult = useMutation({
    mutationFn: async ({ wins, losses }: { wins: number; losses: number }) => {
      const { data, error } = await supabase.rpc('log_match_result', {
        p_order_id: id!,
        p_wins: wins,
        p_losses: losses,
      })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao registrar resultado')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  })

  const requestDrop = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc('request_order_drop', {
        p_order_id: id!,
        p_reason: reason,
      })
      if (error) throw error
      const result = data as { success: boolean; penalty_pct?: number; penalty_amount?: number; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao solicitar drop')
      return result
    },
    onSuccess: () => {
      setShowDropModal(false)
      setDropReason('')
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['drop-request', id] })
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
      queryClient.invalidateQueries({ queryKey: ['order-messages', id] })
    },
  })

  if (!order) return null

  const availableActions = STATUS_ACTIONS.filter(a => a.from.includes(order.status))

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/booster/jobs"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink">#{order.id.slice(0, 8).toUpperCase()}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Order info */}
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-4">{t('booster.job.details')}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><p className="text-xs text-ink-muted">{t('booster.job.server')}</p><p className="text-sm font-semibold text-ink">{order.server}</p></div>
              <div><p className="text-xs text-ink-muted">{t('booster.job.queue')}</p><p className="text-sm font-semibold text-ink">{order.queue_type === 'solo_duo' ? t('booster.job.soloQueue') : t('booster.job.flexQueue')}</p></div>
              {order.current_rank && (
                <div>
                  <p className="text-xs text-ink-muted">{t('booster.job.from')}</p>
                  <p className="text-sm font-semibold text-ink">{formatRank((order.current_rank as { tier: string }).tier as never, (order.current_rank as { division: string }).division)}</p>
                </div>
              )}
              {order.target_rank && (
                <div>
                  <p className="text-xs text-ink-muted">{t('booster.job.to')}</p>
                  <p className="text-sm font-semibold text-ink">{formatRank((order.target_rank as { tier: string }).tier as never, (order.target_rank as { division: string }).division)}</p>
                </div>
              )}
            </div>
            {order.customer_notes && (
              <div className="bg-bg-elevated rounded-xl p-3">
                <p className="text-xs text-ink-muted mb-1">{t('booster.job.customerNotes')}</p>
                <p className="text-sm text-ink-secondary">{order.customer_notes}</p>
              </div>
            )}
          </Card>

          {/* Chat */}
          <Card padding="none" className="flex flex-col">
            <div className="p-4 border-b border-bg-elevated text-sm font-semibold text-ink">{t('booster.job.chat')}</div>
            <div className="overflow-y-auto p-4 space-y-3 min-h-[250px] max-h-[350px]">
              {messages?.map((msg) => {
                const isMe = msg.sender_id === profile?.id
                return (
                  <div key={msg.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-brand text-white rounded-tr-sm' : 'bg-bg-elevated text-ink rounded-tl-sm'}`}>
                      {msg.content}
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t border-bg-elevated p-3 flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && message.trim()) { e.preventDefault(); sendMessage.mutate(message.trim()) } }}
                placeholder={t('booster.job.messagePlaceholder')}
                className="input-base flex-1 py-2 text-sm"
              />
              <Button size="icon" onClick={() => message.trim() && sendMessage.mutate(message.trim())} loading={sendMessage.isPending}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </div>

        {/* Actions panel */}
        <div className="space-y-4">
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink mb-3">{t('booster.job.earnings')}</h3>
            <p className="text-2xl font-bold text-success">{currency(order.total_price * 0.75)}</p>
            <p className="text-xs text-ink-muted mt-0.5">{t('booster.job.yourCutOf', { amount: currency(order.total_price) })}</p>
          </Card>

          {/* Match result counters */}
          {(order.status === 'in_progress' || order.status === 'paused') && (
            <Card padding="md">
              <h3 className="text-sm font-semibold text-ink mb-3">Resultados da partida</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="text-center">
                  <p className="text-xs text-ink-muted mb-1">Vitórias</p>
                  <p className="text-2xl font-bold text-success">{order.wins_played}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-ink-muted mb-1">Derrotas</p>
                  <p className="text-2xl font-bold text-danger">{order.losses_played}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  className="flex-1"
                  leftIcon={<Trophy className="h-3.5 w-3.5" />}
                  loading={logMatchResult.isPending}
                  onClick={() => logMatchResult.mutate({ wins: order.wins_played + 1, losses: order.losses_played })}
                >
                  +1 Win
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="flex-1"
                  leftIcon={<XCircle className="h-3.5 w-3.5" />}
                  loading={logMatchResult.isPending}
                  onClick={() => logMatchResult.mutate({ wins: order.wins_played, losses: order.losses_played + 1 })}
                >
                  +1 Loss
                </Button>
              </div>
            </Card>
          )}

          {availableActions.length > 0 && (
            <Card padding="md">
              <h3 className="text-sm font-semibold text-ink mb-3">{t('booster.job.actions')}</h3>
              <div className="space-y-2">
                {availableActions.map(({ to, label, icon: Icon, variant }) => (
                  <Button
                    key={to}
                    variant={variant === 'success' ? 'success' : variant}
                    className="w-full"
                    leftIcon={<Icon className="h-4 w-4" />}
                    loading={updateStatus.isPending}
                    onClick={() => updateStatus.mutate(to)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </Card>
          )}

          {/* Drop request */}
          {order.status === 'in_progress' && !pendingDrop && (
            <Button
              variant="danger-ghost"
              className="w-full"
              leftIcon={<AlertTriangle className="h-4 w-4" />}
              onClick={() => setShowDropModal(true)}
            >
              Solicitar Drop
            </Button>
          )}

          {(order.status === 'drop_requested' || pendingDrop) && (
            <div className="card p-3 border border-warning/30 bg-warning/5">
              <div className="flex items-center gap-2 text-warning text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Solicitação de drop pendente
              </div>
              <p className="text-xs text-ink-secondary mt-1">Aguardando aprovação do admin.</p>
            </div>
          )}
        </div>
      </div>

      {/* Drop request modal */}
      {showDropModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Solicitar Drop de Pedido
            </h2>
            <p className="text-sm text-ink-secondary">
              Sua solicitação será enviada ao admin para aprovação. Com {order.wins_played} vitória(s), a penalidade é de{' '}
              <span className="font-bold text-warning">
                {order.wins_played === 0 ? '0%' : order.wins_played <= 2 ? '10%' : '20%'}
              </span>{' '}
              do valor do pedido.
            </p>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
                Motivo <span className="text-danger">*</span>
              </label>
              <textarea
                value={dropReason}
                onChange={(e) => setDropReason(e.target.value)}
                placeholder="Descreva o motivo para abandonar o pedido..."
                className="input-base w-full min-h-[100px] resize-none text-sm"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => { setShowDropModal(false); setDropReason('') }}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={requestDrop.isPending}
                disabled={dropReason.trim().length < 10}
                onClick={() => requestDrop.mutate(dropReason.trim())}
              >
                Enviar Solicitação
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
