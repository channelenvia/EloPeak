import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { HeadphonesIcon } from 'lucide-react'
import { EmptyState, Skeleton, TicketStatusBadge, TicketPriorityBadge } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import type { SupportTicket } from '@/types'
import { useTranslation } from 'react-i18next'

export function AdminTicketsPage() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['admin-tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as SupportTicket[]
    },
    refetchInterval: 15000,
  })

  const assignTicket = useMutation({
    mutationFn: async (ticketId: string) => {
      const { data, error } = await supabase.rpc('assign_ticket', { p_ticket_id: ticketId })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao atribuir ticket')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-tickets'] }),
  })

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.tickets.title')}</h1>
      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !tickets?.length ? <EmptyState icon={HeadphonesIcon} title={t('admin.tickets.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.tickets.table.subject')}</TableHead>
                <TableHead>{t('admin.tickets.table.priority')}</TableHead>
                <TableHead>{t('admin.tickets.table.status')}</TableHead>
                <TableHead>{t('admin.tickets.table.assigned')}</TableHead>
                <TableHead>{t('admin.tickets.table.created')}</TableHead>
                <TableHead>{t('admin.tickets.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow key={ticket.id}>
                  <TableCell>
                    <Link to={`/admin/tickets/${ticket.id}`} className="text-brand hover:underline text-sm font-medium">
                      {ticket.subject}
                    </Link>
                  </TableCell>
                  <TableCell><TicketPriorityBadge priority={ticket.priority} /></TableCell>
                  <TableCell><TicketStatusBadge status={ticket.status} /></TableCell>
                  <TableCell className="text-xs">{ticket.assigned_to ? ticket.assigned_to.slice(0, 8) + '...' : <span className="text-ink-muted">{t('admin.tickets.unassigned')}</span>}</TableCell>
                  <TableCell>{timeAgo(ticket.created_at)}</TableCell>
                  <TableCell>
                    {!ticket.assigned_to && (
                      <button
                        onClick={() => assignTicket.mutate(ticket.id)}
                        className="text-xs text-brand hover:underline"
                      >
                        {t('admin.tickets.assignToMe')}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
