import { useEffect } from 'react'
import { ActionBar } from '@/components/ui/ActionBar'
import { PageHeader } from '@/components/ui/PageHeader'
import { m, AnimatePresence } from 'framer-motion'
import { useOrderBuilderStore, type OrderBuilderStep } from '@/stores/orderBuilderStore'
import { Stepper, Button, Card, Modal } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useBoostAddons, EMPTY_ADDONS } from '@/hooks/useBoostAddons'
import { ChevronRight, ChevronLeft, UserCheck, X } from 'lucide-react'

import { StepService } from '../order-builder/StepService'
import { StepConfigure } from '../order-builder/StepConfigure'
import { StepExtras } from '../order-builder/StepExtras'
import { StepReview } from '../order-builder/StepReview'
import { StepPayment } from '../order-builder/StepPayment'
import { OrderBuilderConfirmModals } from '../order-builder/OrderBuilderConfirmModals'
import { OrderBuilderSummary } from '../order-builder/OrderBuilderSummary'
import { isStepComplete } from '../order-builder/isStepComplete'
import { getSummaryTotals, getVisibleWinPackage, getWinPackagePrice, resolveBuilderFlow } from '../order-builder/orderSummaryMath'
import { useBuilderParams } from '../order-builder/useBuilderParams'
import { useOrderBuilderExit } from '../order-builder/useOrderBuilderExit'
import {
  useCatalogIntent, useResetOnNewOrder, useResolvedCatalogIds, useResumeDraft, useStaleBoosterCleanup,
} from '../order-builder/useOrderBuilderBootstrap'

// "Pagamento" não aparece mais no stepper visual -- pagamento não é mais uma
// tela navegável, virou o popup que abre a partir da Revisão (ver
// pixModalOpen). O step 'payment' continua existindo em OrderBuilderStep
// (usado só pra retomar um pedido pendente após reload, sem popup nenhum
// por cima), só não ganha um número/pill no Stepper.
const STEPS: { id: OrderBuilderStep; label: string }[] = [
  { id: 'service', label: 'Serviço' },
  { id: 'configure', label: 'Configurar' },
  { id: 'extras', label: 'Extras' },
  { id: 'review', label: 'Revisão' },
]

const STEP_COMPONENTS: Record<OrderBuilderStep, React.ComponentType> = {
  service: StepService,
  configure: StepConfigure,
  extras: StepExtras,
  review: StepReview,
  payment: StepPayment,
}

const PANEL_TRANSITION = { type: 'spring', bounce: 0.15, duration: 0.5 } as const

