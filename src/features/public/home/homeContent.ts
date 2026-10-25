import { TrendingUp, Zap, Swords, Users, Lock, MessageCircle, Star, Clock, type LucideIcon } from 'lucide-react'

export interface HomeService {
  icon: LucideIcon
  title: string
  href: string
  badge: string
  color: string
  desc: string
  points: readonly string[]
}

export const SERVICES: readonly HomeService[] = [
  {
    icon: TrendingUp, title: 'Elo Boost', href: '/orders/new?service=elo_boost', badge: 'Mais Popular',
    color: 'text-brand bg-brand/10',
    desc: 'Nossos boosters jogam na sua conta (Solo) ou ao seu lado (Duo) e sobem do seu rank atual até o rank desejado, divisão por divisão.',
    points: ['Solo ou Duo', 'Divisão por divisão', 'Acompanhe ao vivo'],
  },
  {
    icon: Zap, title: 'Win Boost', href: '/orders/new?service=win_boost', badge: 'Rápido',
    color: 'text-accent bg-accent/10',
    desc: 'Compre um número fixo de vitórias para ganhar LP rápido — ou, se ainda não jogou o posicionamento, ative a garantia MD5 automaticamente.',
    points: ['Vitórias sob medida', 'Garantia MD5', 'LP rápido'],
  },
  {
    icon: Swords, title: 'Clash', href: '/orders/new?service=clash', badge: 'Fim de Semana',
    color: 'text-warning bg-warning/10',
    desc: 'Solo Clash ou Duo Clash aos sábados e domingos — o booster monta o time e garante sua participação no torneio.',
    points: ['Solo ou Duo Clash', 'Sábados e domingos', 'Time montado pelo booster'],
  },
  {
    icon: Users, title: 'Coaching', href: '/orders/new?service=coaching', badge: 'Pro',
    color: 'text-success bg-success/10',
    desc: 'Sessões 1-a-1 ao vivo. Seu coach analisa seus VODs, identifica erros e cria um plano de melhoria personalizado.',
    points: ['Sessões 1-a-1 ao vivo', 'Análise de VODs', 'Plano personalizado'],
  },
]

export const STATS = [
  { to: 1800, suffix: '+', decimals: 0, label: 'Pedidos concluídos' },
  { to: 4.9, suffix: '/5', decimals: 1, label: 'Avaliação média' },
  { to: 88, suffix: '%', decimals: 0, label: 'Taxa de vitória' },
  { to: 20, suffix: '+', decimals: 0, label: 'Boosters ativos' },
] as const

export const TRUST_FEATURES = [
  { icon: Lock, label: 'Proteção VPN', desc: 'Cada sessão roda através de um VPN local.' },
  { icon: MessageCircle, label: 'Chat ao Vivo', desc: 'Chat direto com seu booster dentro do seu pedido.' },
  { icon: Star, label: 'Garantia 100%', desc: 'Reembolso total se não conseguirmos concluir seu pedido.' },
  { icon: Clock, label: 'Início rápido', desc: 'Seu pedido é atribuído em até 30 minutos após o pagamento.' },
] as const

export const STEPS = [
  { n: '01', label: 'Configure', title: 'Configure e Pague', body: 'Escolha seu serviço, rank atual e alvo. Veja o preço na hora. Pague com segurança — seus dados são sempre protegidos.' },
  { n: '02', label: 'Booster', title: 'Booster Atribuído', body: 'Em minutos, um booster verificado que combina com seu tipo de fila e preferências de campeão aceita seu pedido.' },
  { n: '03', label: 'Acompanhe', title: 'Acompanhe e Converse', body: 'Acompanhe o progresso ao vivo. Converse direto com seu booster. Pause quando quiser. Receba notificação quando seu rank alvo for atingido.' },
] as const

export const KARAOKE_TEXT =
  'Você joga o que gosta. Nós *subimos* o seu elo com *boosters* *verificados,* *chat* *ao* *vivo* e *garantia* *total.*'

/** Altura do header sticky da PublicLayout (h-[68px]). */
export const HEADER_HEIGHT = 68
