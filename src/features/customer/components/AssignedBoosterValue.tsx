import { Link } from 'react-router-dom'
import { boosterProfilePath } from '@/lib/boosterPath'
import { useAssignedBooster } from '@/api/boosters'
import { Skeleton } from '@/components/ui'
import type { Order } from '@/types'

export function AssignedBoosterValue({ order }: { order: Order }) {
  // Antes de aceito, mostra o booster preferido/exclusivo (se houver) em vez
  // de "Não associado" -- o cliente já sabe pra quem o pedido foi vinculado.
  const boosterId = order.assigned_booster_id ?? order.preferred_booster_id
  const { data: booster, isLoading } = useAssignedBooster(boosterId)
  if (isLoading) return <Skeleton className="h-5 w-20 mx-auto" />
  if (!booster) return <span>Não associado</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link to={boosterProfilePath(booster)} className="text-brand hover:underline">
        {booster.display_name}
      </Link>
      {!order.assigned_booster_id && (
        <span className={`text-2xs font-bold uppercase ${order.reassigned_by_admin ? 'text-rank-master' : 'text-accent'}`}>
          {order.reassigned_by_admin ? 'Reatribuído' : 'Exclusivo'}
        </span>
      )}
    </span>
  )
}
