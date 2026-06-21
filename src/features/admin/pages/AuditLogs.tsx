import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import type { AuditLog } from '@/types'
import { useTranslation } from 'react-i18next'

export function AdminAuditPage() {
  const { t } = useTranslation()

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as AuditLog[]
    },
  })

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.audit.title')}</h1>
      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !logs?.length ? <EmptyState icon={Eye} title={t('admin.audit.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.audit.table.actor')}</TableHead>
                <TableHead>{t('admin.audit.table.action')}</TableHead>
                <TableHead>{t('admin.audit.table.entity')}</TableHead>
                <TableHead>{t('admin.audit.table.ip')}</TableHead>
                <TableHead>{t('admin.audit.table.time')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <div>
                      <p className="text-xs font-mono text-ink">{log.actor_id.slice(0, 8)}...</p>
                      <p className="text-[10px] text-ink-muted capitalize">{log.actor_role}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-mono bg-bg-elevated px-2 py-0.5 rounded-lg text-brand">{log.action}</span>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-ink-secondary">{log.entity_type}</p>
                    <p className="text-[10px] font-mono text-ink-muted">{log.entity_id.slice(0, 8)}...</p>
                  </TableCell>
                  <TableCell><span className="text-xs text-ink-muted font-mono">{log.ip_address ?? '—'}</span></TableCell>
                  <TableCell>{formatDateTime(log.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