function PreferredBoosterBanner() {
  const { preferredBoosterName, serviceType, clearPreferredBooster } = useOrderBuilderStore()
  if (!preferredBoosterName) return null
  return (
    <div className="flex items-center gap-3 mb-6 rounded-xl border border-brand/25 bg-brand/10 px-4 py-3 text-sm text-ink">
      <UserCheck className="h-4 w-4 text-brand shrink-0" />
      <span className="flex-1">
        Pedido vinculado a <span className="font-semibold">{preferredBoosterName}</span> — {serviceType === 'coaching'
          ? 'só ele(a) poderá aceitar este pedido.'
          : 'ele(a) poderá aceitar com exclusividade por 9 horas após o pagamento.'}
      </span>
      <button
        type="button"
        onClick={() => clearPreferredBooster()}
        aria-label="Desvincular booster"
        title="Desvincular booster"
        className="shrink-0 text-ink-muted hover:text-ink transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function useStepComplete(): boolean {
  const s = useOrderBuilderStore()
  return isStepComplete(s.step, {
    serviceType: s.serviceType, selectedCoachPackage: s.selectedCoachPackage, currentRank: s.currentRank,
    targetRank: s.targetRank, winsPurchased: s.winsPurchased, riotId: s.riotId, isMd5: s.isMd5,
    riotVerified: s.riotVerified, riotLookupLoading: s.riotLookupLoading, md5MatchesRemaining: s.md5MatchesRemaining,
    clashTier: s.clashTier, clashDay: s.clashDay, customerLanes: s.customerLanes,
  })
}

function useSummaryData() {
  const {
    basePrice, extrasPrice, selectedExtraIds, currentRank, boostMode, serviceType, couponCode, winPackage, queueType,
  } = useOrderBuilderStore()
  const flow = resolveBuilderFlow(serviceType, currentRank, boostMode, queueType)
  // Mesma queryKey usada em StepExtras/StepReview — já em cache.
  const { data: addonData } = useBoostAddons(flow)
  const selectedAddons = (addonData ?? EMPTY_ADDONS).filter(e => selectedExtraIds.has(e.id))
  const visibleWinPackage = getVisibleWinPackage(winPackage, flow)
  const winPackagePrice = getWinPackagePrice(visibleWinPackage, { winPackage, flow, currentRank, queueType, boostMode })
  const totals = getSummaryTotals(basePrice, extrasPrice, couponCode, serviceType)
  return { selectedAddons, visibleWinPackage, winPackagePrice, totals }
}

export function OrderBuilderPage() {
  const {
    step, steps, nextStep, prevStep, basePrice, serviceType, setStepAttempted,
    riotLookupLoading, couponCode,
  } = useOrderBuilderStore()
  const params = useBuilderParams()
  const exit = useOrderBuilderExit(params)
  const { setPixModalOpen } = exit
  const summary = useSummaryData()
  const stepComplete = useStepComplete()

  const resumableOrder = useResumeDraft(params)

  useEffect(() => {
    if (step !== 'review') setPixModalOpen(false)
  }, [step, setPixModalOpen])

  useResolvedCatalogIds()
  useResetOnNewOrder(params)
  useStaleBoosterCleanup(resumableOrder, params)
  useCatalogIntent(params)

  const currentIdx = steps.indexOf(step)
  const StepContent = STEP_COMPONENTS[step]
  const canGoBack = currentIdx > 0 && step !== 'payment'
  // 'payment' é só o popup do PIX, aberto por "Pagar" -- a Revisão é o último passo navegável.
  const isReviewStep = step === 'review'
  // Aside só existe a partir do step 2 -- no step 'service' o cliente pode
  // clicar em qualquer card sem a tela encolher.
  const showSummary = step !== 'service'

  function handleContinue() {
    if (!stepComplete) { setStepAttempted(true); return }
    setStepAttempted(false)
    nextStep()
  }

  return (
    <div>
      <div className="mb-8">
        <PageHeader title="Novo Pedido" description="Configure seu boost e extras abaixo." className="mb-6" />
        <PreferredBoosterBanner />
        <Stepper
          steps={STEPS.filter((s) => steps.includes(s.id))}
          currentStep={step}
          completedSteps={steps.slice(0, currentIdx)}
        />
      </div>

      {/* Grid (não flex) trava a proporção 70/30 só depois que a aside
          existe; m.div/layout anima o encolhimento em vez de um salto seco. */}
      <div className={cn('grid grid-cols-1 gap-6 lg:items-start', showSummary ? 'lg:grid-cols-10' : 'lg:grid-cols-1')}>
        <m.div layout transition={PANEL_TRANSITION} className={cn('min-w-0', showSummary ? 'lg:col-span-7' : 'lg:col-span-1')}>
          <Card padding="lg" className="animate-fade-in">
            {/* key=step: cada passo entra com animate-rise (o Card em si não remonta). */}
            <div key={step} className="animate-rise">
              {step === 'service' ? <StepService fullWidth={!showSummary} /> : <StepContent />}
            </div>

            {/* Voltar/Continuar sempre no widget da esquerda, inclusive na Revisão;
                "Continuar" fica bloqueado ali (pagar é o par Reiniciar/Pagar na aside). */}
            {step !== 'payment' && (
              <ActionBar className="mt-8 border-t border-border-subtle pt-5">
                <Button
                  variant="secondary"
                  onClick={() => (step === 'review' ? exit.goBackFromReview() : prevStep())}
                  disabled={!canGoBack}
                  leftIcon={<ChevronLeft className="h-4 w-4" />}
                >
                  Voltar
                </Button>
                <Button
                  onClick={handleContinue}
                  disabled={riotLookupLoading || !stepComplete || isReviewStep}
                  rightIcon={<ChevronRight className="h-4 w-4" />}
                >
                  Continuar
                </Button>
              </ActionBar>
            )}
          </Card>

          {/* Popup de pagamento -- só abre por ação explícita na revisão. */}
          {step === 'review' && (
            <Modal open={exit.pixModalOpen} onOpenChange={exit.handlePixModalOpenChange} title="Pagamento" maxWidth="md">
              <StepPayment insideModal />
            </Modal>
          )}

          <OrderBuilderConfirmModals
            hasPendingOrder={!!params.pendingOrderId}
            showRestartConfirm={exit.showRestartConfirm}
            onRestartOpenChange={exit.setShowRestartConfirm}
            onConfirmRestart={exit.confirmRestart}
            showExitConfirm={exit.showExitConfirm}
            onExitOpenChange={exit.setShowExitConfirm}
            onConfirmExit={exit.confirmExitPixModal}
          />
        </m.div>

        {/* Summary panel — AnimatePresence anima a entrada em sincronia com o
            encolhimento do conteúdo principal. */}
        <AnimatePresence>
          {showSummary && (
            <m.aside
              key="summary"
              layout
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 32 }}
              transition={PANEL_TRANSITION}
              className="lg:col-span-3"
            >
              <OrderBuilderSummary
                basePrice={basePrice}
                {...summary}
                serviceType={serviceType}
                couponCode={couponCode}
                isReview={step === 'review'}
                onRestart={() => exit.setShowRestartConfirm(true)}
                onPay={() => exit.setPixModalOpen(true)}
              />
            </m.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
