import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { AnimatedNumber, Button } from '@/components/ui'
import { SEOHead } from '@/components/SEOHead'
import { TestimonialsCarousel } from '../components/TestimonialsCarousel'
import { SectionTint } from '../components/SectionTint'
import { FeaturedBoosters } from '../home/FeaturedBoosters'
import { FinalCta } from '../home/FinalCta'
import { HeroScene } from '../home/HeroScene'
import { KARAOKE_TEXT, STATS } from '../home/homeContent'
import { KaraokeText } from '../home/KaraokeText'
import { Rise } from '../home/Rise'
import { SceneProvider } from '../home/SceneProvider'
import { ServicesWindow } from '../home/ServicesWindow'
import { StepsPinned } from '../home/StepsPinned'
import { Ticker } from '../home/Ticker'
import { TrustSection } from '../home/TrustSection'
import { WaveTear } from '../home/WaveTear'
import { WordsHeading } from '../home/WordsHeading'
import '../home/home.css'

export function HomePage() {
  return (
    <SceneProvider>
      <SEOHead
        title="EloPeak"
        description="Boosting de elo, win boost, MD5, Clash e coaching para League of Legends. Boosters verificados, entrega segura e pagamento via PIX ou cartão."
      />
      <HeroScene />
      <Ticker />

      <section className="relative px-5 py-[clamp(90px,13vw,170px)] sm:px-8 lg:px-16" aria-label="O que é o EloPeak">
        <div className="mx-auto max-w-5xl">
          <span className="mb-6 inline-flex items-center gap-2.5 text-sm font-bold text-ink-secondary" aria-hidden="true">
            <span className="lp-eq inline-flex items-center gap-[3px] rounded-full bg-brand px-3 py-2 text-ink-inverse">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</span>
            Seu pedido, ao vivo
          </span>
          <KaraokeText text={KARAOKE_TEXT} className="max-w-[22em] font-display text-[clamp(30px,4.6vw,54px)] font-bold leading-[1.16] tracking-tight text-pretty" />
          <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle shadow-card lg:grid-cols-4">
            {STATS.map(({ to, suffix, decimals, label }, i) => (
              <Rise key={label} step={i} className="bg-bg-surface px-4 py-5 sm:px-6">
                <p className="font-display text-3xl font-extrabold text-ink tabular-figures"><AnimatedNumber value={to} format={(n) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`} /></p>
                <p className="mt-1 text-xs text-ink-muted">{label}</p>
              </Rise>
            ))}
          </div>
        </div>
      </section>

      <WaveTear />
      <ServicesWindow />
      <div className="py-6 text-center">
        <Button asChild variant="link"><Link to="/services">Ver todos os serviços em detalhe <ChevronRight className="h-4 w-4" /></Link></Button>
      </div>
      <StepsPinned />
      <TrustSection />
      <FeaturedBoosters />

      <section className="relative overflow-hidden py-16 lg:py-24">
        <SectionTint />
        <div className="container-wide mb-10 text-center">
          <Rise><p className="section-label mb-3">Clientes reais</p></Rise>
          <WordsHeading text="O que os jogadores dizem" className="font-display text-4xl font-black text-ink md:text-5xl" highlight={[2, 3]} />
        </div>
        <TestimonialsCarousel />
      </section>

      <FinalCta />
    </SceneProvider>
  )
}
