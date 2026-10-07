import { useState } from 'react'
import { ActionBar } from '@/components/ui/ActionBar'
import { Star } from 'lucide-react'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useCreateReview } from '@/api/reviews'
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
          <Star className={cn('h-7 w-7 transition-colors', (hover || value) >= i ? 'text-warning fill-warning' : 'text-ink-muted')} />
        </button>
      ))}
    </div>
  )
}

// Modal de avaliação do booster, aberto pelo badge de status de um pedido
// 'completed' (a policy reviews_customer_insert exige isso no banco também).
// Uma review por pedido (order_id é unique em reviews).
export function OrderReviewSection({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (open: boolean) => void }) {
  const createReview = useCreateReview(order.id)
  const [rating, setRating] = useState(0)
  const [content, setContent] = useState('')

  if (order.status !== 'completed') return null

  function closeModal() {
    onOpenChange(false)
    setRating(0)
    setContent('')
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(next) => { if (!next) closeModal() }}
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
        <ActionBar>
          <Button disabled={createReview.isPending} variant="secondary" onClick={closeModal}>Cancelar</Button>
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
        </ActionBar>
      </Modal>
    </>
  )
}
