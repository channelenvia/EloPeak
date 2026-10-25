import { ActionBar } from '@/components/ui/ActionBar'
import { Button, Card } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { resolveAddonLabel } from '@/lib/boostDomain'
import { ChevronRight, RotateCcw, Shield, Clock, Star, Tag } from 'lucide-react'
import type { ServiceType } from '@/types'
import { WIN_PACKAGE_DISCOUNTS, type getSummaryTotals } from './orderSummaryMath'
import type { useBoostAddons } from '@/hooks/useBoostAddons'

type Addon = NonNullable<ReturnType<typeof useBoostAddons>['data']>[number]
type Totals = ReturnType<typeof getSummaryTotals>

interface OrderBuilderSummaryProps {
  basePrice: number
  visibleWinPackage: number | null
  winPackagePrice: number
  selectedAddons: Addon[]
  serviceType: ServiceType | null
  couponCode: string | null
  totals: Totals
  isReview: boolean
  onRestart: () => void
  onPay: () => void
}

const TRUST_BADGES = [
  { icon: Shield, text: 'VPN & proteção offline' },
  { icon: Star, text: 'Garantia 100% de conclusão' },
  { icon: Clock, text: 'Inicia em até 30 minutos' },
]

function AddonPrice({ extra, currency }: { extra: Addon; currency: (v: number) => string }) {
  if (extra.price_modifier > 0) return <>{`+${currency(extra.price_modifier)}`}</>
  if (extra.price_modifier_pct > 0) return <>{`+${extra.price_modifier_pct}%`}</>
  return <>Grátis</>
}

function TotalRow({ totals, currency }: { totals: Totals; currency: (v: number) => string }) {
  return (
    <div className="flex justify-between items-end pt-2">
      <span className="text-sm font-semibold text-ink">Total</span>
      {totals.discountPrice > 0 ? (
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-ink-muted line-through">{currency(totals.subtotal)}</span>
          <span className="text-lg font-extrabold text-success">{currency(totals.totalPrice)}</span>
        </div>
      ) : (
        <span className="text-base font-bold text-brand">{currency(totals.totalPrice)}</span>
      )}
    </div>
  )
}

export function OrderBuilderSummary(props: OrderBuilderSummaryProps) {
  const currency = useCurrency()
  const { totals, visibleWinPackage, serviceType } = props
  const { coupon, discountPrice, subtotal } = totals
  return (
    <div className="space-y-4">
      {/* variant flat (sem blur/sombra/transparência) -- o card "vidro" padrão,
          isolado nessa coluna estreita, lia como um painel flutuando. */}
      <Card padding="lg" className="shadow-none backdrop-blur-none bg-bg-surface">
        <div className="space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-ink-secondary">Preço base</span>
            <span className="text-ink">{currency(props.basePrice)}</span>
          </div>

          {visibleWinPackage && (
            <div className="flex justify-between text-xs">
              <span className="text-ink-secondary">Pacote {visibleWinPackage} {visibleWinPackage === 1 ? 'vitória' : 'vitórias'} (-{WIN_PACKAGE_DISCOUNTS[visibleWinPackage]}%)</span>
              <span className="text-ink">+{currency(props.winPackagePrice)}</span>
            </div>
          )}
          {props.selectedAddons.map((extra) => (
            <div key={extra.id} className="flex justify-between text-xs">
              <span className="text-ink-secondary">{serviceType ? resolveAddonLabel(extra, serviceType).name : extra.name}</span>
              <span className="text-ink"><AddonPrice extra={extra} currency={currency} /></span>
            </div>
          ))}

          {/* Cupom fixo — aplicado automaticamente pelo store. Exige subtotal > 0
              pra não mostrar "aplicado" sobre valor ainda zerado. */}
          {coupon?.couponApplied && subtotal > 0 && (
            <div className="flex items-center gap-1.5 py-2 text-xs text-success font-medium">
              <Tag className="h-3.5 w-3.5 shrink-0" />
              Cupom {props.couponCode} aplicado · -{coupon.discountPct}%
            </div>
          )}

          {discountPrice > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-success font-medium">Desconto (-{coupon?.discountPct}%)</span>
              <span className="text-success font-medium">-{currency(discountPrice)}</span>
            </div>
          )}
          <TotalRow totals={totals} currency={currency} />

          {/* Reiniciar/Pagar -- só na Revisão (Voltar/Continuar vivem no widget da esquerda). */}
          {props.isReview && (
            <ActionBar className="pt-4">
              <Button variant="secondary" onClick={props.onRestart} leftIcon={<RotateCcw className="h-4 w-4" />}>
                Reiniciar
              </Button>
              <Button onClick={props.onPay} rightIcon={<ChevronRight className="h-4 w-4" />}>
                {serviceType === 'coaching' ? 'Confirmar' : 'Pagar'}
              </Button>
            </ActionBar>
          )}
        </div>
      </Card>

      <Card padding="lg" variant="brand">
        <div className="space-y-4">
          {TRUST_BADGES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2 text-xs text-ink-secondary">
              <Icon className="h-3.5 w-3.5 text-brand shrink-0" />
              {text}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
