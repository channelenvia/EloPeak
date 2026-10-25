import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { SectionTint } from '../components/SectionTint'
import { TRUST_FEATURES } from './homeContent'
import { Rise } from './Rise'
import { WordsHeading } from './WordsHeading'

export function TrustSection() {
  return (
    <section className="relative py-16 lg:py-24">
      <SectionTint />
      <div className="container-wide grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <Rise><p className="section-label mb-4">Por que mais de 1.800 jogadores confiam em nós</p></Rise>
          <WordsHeading text="Sua conta está em boas mãos." className="mb-6 font-display text-4xl font-black leading-tight text-ink md:text-5xl" highlight={[3, 4]} />
          <Rise step={1}>
            <p className="mb-7 text-lg leading-relaxed text-ink-secondary">
              As credenciais enviadas pela plataforma são criptografadas antes de serem armazenadas e ficam disponíveis apenas para o booster atribuído e para a equipe autorizada quando necessário. Cada sessão roda através de VPN. Você tem um histórico completo no histórico de pedidos ao vivo.
            </p>
            <Button asChild size="lg" variant="secondary"><Link to="/security">Leia nossa política de segurança →</Link></Button>
          </Rise>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {TRUST_FEATURES.map(({ icon: Icon, label, desc }, i) => (
            <Rise key={label} step={i} className="card space-y-3 p-5 transition-colors hover:border-success/25">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10"><Icon className="h-5 w-5 text-success" /></div>
              <div>
                <h4 className="text-sm font-bold text-ink">{label}</h4>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{desc}</p>
              </div>
            </Rise>
          ))}
        </div>
      </div>
    </section>
  )
}
