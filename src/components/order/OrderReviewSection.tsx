import { useState } from 'react'
import { Star } from 'lucide-react'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useOwnReview, useCreateReview } from '@/api/reviews'
import type { Order } from '@/types'

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          className="p-0.5"
          aria-label={`${i} estrela${i === 1 ? '' : 's'}`}
        >
          <Star className={cn('h-7 w-7 transition-colors', (hover || value) >= i ? 'text-warning fill-warning' : 'text-bg-overlay')} />
        </button>
      ))}
    </div>
  )
}

// Só existe pra pedidos 'completed' -- a policy reviews_customer_insert
// (migration archive 137) exige isso no banco também, então tentar antes
// sempre falharia. Uma review por pedido (order_id é unique em reviews).
//
// Rende como pill compacta ao lado do código do pedido (ver OrderPageHeader
// `statusActions`) em vez de um card cheio na página -- antes existiam os
// dois ao mesmo tempo (duplicado).
export function OrderReviewSection({ order }: { order: Order }) {
  const isCompleted = order.status === 'completed'
  const { data: review, isLoading } = useOwnReview(isCompleted ? order.id : undefined)
  const createReview = useCreateReview(order.id)
  const [showModal, setShowModal] = useState(false)
  const [rating, setRating] = useState(0)
  const [content, setContent] = useState('')

  if (!isCompleted || isLoading) return null

  function closeModal() {
    setShowModal(false)
    setRating(0)
    setContent('')
  }

  if (review) {
    return (
      <span
        title={review.content ?? undefined}
        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30"
      >
        <Star className="h-3 w-3 fill-warning" />
        Avaliado · {review.rating}/5
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
      >
        <Star className="h-3 w-3" />
        Avaliar booster
      </button>

      <Modal
        open={showModal}
        onOpenChange={(open) => { if (!open) closeModal() }}
        title="Avalie seu booster"
        description="Conte como foi sua experiência com o serviço."
      >
        <div className="flex justify-center py-1">
          <StarPicker value={rating} onChange={setRating} />
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Deixe um comentário (opcional)..."
          className="input-base w-full min-h-[100px] resize-none text-sm"
        />
        {createReview.isError && (
          <ErrorAlert
            className="mt-2"
            message={createReview.error instanceof Error ? createReview.error.message : 'Erro ao enviar avaliação'}
          />
        )}
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={closeModal}>Cancelar</Button>
          <Button
            variant="success"
            loading={createReview.isPending}
            disabled={rating === 0}
            onClick={() => createReview.mutate(
              { boosterId: order.assigned_booster_id, rating, content },
              { onSuccess: closeModal },
            )}
          >
            Enviar avaliação
          </Button>
        </div>
      </Modal>
    </>
  )
}
