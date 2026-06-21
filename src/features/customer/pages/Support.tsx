import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, HeadphonesIcon } from 'lucide-react'
import { Button, Card, TicketStatusBadge, TicketPriorityBadge, EmptyState } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { timeAgo } from '@/lib/utils'
import type { SupportTicket } from '@/types'
import { CreateTicketModal } from '../components/CreateTicketModal'

export function SupportPage() {
  const { profile } = useAuthStore()
  const [showCreate, setShowCreate] = useState(false)

  const { data: tickets, isLoading, refetch } = useQuery({
    queryKey: ['tickets', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('customer_id', profile!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as SupportTicket[]
    },
    enabled: !!profile?.id,
  })

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Suporte</h1>
          <p className="text-sm text-ink-secondary mt-1">Precisa de ajuda? Abra um ticket e responderemos rapidamente.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} leftIcon={<Plus className="h-4 w-4" />}>
          Novo Ticket
        </Button>
      </div>

      {isLoading ? null : !tickets?.length ? (
        <EmptyState
          icon={HeadphonesIcon}
          title="Sem tickets de suporte"
          description="Tem algum problema ou pergunta? Abra um ticket e nossa equipe vai te ajudar."
          action={{ label: 'Abrir Ticket', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Link key={ticket.id} to={`/support/${ticket.id}`}>
              <Card className="hover:border-brand/20 hover:shadow-card-hover transition-all cursor-pointer">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{ticket.subject}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{timeAgo(ticket.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TicketPriorityBadge priority={ticket.priority} />
                    <TicketStatusBadge status={ticket.status} />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTicketModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch() }}
        />
      )}
    </div>
  )
}
