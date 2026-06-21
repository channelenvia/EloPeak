import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { Button, Card, TicketStatusBadge, TicketPriorityBadge, Avatar } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime, timeAgo } from '@/lib/utils'
import type { SupportTicket, TicketMessage } from '@/types'

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')

  const { data: ticket } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('support_tickets').select('*').eq('id', id!).single()
      if (error) throw error
      return data as SupportTicket
    },
    enabled: !!id,
  })

  const { data: messages } = useQuery({
    queryKey: ['ticket-messages', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', id!)
        .eq('is_internal', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as TicketMessage[]
    },
    enabled: !!id,
    refetchInterval: 5000,
  })

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: id!,
        sender_id: profile!.id,
        sender_role: profile!.role,
        content,
        is_internal: false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMessage('')
      queryClient.invalidateQueries({ queryKey: ['ticket-messages', id] })
    },
  })

  if (!ticket) return null

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/support"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-ink truncate">{ticket.subject}</h1>
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
          </div>
          <p className="text-xs text-ink-muted mt-0.5">Aberto em {formatDateTime(ticket.created_at)}</p>
        </div>
      </div>

      <Card padding="none" className="flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[500px]">
          {messages?.map((msg) => {
            const isCustomer = msg.sender_id === profile?.id
            const isSupport = msg.sender_role === 'admin' || msg.sender_role === 'support'
            return (
              <div key={msg.id} className={`flex gap-3 ${isCustomer ? 'flex-row-reverse' : ''}`}>
                <Avatar
                  name={isSupport ? 'Suporte' : profile?.username}
                  size="sm"
                />
                <div className={`max-w-[80%] ${isCustomer ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                    isCustomer
                      ? 'bg-brand text-white rounded-tr-sm'
                      : isSupport
                        ? 'bg-success/10 text-ink border border-success/20 rounded-tl-sm'
                        : 'bg-bg-elevated text-ink rounded-tl-sm'
                  }`}>
                    {!isCustomer && (
                      <p className="text-[10px] font-semibold text-success mb-1">Equipe de Suporte</p>
                    )}
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-ink-muted">{timeAgo(msg.created_at)}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Reply input */}
        {ticket.status !== 'closed' && ticket.status !== 'resolved' && (
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
              placeholder="Responder ao suporte..."
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

        {(ticket.status === 'closed' || ticket.status === 'resolved') && (
          <div className="border-t border-bg-elevated p-3 text-center text-sm text-ink-muted">
            Este ticket está {ticket.status === 'closed' ? 'encerrado' : 'resolvido'}.
          </div>
        )}
      </Card>
    </div>
  )
}
