import { useState } from 'react'
import { Eye, EyeOff, Star } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorAlert, PageHeader, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { useAdminReviews, useModerateReview, type AdminReview } from '@/api/reviews'
import { ReasonPromptModal } from '../components/AdminOrderModals'

// H-20: moderacao de avaliacoes. Ocultar tira a nota do rating/score do booster e da pagina publica;
// toda decisao grava motivo e auditoria (admin_moderate_review).
export function AdminReviewsPage() {
  const { data: reviews, isLoading, isError, error } = useAdminReviews()
  const moderate = useModerateReview()
  const [target, setTarget] = useState<{ review: AdminReview; makePublic: boolean } | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader title="Avaliações" description="Avaliações dos clientes. Oculte as ofensivas ou inadequadas — a nota deixa de contar e o texto sai da página pública." />

      {isError && <ErrorAlert message={error instanceof Error ? error.message : 'Não foi possível carregar as avaliações.'} />}

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : !isError && !reviews?.length ? (
        <EmptyState icon={Star} title="Nenhuma avaliação ainda" description="As avaliações dos clientes aparecem aqui assim que forem enviadas." />
      ) : (
        <div className="space-y-3">
          {(reviews ?? []).map((review) => (
            <Card key={review.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}</span>
                  <Badge variant={review.is_public ? 'success' : 'warning'} size="tag">{review.is_public ? 'Pública' : 'Oculta'}</Badge>
                  <span className="text-xs text-ink-muted">{formatDateTime(review.created_at)} · pedido {review.order_id.slice(0, 8).toUpperCase()}</span>
                </div>
                <p className="text-sm text-ink-secondary whitespace-pre-wrap break-words">{review.content ?? <em>Sem texto</em>}</p>
                {review.admin_note && <p className="text-xs text-ink-muted">Nota do admin: {review.admin_note}</p>}
              </div>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={review.is_public ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                onClick={() => setTarget({ review, makePublic: !review.is_public })}
              >
                {review.is_public ? 'Ocultar' : 'Publicar'}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <ReasonPromptModal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.makePublic ? 'Publicar avaliação' : 'Ocultar avaliação'}
        description={target?.makePublic
          ? 'A avaliação volta a contar na nota do booster e aparece na página pública.'
          : 'A avaliação deixa de contar na nota do booster e some da página pública.'}
        confirmLabel={target?.makePublic ? 'Publicar' : 'Ocultar'}
        variant={target?.makePublic ? 'primary' : 'danger'}
        isPending={moderate.isPending}
        error={moderate.error}
        onConfirm={(note, done) => {
          if (!target) return
          moderate.mutate({ reviewId: target.review.id, isPublic: target.makePublic, note }, { onSuccess: () => { done(); setTarget(null) } })
        }}
      />
    </div>
  )
}
