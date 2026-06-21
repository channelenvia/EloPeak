import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { formatRank } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { Button } from '@/components/ui'
import { Shield, Clock, Star, ChevronRight } from 'lucide-react'

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
    basePrice, extrasPrice, estimatedHours, customerNotes,
    nextStep,
  } = useOrderBuilderStore()
  const currency = useCurrency()

  const totalPrice = basePrice + extrasPrice

  const serviceName = serviceType
    ? serviceType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : '—'

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
            <ReviewRow label="Jogo" value={gameSlug === 'lol' ? 'League of Legends' : (gameSlug?.toUpperCase() ?? '—')} />
            <ReviewRow label="Serviço" value={serviceName} />
            <ReviewRow label="Servidor" value={server} />
            <ReviewRow label="Modo" value={boostMode === 'duo' ? 'Duo Boost' : 'Solo Boost'} />
            <ReviewRow label="Fila" value={queueType === 'solo_duo' ? 'Solo/Duo' : 'Flex'} />
            {currentRank && (
              <ReviewRow label="Rank Atual" value={formatRank(currentRank.tier, currentRank.division)} />
            )}
            {targetRank && (
              <ReviewRow label="Rank Alvo" value={formatRank(targetRank.tier, targetRank.division)} />
            )}
            {winsPurchased && (
              <ReviewRow label="Vitórias" value={`${winsPurchased} vitórias`} />
            )}
            {sessionsPurchased && (
              <ReviewRow label="Sessões" value={`${sessionsPurchased}h`} />
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

        {/* Notes */}
        {customerNotes && (
          <div>
            <p className="section-label mb-2">Observações</p>
            <div className="card p-3">
              <p className="text-sm text-ink-secondary">{customerNotes}</p>
            </div>
          </div>
        )}

        {/* Price breakdown */}
        <div>
          <p className="section-label mb-2">Preços</p>
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
        </div>

        {/* Guarantees */}
        <div className="flex flex-col sm:flex-row gap-3">
          {[
            { icon: Shield, text: 'VPN & proteção da conta' },
            { icon: Star, text: 'Garantia 100% de conclusão' },
            { icon: Clock, text: 'Inicia em até 30 min' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2 text-xs text-ink-secondary">
              <Icon className="h-3.5 w-3.5 text-success shrink-0" />
              {text}
            </div>
          ))}
        </div>

        {/* Proceed CTA */}
        <Button
          onClick={nextStep}
          size="lg"
          className="w-full"
          disabled={totalPrice <= 0}
          rightIcon={<ChevronRight className="h-5 w-5" />}
        >
          Ir para Pagamento — {currency(totalPrice)}
        </Button>
        {totalPrice <= 0 && (
          <p className="text-xs text-danger text-center">Configure seu pedido para ver o preço.</p>
        )}

        <p className="text-xs text-ink-muted text-center">
          Pagamento processado pelo Mercado Pago. Seus dados nunca tocam nossos servidores.
        </p>
      </div>
    </div>
  )
}
