import type { Order } from '@/types'

// Só o booster para quem o pedido foi vinculado vê o rótulo — para todos os
// outros o pedido simplesmente não aparece (filtrado no available_boost_orders).
export function exclusiveTimeLeft(job: Order, myUserId?: string): string | null {
  if (!myUserId || job.preferred_booster_id !== myUserId || !job.exclusive_until) return null
  const msLeft = new Date(job.exclusive_until).getTime() - Date.now()
  if (msLeft <= 0) return null
  const hours = Math.floor(msLeft / 3_600_000)
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`
}

// Texto completo do badge "Exclusivo" -- coaching é sempre exclusivo do
// booster dono do pacote, permanentemente (nunca cai no pool geral, ver
// available_boost_orders), então não tem contagem regressiva nenhuma. Pedido
// vinculado normal ainda mostra o tempo restante da janela de 12h. Pedido
// reatribuído pelo admin usa o badge roxo próprio (reassignedBadge) em vez
// deste -- excluído aqui pra não duplicar badge no mesmo card.
export function exclusiveBadge(job: Order, myUserId?: string): string | null {
  if (!myUserId || job.preferred_booster_id !== myUserId || job.reassigned_by_admin) return null
  if (job.service_type === 'coaching') return 'Exclusivo'
  const timeLeft = exclusiveTimeLeft(job, myUserId)
  return timeLeft ? `Exclusivo · ${timeLeft}` : null
}

// Coaching reatribuído nunca expira (exclusive_until fica null pra sempre,
// ver admin_reassign_booster) -- pra qualquer outro serviço, passada a
// janela de 12h o backend (accept_boost_order) para de tratar como
// exclusivo e cai nas regras normais de slot, então o front tem que parar
// de bypassar o limite também, senão o botão "Aceitar" fica habilitado pro
// backend rejeitar em seguida.
export function isReassignedToMe(job: Order, myUserId?: string): boolean {
  if (!myUserId || job.preferred_booster_id !== myUserId || !job.reassigned_by_admin) return false
  return !job.exclusive_until || new Date(job.exclusive_until).getTime() > Date.now()
}

// Roxo em vez do amarelo de "Exclusivo" -- visualmente distingue "o admin me
// entregou esse pedido" de "eu escolhi/comprei esse pedido exclusivo". Ainda
// usa a mesma janela de 12h (accept_boost_order trata os dois com a mesma
// regra de prazo), só o rótulo e a cor mudam.
export function reassignedBadge(job: Order, myUserId?: string): string | null {
  if (!isReassignedToMe(job, myUserId)) return null
  const timeLeft = exclusiveTimeLeft(job, myUserId)
  return timeLeft ? `Reatribuído · ${timeLeft}` : 'Reatribuído'
}
