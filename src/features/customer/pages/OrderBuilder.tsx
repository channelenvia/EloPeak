import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useOrderBuilderStore, type OrderBuilderStep } from '@/stores/orderBuilderStore'
import { Stepper, Button, Card } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { ChevronRight, ChevronLeft, Shield, Clock, Star } from 'lucide-react'
import type { ServiceType } from '@/types'
import { getServiceLabel } from '@/lib/utils'

const VALID_SERVICES: ServiceType[] = ['elo_boost', 'win_boost', 'coaching', 'placement_matches']

// Step components
import { StepService } from '../order-builder/StepService'
import { StepConfigure } from '../order-builder/StepConfigure'
import { StepExtras } from '../order-builder/StepExtras'
import { StepReview } from '../order-builder/StepReview'
import { StepPayment } from '../order-builder/StepPayment'

const STEPS: { id: OrderBuilderStep; label: string }[] = [
  { id: 'service', label: 'Serviço' },
  { id: 'configure', label: 'Configurar' },
  { id: 'extras', label: 'Extras' },
  { id: 'review', label: 'Revisão' },
  { id: 'payment', label: 'Pagamento' },
]

const STEP_COMPONENTS: Record<OrderBuilderStep, React.ComponentType> = {
  service: StepService,
  configure: StepConfigure,
  extras: StepExtras,
  review: StepReview,
  payment: StepPayment,
}

export function OrderBuilderPage() {
  const { step, steps, nextStep, prevStep, basePrice, extrasPrice, estimatedHours, selectedExtras, gameSlug, serviceType, setService, setStep, reset } = useOrderBuilderStore()
  const [searchParams] = useSearchParams()
  const currency = useCurrency()

  useEffect(() => {
    const service = searchParams.get('service') as ServiceType | null
    if (service && VALID_SERVICES.includes(service)) {
      reset()
      setService(service, service)
      setStep('configure')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentIdx = steps.indexOf(step)
  const completedSteps = steps.slice(0, currentIdx)
  const StepContent = STEP_COMPONENTS[step]
  const totalPrice = basePrice + extrasPrice
  const canGoBack = currentIdx > 0 && step !== 'payment'

  return (
    <div className="max-w-6xl mx-auto">
      {/* Stepper */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-ink mb-1">Novo Pedido</h1>
        <p className="text-sm text-ink-secondary mb-6">Configure seu boost e extras abaixo.</p>
        <Stepper
          steps={STEPS}
          currentStep={step}
          completedSteps={completedSteps}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main step content */}
        <div className="flex-1 min-w-0">
          <Card padding="lg" className="animate-fade-in">
            <StepContent />

            {/* Navigation */}
            {step !== 'payment' && step !== 'review' && (
              <div className="flex items-center justify-between mt-8 pt-5 border-t border-bg-elevated">
                <Button
                  variant="ghost"
                  onClick={prevStep}
                  disabled={!canGoBack}
                  leftIcon={<ChevronLeft className="h-4 w-4" />}
                >
                  Voltar
                </Button>
                <Button
                  onClick={nextStep}
                  disabled={!isStepComplete(step, { serviceType })}
                  rightIcon={<ChevronRight className="h-4 w-4" />}
                >
                  Continuar
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* Summary panel */}
        <aside className="lg:w-72 shrink-0 space-y-4">
          <Card padding="md" className="sticky top-6">
            <h3 className="text-sm font-semibold text-ink mb-4">Resumo do Pedido</h3>

            {gameSlug || serviceType ? (
              <div className="space-y-3 mb-4">
                {gameSlug && (
                  <SummaryRow label="Jogo" value={gameSlug === 'lol' ? 'League of Legends' : gameSlug.toUpperCase()} />
                )}
                {serviceType && (
                  <SummaryRow label="Serviço" value={getServiceLabel(serviceType)} />
                )}
                {estimatedHours && (
                  <SummaryRow label="Entrega est." value={`~${estimatedHours}h`} />
                )}
                {selectedExtras.length > 0 && (
                  <div>
                    <p className="text-xs text-ink-muted mb-1.5">Extras</p>
                    <div className="space-y-1">
                      {selectedExtras.map(({ extra }) => (
                        <div key={extra.id} className="flex justify-between text-xs">
                          <span className="text-ink-secondary">{extra.name}</span>
                          <span className="text-ink font-medium">
                            {extra.price_modifier > 0 ? `+${currency(extra.price_modifier)}` :
                             extra.price_modifier_pct > 0 ? `+${extra.price_modifier_pct}%` : 'Grátis'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-muted mb-4">Configure seu pedido para ver o preço.</p>
            )}

            <div className="border-t border-bg-elevated pt-3 space-y-1.5">
              {extrasPrice > 0 && (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-ink-secondary">Preço base</span>
                    <span className="text-ink">{currency(basePrice)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-ink-secondary">Extras</span>
                    <span className="text-ink">+{currency(extrasPrice)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between pt-1">
                <span className="text-sm font-semibold text-ink">Total</span>
                <span className="text-base font-bold text-brand">{currency(totalPrice)}</span>
              </div>
            </div>
          </Card>

          {/* Trust badges */}
          <Card padding="md" variant="brand">
            <div className="space-y-3">
              {[
                { icon: Shield, text: 'VPN & proteção offline' },
                { icon: Star, text: 'Garantia 100% de conclusão' },
                { icon: Clock, text: 'Inicia em até 30 minutos' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-xs text-ink-secondary">
                  <Icon className="h-3.5 w-3.5 text-brand shrink-0" />
                  {text}
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink font-medium">{value}</span>
    </div>
  )
}

function isStepComplete(step: OrderBuilderStep, state: { serviceType: string | null }) {
  if (step === 'service') return !!state.serviceType
  return true
}
