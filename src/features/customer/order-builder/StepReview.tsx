import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { formatRank, getServiceLabel } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { Button } from '@/components/ui'
import { Shield, Clock, Star, ChevronRight, ChevronLeft } from 'lucide-react'

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-bg-elevated last:border-0">
      <span className="text-sm text-ink-secondary">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  )
}

export function StepReview() {
  const {
    gameSlug, serviceType, currentRank, targetRank, queueType, boostMode,
    server, winsPurchased, sessionsPurchased, selectedExtras,
    currentLp, avgLpGain, avgLpLoss, targetLp,
    basePrice, extrasPrice, estimatedHours, customerNotes,
    setNotes, nextStep, prevStep,
  } = useOrderBuilderStore()
  const MASTER_PLUS = ['master', 'grandmaster', 'challenger']
  const currency = useCurrency()

  const totalPrice = basePrice + extrasPrice
  const serviceName = serviceType ? getServiceLabel(serviceType) : '—'

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Revisar Pedido</h2>
      <p className="text-sm text-ink-secondary mb-6">
        Confirme se tudo está correto antes do pagamento.
      </p>

      <div className="space-y-5">
        {/* Order details */}
        <div>
          <p className="section-label mb-2">Detalhes do Pedido</p>
          <div className="card p-0 px-2">
            {gameSlug && (
              <ReviewRow label="Jogo" value={gameSlug === 'lol' ? 'League of Legends' : gameSlug.toUpperCase()} />
            )}
            <ReviewRow label="Serviço" value={serviceName} />
            {server && <ReviewRow label="Servidor" value={server} />}
            {serviceType === 'elo_boost' && (
              <ReviewRow label="Modo" value={boostMode === 'duo' ? 'Duo Boost (+50%)' : 'Solo Boost'} />
            )}
            {(serviceType === 'elo_boost' || serviceType === 'win_boost') && (
              <ReviewRow label="Fila" value={queueType === 'solo_duo' ? 'Solo/Duo' : 'Flex'} />
            )}
            {currentRank && (
              <ReviewRow
                label={serviceType === 'placement_matches' ? 'Rank Final (Temporada Ant.)' : 'Rank Atual'}
                value={formatRank(currentRank.tier, currentRank.division)}
              />
            )}
            {targetRank && serviceType === 'elo_boost' && !MASTER_PLUS.includes(currentRank?.tier ?? '') && (
              <ReviewRow label="Rank Alvo" value={formatRank(targetRank.tier, targetRank.division)} />
            )}
            {serviceType === 'elo_boost' && currentRank && (
              MASTER_PLUS.includes(currentRank.tier) ? (
                <>
                  <ReviewRow label="LP Atual" value={`${currentLp} LP`} />
                  {targetLp !== null && (
                    <ReviewRow label="LP Alvo" value={`${targetLp} LP`} />
                  )}
                </>
              ) : (
                <ReviewRow
                  label="PDL"
                  value={`${currentLp} LP atual · +${avgLpGain} / −${avgLpLoss} médias`}
                />
              )
            )}
            {winsPurchased && (
              <ReviewRow label="Vitórias" value={`${winsPurchased} vitórias`} />
            )}
            {sessionsPurchased && (
              <ReviewRow label="Sessão" value={`${sessionsPurchased}h`} />
            )}
            {estimatedHours && (
              <ReviewRow label="Entrega Estimada" value={`~${estimatedHours} horas`} />
            )}
          </div>
        </div>

        {/* Extras */}
        {selectedExtras.length > 0 && (
          <div>
            <p className="section-label mb-2">Extras</p>
            <div className="card p-0 px-2">
              {selectedExtras.map(({ extra }) => (
                <ReviewRow
                  key={extra.id}
                  label={extra.name}
                  value={
                    extra.price_modifier > 0
                      ? `+${currency(extra.price_modifier)}`
                      : extra.price_modifier_pct > 0
                        ? `+${extra.price_modifier_pct}%`
                        : 'Grátis'
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Price breakdown */}
        <div>
          <p className="section-label mb-2">Preços</p>
          {serviceType === 'coaching' ? (
            <div className="card p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-secondary">Coaching por sessão</span>
                <span className="text-sm font-bold text-brand">A combinar</span>
              </div>
              <p className="text-[10px] text-ink-muted">O valor será definido com o booster após a criação do pedido.</p>
            </div>
          ) : (
            <div className="card p-0 px-2">
              <ReviewRow label="Preço Base" value={currency(basePrice)} />
              {extrasPrice > 0 && (
                <ReviewRow label="Extras" value={`+${currency(extrasPrice)}`} />
              )}
              <div className="flex items-center justify-between py-3">
                <span className="text-base font-bold text-ink">Total</span>
                <span className="text-xl font-extrabold text-brand">{currency(totalPrice)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Guarantees */}
        <div className="flex flex-col sm:flex-row gap-3">
          {[
            { icon: Shield, text: 'VPN & proteção da conta' },
            { icon: Star,   text: 'Garantia 100% de conclusão' },
            { icon: Clock,  text: 'Inicia em até 30 min' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2 text-xs text-ink-secondary">
              <Icon className="h-3.5 w-3.5 text-success shrink-0" />
              {text}
            </div>
          ))}
        </div>

        {/* Notes — editable before payment */}
        <div>
          <p className="section-label mb-2">Observações para o Booster <span className="font-normal normal-case text-ink-muted">(opcional)</span></p>
          <textarea
            value={customerNotes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex: Só jogar com Jinx ADC, preferência pela manhã, lane específica..."
            className="input-base w-full min-h-[80px] resize-none"
            maxLength={500}
          />
          {customerNotes.length > 400 && (
            <p className="text-[10px] text-ink-muted mt-1 text-right">{customerNotes.length}/500</p>
          )}
        </div>

        {/* CTA */}
        <div className="flex gap-3">
          <Button
            onClick={prevStep}
            size="lg"
            variant="secondary"
            leftIcon={<ChevronLeft className="h-5 w-5" />}
            className="shrink-0"
          >
            Voltar
          </Button>
          <Button
            onClick={nextStep}
            size="lg"
            className="flex-1"
            disabled={totalPrice <= 0 && serviceType !== 'coaching'}
            rightIcon={<ChevronRight className="h-5 w-5" />}
          >
            {serviceType === 'coaching' ? 'Confirmar Pedido' : `Ir para Pagamento — ${currency(totalPrice)}`}
          </Button>
        </div>
        {totalPrice <= 0 && serviceType !== 'coaching' && (
          <p className="text-xs text-danger text-center">Configure seu pedido para ver o preço.</p>
        )}

        <p className="text-xs text-ink-muted text-center">
          Pagamento processado pelo Mercado Pago. Seus dados nunca tocam nossos servidores.
        </p>
      </div>
    </div>
  )
}
