import { Shield, Lock, Eye, Cpu, Server, CreditCard, Check } from 'lucide-react'
import { SEOHead } from '@/components/SEOHead'
import { ScrollReveal } from '@/components/motion/ScrollReveal'

export function SecurityPage() {
  const PILLARS = [
    {
      icon: Shield,
      title: 'Proteção da Conta',
      items: [
        'VPN ativado em cada sessão de jogo',
        "Modo 'Aparecer Offline' — sua lista de amigos fica limpa",
        'Credenciais não armazenadas além da sessão ativa',
        'Boosters operam com histórico de IP limpo',
      ],
    },
    {
      icon: Lock,
      title: 'Autenticação & Sessões',
      items: [
        'Auth Supabase com hash bcrypt de senhas',
        'Sessões JWT seguras com rotação automática',
        'Revogação de sessão ao trocar a senha',
        '2FA disponível para sua conta',
      ],
    },
    {
      icon: CreditCard,
      title: 'Segurança do Pagamento',
      items: [
        'Pagamentos via PIX processados com segurança pelo Mercado Pago',
        'Processamento de pagamento compatível com PCI-DSS',
        'Validação de assinatura de webhook em cada evento',
        'Operações de pagamento idempotentes evitam cobranças duplas',
      ],
    },
    {
      icon: Eye,
      title: 'Privacidade & Dados',
      items: [
        'Coleta mínima de dados — apenas o necessário',
        'Booster nunca vê seu e-mail completo ou dados pessoais',
        'Todos os arquivos usam URLs privadas com expiração',
        'Exclusão de dados disponível ao fechar a conta',
      ],
    },
    {
      icon: Cpu,
      title: 'Controle de Acesso',
      items: [
        'Segurança em nível de linha — clientes só veem seus próprios pedidos',
        'Boosters só acessam os jobs atribuídos a eles',
        'Acesso admin totalmente auditado e registrado',
        'Funções aplicadas no servidor, nunca confiando no cliente',
      ],
    },
    {
      icon: Server,
      title: 'Infraestrutura',
      items: [
        'Todos os dados criptografados em repouso e em trânsito (TLS 1.3)',
        'Hospedado na Supabase (certificada SOC 2 Tipo II)',
        'Backups automáticos regulares',
      ],
    },
  ]

  return (
    <div className="py-16 relative overflow-hidden">
      <SEOHead
        title="Segurança"
        description="Como o EloPeak protege sua conta durante o boosting: VPN dedicada, boosters verificados e garantia de reembolso."
      />
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
      <div className="container-wide space-y-16 relative">
        <ScrollReveal className="text-center">
          <p className="section-label mb-3">Confiança & Segurança</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">Segurança</h1>
          <p className="text-lg text-ink-secondary max-w-xl mx-auto">
            Como protegemos você e sua conta.
          </p>
        </ScrollReveal>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PILLARS.map(({ icon: Icon, title, items }) => (
            <div key={title} className="card p-6 space-y-4">
              <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-success" />
              </div>
              <h3 className="font-semibold text-ink">{title}</h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item} className="text-xs text-ink-secondary flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-success mt-px shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
