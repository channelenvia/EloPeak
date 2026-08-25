import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { formatEstimatedDelivery, orderRequiresAccountAccess } from '@/lib/utils'
import { isMasterPlusCurrentTier } from '@/lib/boostDomain'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { GuaranteeNotice } from '@/components/ui'
import { ClashDetailsBlock } from '@/components/order/ClashDetailsBlock'
import { OrderRankRow } from '@/components/order/OrderRankRow'
import { OrderInfoGrid, type OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { WinsRemainingBadge } from '@/components/order/OrderRankSummary'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { Shuffle, Users, Hash, Clock, UserCheck, Route } from 'lucide-react'

export function StepReview() {
  const {
    serviceType, currentRank, targetRank, queueType, boostMode,
    isMd5, riotId,
    currentLp, currentPdl,
    estimatedHours, customerNotes, winsPurchased,
    setNotes, selectedCoachPackage, sessionsPurchased,
    clashTier, clashDay, preferredBoosterName,
    customerLanes,
  } = useOrderBuilderStore()

  const currentIsMasterPlus = currentRank ? isMasterPlusCurrentTier(currentRank.tier) : false
  const showAccountAccessNotice = serviceType != null && orderRequiresAccountAccess({ service_type: serviceType, boost_mode: boostMode })
  const showWinsGuarantee = serviceType === 'win_boost' || serviceType === 'md5'

  const isBoostFlow = serviceType === 'elo_boost' || serviceType === 'win_boost' || serviceType === 'md5'
  const isClash = serviceType === 'clash'
  const modoLabel = serviceType === 'elo_boost'
    ? (boostMode === 'duo' ? 'Duo Boost' : 'Solo Boost')
    : serviceType === 'md5'
      ? (boostMode === 'duo' ? 'Duo MD5' : 'MD5')
      : serviceType === 'win_boost'
        ? (boostMode === 'duo' ? 'Duo Vitórias' : 'Vitórias')
        : isClash
          ? (boostMode === 'duo' ? 'Duo Clash' : 'Solo Clash')
          : ''
  const clashClosingLabel = isClash && clashDay
    ? (() => {
        const { day, month } = getClashDateParts(new Date().toISOString(), clashDay)
        return `Até 23h de ${day}/${month} (${CLASH_DAY_LABEL[clashDay]})`
      })()
    : null

  // Mesmos campos exibidos no "Detalhes do Pedido" de um pedido em
  // andamento (OrderDetail.tsx) -- via OrderInfoGrid, o mesmo componente,
  // não uma cópia -- só que restrito ao que já existe antes do pedido
  // nascer: sem preço, sem booster, sem contagem de partidas jogadas.
  const infoItems: OrderInfoGridItem[] = [
    ...((isBoostFlow || isClash) ? [{ icon: Shuffle, label: 'Modo', value: modoLabel }] : []),
    ...(isBoostFlow ? [{ icon: Users, label: 'Fila', value: queueType === 'solo_duo' ? 'Solo/Duo' : 'Flex' }] : []),
    ...((isBoostFlow || isClash) && riotId.trim() ? [{ icon: Hash, label: 'Riot ID', value: riotId.trim() }] : []),
    ...((isBoostFlow || isClash) && customerLanes.length > 0
      ? [{
          icon: Route,
          label: boostMode === 'duo' ? 'Suas rotas' : 'Rotas para o booster',
          value: <ServiceTagPills lanes={customerLanes} compact />,
        }]
      : []),
    ...(isClash
      ? (clashClosingLabel ? [{ icon: Clock, label: 'Entrega Estimada', value: clashClosingLabel }] : [])
      : (estimatedHours ? [{ icon: Clock, label: 'Entrega Estimada', value: formatEstimatedDelivery(estimatedHours) }] : [])),
  ]

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Revisar Pedido</h2>
      <p className="text-sm text-ink-secondary mb-7">
        Confirme se tudo está correto antes do pagamento.
      </p>

      <div className="space-y-7">
        {/* Order details */}
        <div>
          <p className="section-label mb-3">Detalhes do Pedido</p>
          <div className="card p-6">
            {serviceType === 'coaching' && selectedCoachPackage && (
              <div className="space-y-3">
                {preferredBoosterName && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                    <UserCheck className="h-3.5 w-3.5" />
                    Pedido exclusivo para {preferredBoosterName}
                  </div>
                )}
                <p className="text-base font-bold text-ink">{selectedCoachPackage.title}</p>
                {selectedCoachPackage.description && (
                  <p className="text-sm text-ink-secondary leading-relaxed">{selectedCoachPackage.description}</p>
                )}
                <ServiceTagPills lanes={selectedCoachPackage.lanes} champions={selectedCoachPackage.champions} specialties={selectedCoachPackage.specialties} />
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-xs text-ink-muted">
                  {selectedCoachPackage.tempo && <span>Duração: <span className="font-semibold text-ink">{selectedCoachPackage.tempo}</span></span>}
                  {sessionsPurchased && <span>Sessões: <span className="font-semibold text-ink">{sessionsPurchased}</span></span>}
                </div>
              </div>
            )}

            {isClash && clashTier && (
              <ClashDetailsBlock
                viewerRole="customer"
                boostMode={boostMode}
                clashTier={clashTier}
                clashDay={clashDay}
                createdAt={new Date().toISOString()}
              />
            )}

            {currentRank && !isClash && (
              <div className="mb-4 pb-5 border-b border-border-subtle">
                <OrderRankRow
                  currentTier={currentRank.tier}
                  currentDivision={currentRank.division}
                  targetTier={serviceType === 'elo_boost' ? targetRank?.tier ?? null : null}
                  targetDivision={serviceType === 'elo_boost' ? targetRank?.division ?? null : null}
                  currentLabel={isMd5 ? 'Rank na Temporada Passada' : 'Rank Atual'}
                  centerContent={
                    serviceType === 'elo_boost' ? (
                      <span className="text-sm font-bold text-brand whitespace-nowrap" data-tabular>
                        {currentIsMasterPlus ? `${currentPdl} PDL` : `${currentLp} LP`}
                      </span>
                    ) : undefined
                  }
                  targetSlot={
                    (serviceType === 'win_boost' || serviceType === 'md5') && winsPurchased
                      ? <WinsRemainingBadge purchased={winsPurchased} remaining={winsPurchased} />
                      : undefined
                  }
                />
              </div>
            )}

            <OrderInfoGrid items={infoItems} />
          </div>
        </div>

        {(showWinsGuarantee || showAccountAccessNotice) && (
          <div className={`grid grid-cols-1 gap-4 ${showWinsGuarantee && showAccountAccessNotice ? 'md:grid-cols-2' : ''}`}>
            {showWinsGuarantee && (
              <GuaranteeNotice title={isMd5 ? 'Garantia de Win Rate MD5' : 'Garantia de Win Rate - Vitórias Extras'}>
                {isMd5
                  ? 'Asseguramos uma taxa de vitória de 80% ou mais nas suas partidas classificatórias. Caso o desempenho final fique abaixo desse percentual, adicionamos vitórias extras como compensação até atingir o resultado acordado.'
                  : 'Trabalhamos com o sistema de vitórias líquidas, considerando o saldo entre vitórias e derrotas. Se houver alguma derrota durante o serviço, ela será compensada com uma vitória adicional, garantindo que você receba exatamente a quantidade de vitórias contratada. Exemplo: você compra 2 vitórias. Se o resultado for 3 vitórias e 1 derrota, o saldo final será de +2 vitórias líquidas, exatamente como contratado.'}
              </GuaranteeNotice>
            )}

            {showAccountAccessNotice && (
              <GuaranteeNotice title="Evite entrar na conta durante o pedido" variant="warning">
                Nesse tipo de serviço, o booster faz login e joga direto na sua conta. Para não
                atrapalhar o progresso nem gerar divergência de resultado, evite entrar na conta
                até o pedido ser finalizado — você pode acompanhar tudo por aqui e pelo chat com o
                booster.
              </GuaranteeNotice>
            )}
          </div>
        )}

        {/* Notes — editable before payment */}
        <div>
          <p className="section-label mb-3">Observações para o Booster <span className="font-normal normal-case text-ink-muted">(opcional)</span></p>
          <textarea
            value={customerNotes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex: Só jogar com Jinx ADC, preferência pela manhã, lane específica..."
            className="input-base w-full min-h-[96px] resize-none"
            maxLength={500}
          />
          {customerNotes.length > 400 && (
            <p className="text-[10px] text-ink-muted mt-1 text-right">{customerNotes.length}/500</p>
          )}
        </div>

        <p className="text-xs text-ink-muted text-center">
          Pagamento processado pelo Mercado Pago. Seus dados nunca tocam nossos servidores.
        </p>
      </div>
    </div>
  )
}
