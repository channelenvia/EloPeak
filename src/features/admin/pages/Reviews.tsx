import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Eye, EyeOff } from 'lucide-react'
import { Button, EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import type { Review } from '@/types'

export function AdminReviewsPage() {
  const queryClient = useQueryClient()

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['admin-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as Review[]
    },
  })

  const toggleVisibility = useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) => {
      const { data, error } = await supabase.rpc('moderate_review', { p_review_id: id, p_is_public: isPublic })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao moderar avaliação')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reviews'] }),
  })

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">Moderação de Avaliações</h1>
      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !reviews?.length ? <EmptyState icon={Star} title="Nenhuma avaliação ainda" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Conteúdo</TableHead>
                <TableHead>Público</TableHead>
                <TableHead>Moderado</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`h-3 w-3 ${i < r.rating ? 'fill-accent text-accent' : 'text-ink-muted'}`} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-ink-secondary max-w-xs truncate">{r.content ?? '—'}</p>
                  </TableCell>
                  <TableCell>
                    <span className={`badge text-xs ${r.is_public ? 'text-success bg-success/10' : 'text-ink-muted bg-bg-overlay'}`}>
                      {r.is_public ? 'Público' : 'Oculto'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`badge text-xs ${r.is_moderated ? 'text-info bg-info/10' : 'text-warning bg-warning/10'}`}>
                      {r.is_moderated ? 'Sim' : 'Pendente'}
                    </span>
                  </TableCell>
                  <TableCell>{timeAgo(r.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      size="xs"
                      variant="ghost"
                      leftIcon={r.is_public ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      onClick={() => toggleVisibility.mutate({ id: r.id, isPublic: !r.is_public })}
                    >
                      {r.is_public ? 'Ocultar' : 'Publicar'}
                    </Button>
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
