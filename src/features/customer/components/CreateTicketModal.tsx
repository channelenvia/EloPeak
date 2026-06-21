import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { Button, FormField, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const schema = z.object({
  subject: z.string().min(5, 'O assunto deve ter pelo menos 5 caracteres').max(200),
  message: z.string().min(10, 'Descreva seu problema com mais detalhes').max(2000),
})

type FormData = z.infer<typeof schema>

interface Props {
  onClose: () => void
  onCreated: () => void
  orderId?: string
}

export function CreateTicketModal({ onClose, onCreated, orderId }: Props) {
  const { profile } = useAuthStore()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        customer_id: profile!.id,
        order_id: orderId ?? null,
        status: 'open',
        priority: 'medium',
        subject: data.subject,
      })
      .select()
      .single()

    if (error || !ticket) return

    // Add first message
    await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_id: profile!.id,
      sender_role: profile!.role,
      content: data.message,
      is_internal: false,
    })

    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md card p-6 animate-scale-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-ink">Novo Ticket de Suporte</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-bg-elevated">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Assunto" error={errors.subject?.message} required>
            <Input
              placeholder="ex: Meu pedido não iniciou após 2 horas"
              error={!!errors.subject}
              {...register('subject')}
            />
          </FormField>

          <FormField label="Mensagem" error={errors.message?.message} required>
            <textarea
              placeholder="Descreva seu problema em detalhes..."
              className={`input-base min-h-[120px] resize-none ${errors.message ? 'input-error' : ''}`}
              {...register('message')}
            />
          </FormField>

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting} className="flex-1">
              Enviar Ticket
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
