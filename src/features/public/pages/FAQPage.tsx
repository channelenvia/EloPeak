import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SEOHead } from '@/components/SEOHead'
import { ScrollReveal } from '@/components/motion/ScrollReveal'
import { DISCORD_SUPPORT_URL } from '@/lib/discordSupport'

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  const answerId = useId()

  return (
    <div className="border-b border-border-subtle last:border-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={answerId}
        className="w-full flex items-start justify-between gap-4 py-5 text-left"
      >
        <span className="text-sm font-semibold text-ink">{q}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-ink-muted shrink-0 mt-0.5 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <p id={answerId} className="pb-5 text-sm text-ink-secondary leading-relaxed -mt-1">{a}</p>
      )}
    </div>
  )
}

export function FAQPage() {
  const FAQS = [
    { q: 'O Elo Boost é seguro?', a: 'Usamos VPN em todas as sessões, modo aparecer offline e nunca armazenamos suas credenciais além do pedido ativo. Nossos boosters têm histórico de IP limpo e seguem protocolos rigorosos de segurança de conta. Completamos mais de 1.800 pedidos sem nenhum banimento permanente pelos nossos métodos.' },
    { q: 'Quanto tempo leva meu pedido?', a: 'A maioria dos pedidos começa dentro de 30 minutos após a confirmação do pagamento. O tempo estimado de entrega é mostrado antes do checkout e depende da diferença de rank e tipo de fila. O adicional de Prioridade garante atribuição imediata a um booster top.' },
    { q: 'Posso assistir meu booster jogar?', a: "Sim — adicione o extra 'Transmissão ao Vivo' no checkout e você receberá um link de stream privado depois que seu pedido começar." },
    { q: 'E se o pedido não for concluído?', a: 'Oferecemos garantia de 100% de conclusão. Se um booster não conseguir finalizar seu pedido, reatribuímos ou emitimos reembolso total. Sem perguntas.' },
    { q: 'Preciso compartilhar minha senha?', a: 'Para boost solo, sim — você compartilha as credenciais pela nossa plataforma criptografada e elas são apagadas ao concluir o pedido. Para boost em duo, você joga junto com nosso booster e nenhuma credencial é necessária.' },
    { q: 'Posso solicitar um campeão ou função específica?', a: "Sim. Durante a configuração do pedido você pode especificar função e preferências de campeão. Adicione o extra 'Campeão Único' para garantir apenas um campeão." },
    { q: 'Como os boosters são verificados?', a: 'Todos os boosters se candidatam pela nossa plataforma e passam por verificação em múltiplas etapas: prova de rank, revisão de partidas teste e um período de observação. Apenas boosters Grão-mestre ou Desafiante são aprovados.' },
    { q: 'Quais métodos de pagamento vocês aceitam?', a: 'Aceitamos pagamento via PIX, processado com segurança pelo Mercado Pago. O PIX é instantâneo, gratuito para você e disponível 24h por dia.' },
    { q: 'Posso conversar com meu booster?', a: 'Com certeza. Cada pedido inclui um chat interno onde você pode enviar mensagens diretamente para o seu booster.' },
  ]

  return (
    <div className="py-16 relative overflow-hidden">
      <SEOHead
        title="Perguntas Frequentes"
        description="Tire suas dúvidas sobre boosting de elo, segurança da conta, prazos de entrega e formas de pagamento no EloPeak."
      />
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
      <div className="container-app max-w-3xl relative">
        <ScrollReveal className="text-center mb-12">
          <p className="section-label mb-3">FAQ</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">Perguntas Frequentes</h1>
          <p className="text-ink-secondary">
            Não encontrou o que procura?{' '}
            {DISCORD_SUPPORT_URL
              ? <a href={DISCORD_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Fale com o suporte</a>
              : <span className="text-brand">Fale com o suporte</span>}.
          </p>
        </ScrollReveal>

        <div className="card p-0 divide-y-0">
          <div className="px-6">
            {FAQS.map(({ q, a }) => (
              <FAQItem key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
