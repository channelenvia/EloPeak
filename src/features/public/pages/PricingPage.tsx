import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronRight, MessageCircle } from 'lucide-react'
import { Button, Skeleton, RankBadge } from '@/components/ui'
import { RANK_TIER_LABEL, RANK_TIER_COLOR } from '@/lib/utils'
import { PLACEMENT_PRICE, getWinBoostPrice, ELO_TIERS } from '@/lib/pricing'
import { useCurrency } from '@/hooks/useCurrency'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { RankTier, ServiceExtra } from '@/types'


const WIN_TIERS: RankTier[] = [
  'iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger',
]

const MD5_TIERS: RankTier[] = ['iron','bronze','silver','gold','platinum','emerald','diamond','master']

function formatExtraPrice(extra: ServiceExtra, currency: (n: number) => string): string {
  if (extra.price_modifier > 0) return `+${currency(extra.price_modifier)}`
  if (extra.price_modifier_pct > 0) return `+${extra.price_modifier_pct}%`
  return 'Grátis'
}

export function PricingPage() {
  const currency = useCurrency()

  const { data: extras = [], isLoading: extrasLoading } = useQuery({
    queryKey: ['service-extras'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_extras')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      return data as ServiceExtra[]
    },
    staleTime: 1000 * 60 * 10,
  })

  return (
    <div className="py-16">
      <div className="container-app max-w-5xl space-y-16">

        {/* Header */}
        <div className="text-center">
          <p className="section-label mb-3">Preços</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">Transparência total nos preços</h1>
          <p className="text-ink-secondary max-w-lg mx-auto">
            Preços em reais, sem taxas ocultas. Configure seu pedido e veja o valor exato antes de pagar.
          </p>
        </div>

        {/* ── Solo Boost / Duo Boost ── */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-1">Solo Boost / Duo Boost</h2>
          <p className="text-sm text-ink-secondary mb-4">Preço por divisão dentro de cada tier. Tier completo = 4 divisões.</p>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-bg-elevated">
                <tr>
                  <th className="py-3 px-5 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Tier</th>
                  <th className="py-3 px-5 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">Solo / div</th>
                  <th className="py-3 px-5 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">Duo / div <span className="text-brand normal-case font-normal">(+50%)</span></th>
                  <th className="py-3 px-5 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">Tier completo (solo)</th>
                  <th className="py-3 px-5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-elevated">
                {ELO_TIERS.map(({ tier, perDiv }) => {
                  const duoDiv = Math.round(perDiv * 1.5 * 100) / 100
                  return (
                    <tr key={tier} className="hover:bg-bg-elevated/40 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <RankBadge tier={tier} size="xs" showDivision={false} showLabel={false} />
                          <span className={`font-semibold ${RANK_TIER_COLOR[tier]}`}>
                            {RANK_TIER_LABEL[tier]}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right text-brand font-semibold">{currency(perDiv)}</td>
                      <td className="py-3.5 px-5 text-right text-ink font-semibold">{currency(duoDiv)}</td>
                      <td className="py-3.5 px-5 text-right text-ink-secondary font-medium">{currency(perDiv * 4)}</td>
                      <td className="py-3.5 px-5 text-right">
                        <Button asChild size="xs" variant="primary">
                          <Link to={`/orders/new?service=elo_boost`}>
                            Pedir <ChevronRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-muted mt-2">* Diamante IV→Mestre: 4 divs × R$75 = R$300 mínimo (solo) · R$450 em duo</p>
        </section>

        {/* ── Vitórias ── */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-1">Vitórias</h2>
          <p className="text-sm text-ink-secondary mb-4">Preço por vitória de acordo com o seu rank atual.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {WIN_TIERS.map((tier) => {
              const price = getWinBoostPrice(tier, null)
              return (
                <div key={tier} className="card p-4 text-center flex flex-col items-center gap-1.5">
                  <RankBadge tier={tier} size="xs" showDivision={false} showLabel={false} />
                  <p className={`text-sm font-bold ${RANK_TIER_COLOR[tier]}`}>{RANK_TIER_LABEL[tier]}</p>
                  <p className="text-xl font-extrabold text-ink">{currency(price)}</p>
                  <p className="text-[10px] text-ink-muted mt-0.5">por vitória</p>
                </div>
              )
            })}
          </div>
          <div className="mt-3 text-right">
            <Button asChild size="sm">
              <Link to="/orders/new?service=win_boost">Comprar vitórias <ChevronRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </section>

        {/* ── MD5 — 5 Placements ── */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-1">MD5 — 5 Partidas de Posicionamento</h2>
          <p className="text-sm text-ink-secondary mb-4">Preço fixo por rank desejado. Inclui as 5 partidas de placement.</p>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-bg-elevated">
                <tr>
                  <th className="py-3 px-5 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Rank desejado</th>
                  <th className="py-3 px-5 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">Preço</th>
                  <th className="py-3 px-5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-elevated">
                {MD5_TIERS.map((tier) => (
                  <tr key={tier} className="hover:bg-bg-elevated/40 transition-colors">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        <RankBadge tier={tier} size="xs" showDivision={false} showLabel={false} />
                        <span className={`font-semibold ${RANK_TIER_COLOR[tier]}`}>
                          {RANK_TIER_LABEL[tier]}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-right text-brand font-semibold">{currency(PLACEMENT_PRICE[tier])}</td>
                    <td className="py-3.5 px-5 text-right">
                      <Button asChild size="xs" variant="outline">
                        <Link to="/orders/new?service=placement_matches">
                          Pedir <ChevronRight className="h-3 w-3" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Extras ── */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Extras Opcionais</h2>
          {extrasLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[...extras]
                .sort((a, b) => {
                  const ORDER = ['Apenas Solo', 'Processamento Prioritário', 'Campeão Único', 'Transmissão ao Vivo']
                  return ORDER.indexOf(a.name) - ORDER.indexOf(b.name)
                })
                .map((extra) => (
                  <div key={extra.id} className="card p-4 flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-ink">{extra.name}</p>
                        <span className="text-xs font-bold text-brand">{formatExtraPrice(extra, currency)}</span>
                      </div>
                      <p className="text-xs text-ink-secondary">{extra.description}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* ── Coaching ── */}
        <section>
          <div className="card p-6 flex items-start gap-4">
            <div className="h-11 w-11 rounded-2xl bg-success/20 border border-success/30 flex items-center justify-center shrink-0">
              <MessageCircle className="h-5 w-5 text-success" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-ink mb-1">Coaching</h2>
              <p className="text-sm text-ink-secondary mb-3">
                Sessões individuais com um booster Grão-mestre ou acima. O valor é combinado diretamente com o booster — não há cobrança antecipada.
              </p>
              <div className="flex flex-wrap gap-3 text-sm mb-3">
                {['Análise de gameplay', 'Revisão de replays', 'Posicionamento e mapa', 'Mentalidade competitiva'].map(item => (
                  <span key={item} className="flex items-center gap-1.5 text-xs text-ink-secondary">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />{item}
                  </span>
                ))}
              </div>
              <p className="text-lg font-bold text-brand">Valor a combinar · por sessão</p>
            </div>
            <Button asChild size="sm" className="shrink-0 self-center">
              <Link to="/orders/new?service=coaching">Solicitar</Link>
            </Button>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center">
          <Button asChild size="xl">
            <Link to="/orders/new">
              Configurar meu pedido <ChevronRight className="h-5 w-5" />
            </Link>
          </Button>
        </div>

      </div>
    </div>
  )
}
