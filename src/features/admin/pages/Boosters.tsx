import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Shield, CheckCircle2, XCircle, Trophy, RefreshCw, Star } from 'lucide-react'
import { Button, BoosterStatusBadge, EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { BoosterProfile } from '@/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AdminBoostersPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<string>('all')
  const { t } = useTranslation()

  const filterLabels: Record<string, string> = {
    all: t('admin.boosters.filters.all'),
    pending: t('admin.boosters.filters.pending'),
    under_review: t('admin.boosters.filters.under_review'),
    approved: t('admin.boosters.filters.approved'),
    suspended: t('admin.boosters.filters.suspended'),
  }

  const { data: boosters, isLoading } = useQuery({
    queryKey: ['admin-boosters'],
    queryFn: async () => {
      const { data, error } = await supabase.from('booster_profiles').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as BoosterProfile[]
    },
  })

  const updateBoosterStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase.rpc('approve_booster', { p_booster_id: id, p_new_status: status })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao atualizar booster')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-boosters'] }),
  })

  const toggleTop5 = useMutation({
    mutationFn: async ({ id, is_top5 }: { id: string; is_top5: boolean }) => {
      const { data, error } = await supabase.rpc('toggle_booster_top5', { p_booster_id: id, p_is_top5: is_top5 })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao atualizar Top5')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-boosters'] }),
  })

  const refreshTop5 = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('refresh_top5_boosters' as never)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-boosters'] }),
  })

  const filtered = boosters?.filter(b => filter === 'all' || b.status === filter) ?? []

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.boosters.title')}</h1>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-bg-surface border border-bg-elevated rounded-xl p-1 w-fit">
          {['all', 'pending', 'under_review', 'approved', 'suspended'].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filter === s ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>
              {filterLabels[s] ?? s}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          loading={refreshTop5.isPending}
          onClick={() => refreshTop5.mutate()}
          title="Recalcula o ranking Top5 do mês atual com base em pedidos concluídos"
        >
          Atualizar Top 5 do Mês
        </Button>
      </div>

      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !filtered.length ? <EmptyState icon={Shield} title={t('admin.boosters.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.boosters.table.name')}</TableHead>
                <TableHead>{t('admin.boosters.table.games')}</TableHead>
                <TableHead>{t('admin.boosters.table.rating')}</TableHead>
                <TableHead>{t('admin.boosters.table.completed')}</TableHead>
                <TableHead>{t('admin.boosters.table.status')}</TableHead>
                <TableHead>{t('admin.boosters.table.joined')}</TableHead>
                <TableHead>{t('admin.boosters.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/boosters/${b.id}`} className="text-brand hover:underline font-medium text-sm">
                        {b.display_name}
                      </Link>
                      {b.is_top5 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-1.5 py-0.5 uppercase tracking-wide">
                          <Trophy className="h-2.5 w-2.5" /> TOP5
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{b.games?.join(', ') || '—'}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      {b.rating.toFixed(1)}
                      <Star className="h-3 w-3 text-warning fill-warning" />
                    </span>
                  </TableCell>
                  <TableCell>{b.total_completed}</TableCell>
                  <TableCell><BoosterStatusBadge status={b.status} /></TableCell>
                  <TableCell>{formatDate(b.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      <Button
                        size="xs"
                        variant={b.is_top5 ? 'danger-ghost' : 'secondary'}
                        leftIcon={<Trophy className="h-3 w-3" />}
                        onClick={() => toggleTop5.mutate({ id: b.id, is_top5: !b.is_top5 })}
                        loading={toggleTop5.isPending}
                      >
                        {b.is_top5 ? 'Remover Top5' : 'Top5'}
                      </Button>
                      {b.status === 'pending' || b.status === 'under_review' ? (
                        <>
                          <Button size="xs" variant="success" leftIcon={<CheckCircle2 className="h-3 w-3" />}
                            onClick={() => updateBoosterStatus.mutate({ id: b.id, status: 'approved' })}>
                            {t('admin.boosters.approve')}
                          </Button>
                          <Button size="xs" variant="danger" leftIcon={<XCircle className="h-3 w-3" />}
                            onClick={() => updateBoosterStatus.mutate({ id: b.id, status: 'rejected' })}>
                            {t('admin.boosters.reject')}
                          </Button>
                        </>
                      ) : b.status === 'approved' ? (
                        <Button size="xs" variant="danger-ghost"
                          onClick={() => updateBoosterStatus.mutate({ id: b.id, status: 'suspended' })}>
                          {t('admin.boosters.suspend')}
                        </Button>
                      ) : b.status === 'suspended' ? (
                        <Button size="xs" variant="secondary"
                          onClick={() => updateBoosterStatus.mutate({ id: b.id, status: 'approved' })}>
                          {t('admin.boosters.reinstate')}
                        </Button>
                      ) : null}
                    </div>
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
