import { useEffect, useMemo } from 'react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useBoostAddons, EMPTY_ADDONS } from '@/hooks/useBoostAddons'
import { CheckCircle2, Zap, Tv, Crosshair, User, Trophy, Shield, Lightbulb, Mic } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { getWinBoostPrice } from '@/lib/pricing'
import { getBoostFlow, resolveAddonLabel } from '@/lib/boostDomain'
import { CLASH_ADDON_CODES } from '@/lib/clashDomain'
import type { ServiceExtra } from '@/types'

const ICON_MAP: Record<string, React.ElementType> = {
  zap: Zap,
  tv: Tv,
  crosshair: Crosshair,
  user: User,
  shield: Shield,
  lightbulb: Lightbulb,
  mic: Mic,
}

const WIN_PACKAGES = [
  { wins: 1, discountPct: 10 },
  { wins: 3, discountPct: 20 },
  { wins: 5, discountPct: 30 },
]

export function StepExtras() {
  const {
    selectedExtraIds, toggleExtra, basePrice, setExtrasPrice,
    serviceType, currentRank, boostMode, queueType, winPackage, setWinPackage,
  } = useOrderBuilderStore()
  const currency = useCurrency()

  const isClash = serviceType === 'clash'

  // Clash reaproveita o mesmo catálogo do Elo Boost: Solo Clash usa
  // 'solo_standard' (mesmo de Solo Boost/Vitórias/MD5), Duo Clash usa
  // 'duo_standard' (mesmo de Duo Boost) — mesmos extras, decisão de produto.
  const flow = serviceType === 'elo_boost' && currentRank
    ? getBoostFlow(currentRank.tier, boostMode, queueType)
    : serviceType === 'win_boost' || serviceType === 'md5' || isClash
      ? (boostMode === 'duo' ? 'duo_standard' : 'solo_standard')
      : null
  // Pacote de vitórias extras vale pra qualquer tier de Elo Boost, Master+
  // incluso -- WIN_PRICE_CENTS (getWinBoostPrice, shared/pricing.ts) já tem
  // preço por vitória próprio pra master/grandmaster/challenger, só não é o
  // mesmo preço usado pra calcular o trecho Master+ em si (que vem da
  // master_plus_pricing por faixa de PDL). computeOrderPrice no backend já
  // soma winPackagePrice sem excluir Master+ nenhum -- só faltava aqui.
  const showWinPackages = !!currentRank && serviceType === 'elo_boost'

  const unitWinPrice = showWinPackages && currentRank
    ? getWinBoostPrice(queueType, currentRank.tier, boostMode, currentRank.division ?? null)
    : 0

  function packageTotal(wins: number, discountPct: number): number {
    return Math.round(unitWinPrice * wins * (1 - discountPct / 100) * 100) / 100
  }

  // Addons são específicos do fluxo (Solo padrão / Duo padrão / Master+) —
  // a query já vem filtrada por `flow`, nunca é a lista inteira escondida
  // por tipo de modalidade. A ordem vem de `sort_order` (Acesso Prioritário
  // sempre por último — ver a seed em supabase/migrations).
  const { data, isLoading } = useBoostAddons(flow)
  const allExtras = data ?? EMPTY_ADDONS
  // Clash só oferece um subconjunto do catálogo do fluxo (Solo Clash:
  // Transmissão + Acesso Prioritário; Duo Clash: Chamada de Voz + Acesso
  // Prioritário) — ver CLASH_ADDON_CODES em shared/clashDomain.ts, também
  // aplicado na validação da Edge Function.
  const extras = useMemo(() => isClash
    ? allExtras.filter(e => e.code && CLASH_ADDON_CODES[boostMode].includes(e.code))
    : allExtras, [isClash, allExtras, boostMode])

  useEffect(() => {
    const selected = extras.filter(e => selectedExtraIds.has(e.id))
    let total = selected.reduce((sum, extra) => {
      if (extra.price_modifier > 0) return sum + extra.price_modifier
      if (extra.price_modifier_pct > 0) return sum + (basePrice * extra.price_modifier_pct) / 100
      return sum
    }, 0)

    if (winPackage && showWinPackages) {
      const pkg = WIN_PACKAGES.find(p => p.wins === winPackage)
      if (pkg) total += packageTotal(pkg.wins, pkg.discountPct)
    }

    setExtrasPrice(Math.round(total * 100) / 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extras, selectedExtraIds, basePrice, winPackage, showWinPackages, setExtrasPrice])

  function getExtraPrice(extra: ServiceExtra): number {
    if (extra.price_modifier > 0) return extra.price_modifier
    if (extra.price_modifier_pct > 0) return (basePrice * extra.price_modifier_pct) / 100
    return 0
  }

  function formatExtraPrice(extra: ServiceExtra): string {
    if (extra.price_modifier > 0) return `+${currency(extra.price_modifier)}`
    if (extra.price_modifier_pct > 0) return `+${extra.price_modifier_pct}%`
    return 'Grátis'
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Extras</h2>
      <p className="text-sm text-ink-secondary mb-6">
        Personalize seu pedido com extras opcionais. Você pode pular esta etapa.
      </p>

      <div className="space-y-6">
        {!['elo_boost', 'win_boost', 'md5', 'clash'].includes(serviceType ?? '') ? null : (!isClash && !currentRank) ? (
          <p className="text-sm text-ink-muted text-center py-8">
            Selecione o rank atual na etapa anterior para ver os extras disponíveis.
          </p>
        ) : isLoading ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : extras.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-8">Nenhum extra disponível no momento.</p>
        ) : (
          <div>
            {showWinPackages && (
              <p className="text-xs font-bold uppercase tracking-widest text-ink-muted mb-3">Opções Adicionais</p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {extras.map((extra) => {
                const selected = selectedExtraIds.has(extra.id)
                const Icon = ICON_MAP[extra.icon ?? 'zap'] ?? Zap
                const price = getExtraPrice(extra)
                const label = resolveAddonLabel(extra, serviceType!)

                return (
                  <button
                    key={extra.id}
                    onClick={() => toggleExtra(extra.id)}
                    className={cn(
                      'relative flex items-start gap-4 p-4 rounded-2xl border-2 text-left transition-all duration-150',
                      selected
                        ? 'border-brand bg-brand/10 shadow-brand'
                        : 'border-border-subtle bg-bg-card hover:border-brand/40 hover:bg-bg-elevated',
                    )}
                  >
                    {selected && (
                      <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-brand" />
                    )}
                    <div className={cn(
                      'h-9 w-9 rounded-xl flex items-center justify-center shrink-0',
                      selected ? 'bg-brand text-white' : 'bg-bg-elevated text-ink-secondary',
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('text-sm font-semibold', selected ? 'text-brand' : 'text-ink')}>{label.name}</p>
                        <span className={cn('text-xs font-bold shrink-0', price === 0 ? 'text-success' : 'text-brand')}>
                          {formatExtraPrice(extra)}
                        </span>
                      </div>
                      <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{label.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Win packages — Solo/Duo padrão com rank selecionado (não existe no Master+) */}
        {showWinPackages && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink-muted mb-3">Pacotes de Vitórias</p>
            <div className="grid grid-cols-3 gap-3">
              {WIN_PACKAGES.map(({ wins, discountPct }) => {
                const total = packageTotal(wins, discountPct)
                const original = Math.round(unitWinPrice * wins * 100) / 100
                const savings = Math.round((original - total) * 100) / 100
                const isSelected = winPackage === wins

                return (
                  <button
                    key={wins}
                    type="button"
                    onClick={() => setWinPackage(isSelected ? null : wins)}
                    className={cn(
                      'relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 text-center transition-all duration-150',
                      isSelected
                        ? 'border-brand bg-brand/10'
                        : 'border-border-subtle bg-bg-card hover:border-brand/40 hover:bg-bg-elevated',
                    )}
                  >
                    {isSelected && (
                      <CheckCircle2 className="absolute top-2.5 right-2.5 h-4 w-4 text-brand" />
                    )}

                    {/* Discount badge */}
                    <span className={cn(
                      'text-[10px] font-black px-2 py-0.5 rounded-full',
                      isSelected ? 'bg-brand text-white' : 'bg-bg-elevated text-ink-secondary',
                    )}>
                      -{discountPct}%
                    </span>

                    {/* Trophy + wins */}
                    <div className="flex items-center gap-1.5">
                      <Trophy className={cn('h-4 w-4 shrink-0', isSelected ? 'text-brand' : 'text-ink-muted')} />
                      <span className={cn('text-xl font-extrabold leading-none', isSelected ? 'text-brand' : 'text-ink')}>
                        {wins}
                      </span>
                      <span className={cn('text-[11px] font-semibold', isSelected ? 'text-brand/80' : 'text-ink-secondary')}>
                        {wins === 1 ? 'vitória' : 'vitórias'}
                      </span>
                    </div>

                    {/* Total price */}
                    <p className={cn('text-base font-extrabold', isSelected ? 'text-brand' : 'text-ink')}>
                      {currency(total)}
                    </p>

                    {/* Unit price reference */}
                    <p className="text-[10px] text-ink-muted leading-tight">
                      {currency(unitWinPrice)}/vitória
                    </p>

                    {/* Savings */}
                    <span className="text-[10px] font-semibold text-success">
                      economia {currency(savings)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
