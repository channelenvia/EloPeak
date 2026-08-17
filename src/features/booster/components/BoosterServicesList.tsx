import { useState } from 'react'
import { Plus, Package, ChevronDown } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { checkRateLimit, limits } from '@/lib/rateLimit'
import type { BoosterService } from '@/types'
import { BoosterServiceForm } from './BoosterServiceForm'
import { BoosterServiceCard } from './BoosterServiceCard'
import { EMPTY_SERVICE_FORM, serviceToForm, type ServiceFormData } from '@/features/booster/utils/boosterServiceForm'
import { useOwnCoachingPackages, useCoachingPackageMutations } from '@/api/coaching'

const MAX_SERVICES = 3

export function BoosterServicesList({ userId }: { userId: string }) {
  const [open, setOpen]                   = useState(true)
  const [adding, setAdding]               = useState(false)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [deletingId, setDeletingId]       = useState<string | null>(null)
  const [togglingId, setTogglingId]       = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const { data: services = [], isLoading } = useOwnCoachingPackages(userId)
  const { create, update, remove, toggleActive } = useCoachingPackageMutations(userId)
  const savingNew = create.isPending
  const savingEdit = update.isPending

  async function handleCreate(form: ServiceFormData) {
    if (!checkRateLimit(`svc-create-${userId}`, limits.rpcMutation)) return
    setError(null)
    create.mutate({
      boosterId: userId,
      title: form.title.trim(),
      description: form.description.trim(),
      serviceType: 'coaching',
      tempo: form.tempo.trim(),
      price: parseFloat(form.price),
      lanes: form.lanes,
      specialties: form.specialties,
      champions: form.champions,
    }, {
      onSuccess: () => setAdding(false),
      onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Erro ao salvar serviço. Tente novamente.'),
    })
  }

  async function handleUpdate(id: string, form: ServiceFormData) {
    setError(null)
    update.mutate({
      id,
      boosterId: userId,
      title: form.title.trim(),
      description: form.description.trim(),
      serviceType: 'coaching',
      tempo: form.tempo.trim(),
      price: parseFloat(form.price),
      lanes: form.lanes,
      specialties: form.specialties,
      champions: form.champions,
    }, {
      onSuccess: () => setEditingId(null),
      onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Erro ao salvar serviço. Tente novamente.'),
    })
  }

  async function handleDelete(id: string) {
    setError(null)
    setDeletingId(id)
    remove.mutate({ id, boosterId: userId }, {
      onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Erro ao excluir serviço. Tente novamente.'),
      onSettled: () => setDeletingId(null),
    })
  }

  async function handleToggleActive(service: BoosterService) {
    setError(null)
    setTogglingId(service.id)
    toggleActive.mutate({ id: service.id, boosterId: userId, isActive: !service.is_active }, {
      onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Erro ao atualizar serviço. Tente novamente.'),
      onSettled: () => setTogglingId(null),
    })
  }

  const canAdd = services.length < MAX_SERVICES

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-start gap-3 text-left"
        >
          <ChevronDown className={cn('h-4 w-4 mt-0.5 text-ink-muted shrink-0 transition-transform', !open && '-rotate-90')} />
          <div>
            <h2 className="text-base font-bold text-ink">Meus Serviços</h2>
            <p className="text-xs text-ink-secondary mt-0.5">Crie até {MAX_SERVICES} serviços de coach para seus clientes.</p>
          </div>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <span className={cn(
            'text-xs font-bold px-2.5 py-1 rounded-full',
            services.length >= MAX_SERVICES
              ? 'bg-warning/15 text-warning border border-warning/25'
              : 'bg-bg-elevated text-ink-muted',
          )}>
            {services.length}/{MAX_SERVICES}
          </span>
          {canAdd && !adding && (
            <button
              onClick={() => { setOpen(true); setAdding(true) }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold hover:bg-brand/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          )}
        </div>
      </div>

      {open && (
      <>
      {error && <p className="text-xs text-danger">{error}</p>}

      {adding && (
        <BoosterServiceForm
          initial={EMPTY_SERVICE_FORM}
          onSave={handleCreate}
          onCancel={() => setAdding(false)}
          saving={savingNew}
        />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : services.length === 0 && !adding ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center gap-4">
          <div className="h-10 w-10 rounded-2xl bg-bg-elevated flex items-center justify-center">
            <Package className="h-5 w-5 text-ink-muted" />
          </div>
          <div>
            <p className="font-semibold text-ink text-sm">Você ainda não cadastrou nenhum serviço.</p>
            <p className="text-xs text-ink-muted mt-1">Adicione até {MAX_SERVICES} serviços para oferecer aos clientes.</p>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold hover:bg-brand/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Criar primeiro serviço
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map(service =>
            editingId === service.id ? (
              <BoosterServiceForm
                key={service.id}
                initial={serviceToForm(service)}
                onSave={form => handleUpdate(service.id, form)}
                onCancel={() => setEditingId(null)}
                saving={savingEdit}
              />
            ) : (
              <BoosterServiceCard
                key={service.id}
                service={service}
                onEdit={() => { setEditingId(service.id); setAdding(false) }}
                onDelete={() => handleDelete(service.id)}
                onToggleActive={() => handleToggleActive(service)}
                deleting={deletingId === service.id}
                togglingActive={togglingId === service.id}
              />
            )
          )}
        </div>
      )}
      </>
      )}
    </div>
  )
}
