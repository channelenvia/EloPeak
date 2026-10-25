import { Link } from 'react-router-dom'
import { ArrowRight, Shield } from 'lucide-react'
import { Button } from '@/components/ui'
import { Rise } from './Rise'
import { WordsHeading } from './WordsHeading'

// Fim: pergunta final e a marca gigante, com o cristal mais alto espiando por cima.
export function FinalCta() {
  return (
    <section className="relative overflow-hidden pt-20 text-center lg:pt-28">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-hero-glow opacity-60" />
      <div className="relative mx-auto grid max-w-3xl justify-items-center gap-6 px-5 sm:px-8">
        <Rise>
          <div className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-4 py-2 text-xs font-bold text-success">
            <Shield className="h-3.5 w-3.5" />Garantia 100% de conclusão
          </div>
        </Rise>
        <WordsHeading text="Pronto para alcançar seu rank objetivo?" className="font-display text-4xl font-black leading-tight text-ink md:text-6xl" highlight={[4, 5]} />
        <Rise step={1}><p className="text-xl text-ink-secondary">Junte-se a mais de 1.800 jogadores. Configure seu boost e comece em minutos.</p></Rise>
        <Rise step={2} className="flex flex-wrap items-center justify-center gap-4">
          <Button asChild size="xl"><Link to="/orders/new">Começar Seu Boost <ArrowRight className="h-5 w-5" /></Link></Button>
          <Button asChild size="lg" variant="ghost"><Link to="/faq">Dúvidas frequentes</Link></Button>
        </Rise>
        <Rise step={3}><p className="text-xs text-ink-muted">Pagamento seguro · Sem compromisso · Suporte 24/7</p></Rise>
      </div>
      <Rise className="relative mt-[clamp(70px,12vw,170px)]">
        <div aria-hidden="true" className="relative select-none font-display text-[clamp(70px,19vw,300px)] font-black leading-[0.8] tracking-[-0.05em] text-gradient-brand">
          ELOPEAK
          <img src="/ranks/challenger.svg" alt="" className="lp-bob absolute bottom-[96%] left-[66%] w-[11%] drop-shadow-[0_0_32px_rgb(34_197_94_/_0.45)]" />
        </div>
      </Rise>
    </section>
  )
}
