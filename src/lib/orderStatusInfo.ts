import type { Order } from '@/types'
import { getOrderStatusGroup, isOrderOverdue } from '@/lib/utils'

// Âncora do chat na página do pedido (atalho do badge de status do cliente).
export const ORDER_CHAT_ANCHOR_ID = 'order-chat'

export type OrderViewerRole = 'customer' | 'booster' | 'admin'

type StatusInfoOrder = Pick<Order, 'status' | 'assigned_booster_id'> & Partial<Pick<Order, 'match_sync_started_at' | 'estimated_hours'>>

interface StatusInfoContext {
  /** Nota que o cliente já deu (pedido concluído); null = ainda não avaliou. */
  reviewRating?: number | null
}

// Texto exibido no tooltip do badge de status: o que está acontecendo com o
// pedido, do ponto de vista de quem está olhando.
export function describeOrderStatus(order: StatusInfoOrder, role: OrderViewerRole, ctx: StatusInfoContext = {}): string {
  const isCustomer = role === 'customer'
  const group = getOrderStatusGroup(order)

  switch (group) {
    case 'awaiting_payment':
      return isCustomer
        ? 'Seu pedido foi criado e aguarda o pagamento. Gere o PIX para ele entrar na fila dos boosters.'
        : 'O cliente ainda não pagou este pedido.'
    case 'awaiting_credentials':
      return isCustomer
        ? 'O booster precisa do login e da senha da conta para começar. Envie as credenciais com segurança.'
        : 'Aguardando o cliente enviar as credenciais da conta.'
    case 'awaiting_booster':
      if (order.status === 'paid') {
        return isCustomer ? 'Pagamento confirmado. Estamos preparando o pedido para liberar aos boosters.' : 'Pagamento confirmado; o pedido ainda está sendo preparado.'
      }
      if (order.status === 'pending_review') {
        if (role === 'admin') return 'Pedido pago aguardando sua aprovação: atribua a um booster, cancele ou deixe o prazo acabar para liberar ao pool.'
        return isCustomer ? 'Pagamento confirmado. O pedido passa por uma revisão rápida antes de ir para os boosters.' : 'Pedido em revisão pela equipe antes de ir para o pool.'
      }
      if (role === 'booster') return 'Pedido disponível no pool de jobs, aguardando um booster aceitar.'
      return isCustomer ? 'Pedido liberado. Assim que um booster aceitar, o serviço começa.' : 'Sem booster atribuído: o pedido está no pool aguardando aceite.'
    case 'in_progress': {
      if (isOrderOverdue({ match_sync_started_at: order.match_sync_started_at ?? null, estimated_hours: order.estimated_hours ?? null })) {
        return isCustomer
          ? 'O prazo estimado foi ultrapassado. Fale com o suporte pelo Discord se precisar de ajuda.'
          : 'O prazo estimado deste pedido foi ultrapassado.'
      }
      if (order.status === 'assigned') return isCustomer ? 'Booster atribuído. O serviço começa em breve.' : 'Booster atribuído; o serviço ainda não foi iniciado.'
      if (order.status === 'paused') return isCustomer ? 'O serviço está pausado temporariamente.' : 'Serviço pausado.'
      if (order.status === 'awaiting_customer') {
        return isCustomer ? 'O booster aguarda uma ação sua. Confira o chat do pedido.' : 'Aguardando resposta ou confirmação do cliente.'
      }
      return isCustomer ? 'O booster está realizando o serviço agora. Acompanhe o progresso abaixo.' : 'Serviço em andamento.'
    }
    case 'drop_requested':
      return 'Há uma solicitação de drop (troca de booster) em análise pela equipe. O pedido fica travado até a decisão.'
    case 'completed':
      if (!isCustomer) return 'Serviço concluído.'
      return ctx.reviewRating != null
        ? `Serviço concluído. Você avaliou o booster com ${ctx.reviewRating}/5.`
        : 'Serviço concluído. Conte como foi avaliando o booster.'
    case 'hidden':
      if (order.status === 'refunded') return 'Pedido reembolsado.'
      if (order.status === 'disputed') return 'Pedido em disputa; a equipe está analisando.'
      if (order.status === 'under_review') return 'Pedido em análise pela equipe.'
      return 'Pedido cancelado.'
  }
}
