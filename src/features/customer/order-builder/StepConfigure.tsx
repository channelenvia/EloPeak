import { useEffect } from 'react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { FormField } from '@/components/ui/FormField'
import { cn, RANK_TIER_LABEL, RANK_TIER_ORDER, formatRank } from '@/lib/utils'
import { calcEloPrice, getWinBoostPrice, PLACEMENT_PRICE, COACHING_PRICE } from '@/lib/pricing'
import type { BoostMode, Division, QueueType, RankTier } from '@/types'
const DIVISIONS: Division[] = ['I', 'II', 'III', 'IV']
const MASTER_PLUS: RankTier[] = ['master', 'grandmaster', 'challenger']

interface RankSelectProps {
  label: string
  selectedTier: RankTier | null
  selectedDivision: Division | null
  onChange: (tier: RankTier, division: Division | null) => void
}

function RankSelect({ label, selectedTier, selectedDivision, onChange }: RankSelectProps) {
  const hasDivision = selectedTier && !MASTER_PLUS.includes(selectedTier)

  return (
    <FormField label={label} required>
      <div className="space-y-2">
        {/* Tier pills */}
        <div className="flex flex-wrap gap-1.5">
          {RANK_TIER_ORDER.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => onChange(tier, MASTER_PLUS.includes(tier) ? null : (selectedDivision ?? 'I'))}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-semibold border transition-all',
                selectedTier === tier
                  ? 'border-brand bg-brand-muted text-brand'
                  : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30 hover:text-ink'
              )}
            >
              {RANK_TIER_LABEL[tier]}
            </button>
          ))}
        </div>

        {/* Division pills (only for non-master+) */}
        {hasDivision && (
          <div className="flex gap-1.5">
            {DIVISIONS.map((div) => (
              <button
                key={div}
                type="button"
                onClick={() => onChange(selectedTier!, div)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all',
                  selectedDivision === div
                    ? 'border-brand bg-brand text-white'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                )}
              >
                {div}
              </button>
            ))}
          </div>
        )}

        {selectedTier && (
          <p className="text-xs text-brand font-medium">
            Selecionado: {formatRank(selectedTier, selectedDivision)}
          </p>
        )}
      </div>
    </FormField>
  )
}

export function StepConfigure() {
  const {
    serviceType, currentRank, targetRank, queueType, boostMode,
    winsPurchased, sessionsPurchased, customerNotes,
    setCurrentRank, setTargetRank, setQueueType, setBoostMode,
    setWinsPurchased, setSessionsPurchased, setNotes,
    setBasePrice, setEstimatedHours,
  } = useOrderBuilderStore()

  // ── Recalculate price whenever any input changes ──────────────────────────
  useEffect(() => {
    if (serviceType === 'elo_boost') {
      if (!currentRank || !targetRank) return
      const { price, hours } = calcEloPrice(
        currentRank.tier, currentRank.division ?? null,
        targetRank.tier, targetRank.division ?? null,
      )
      setBasePrice(price)
      setEstimatedHours(hours || null)
    } else if (serviceType === 'placement_matches') {
      if (!currentRank) return
      setBasePrice(PLACEMENT_PRICE[currentRank.tier] ?? 15)
      setEstimatedHours(3)
    } else if (serviceType === 'win_boost') {
      if (!winsPurchased || !currentRank) return
      const pricePerWin = getWinBoostPrice(currentRank.tier, currentRank.division ?? null)
      setBasePrice(Math.round(winsPurchased * pricePerWin * 100) / 100)
      setEstimatedHours(Math.max(1, Math.round(winsPurchased * 0.4)))
    } else if (serviceType === 'coaching') {
      if (!sessionsPurchased) return
      setBasePrice(COACHING_PRICE[sessionsPurchased] ?? 19.99)
      setEstimatedHours(sessionsPurchased)
    }
  }, [serviceType, currentRank, targetRank, winsPurchased, sessionsPurchased, setBasePrice, setEstimatedHours])

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Configurar Pedido</h2>
      <p className="text-sm text-ink-secondary mb-6">Defina seus ranks e preferências.</p>

      <div className="space-y-6">
        {/* Boost mode (solo/duo) — only for rankable boost services */}
        {(serviceType === 'elo_boost' || serviceType === 'win_boost') && (
          <FormField
            label="Modo de Boost"
            hint="Solo: o booster acessa sua conta. Duo: você joga junto com o booster."
            required
          >
            <div className="flex gap-3">
              {([['solo', 'Solo Boost', 'Booster acessa sua conta e joga por você'], ['duo', 'Duo Boost', 'Você joga junto com o booster na duo queue']] as [BoostMode, string, string][]).map(([value, label, desc]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBoostMode(value)}
                  className={cn(
                    'flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-all text-left px-4',
                    boostMode === value
                      ? 'border-brand bg-brand-muted text-brand'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                  )}
                >
                  <span className="block font-bold">{label}</span>
                  <span className="block text-[11px] font-normal mt-0.5 opacity-75">{desc}</span>
                </button>
              ))}
            </div>
          </FormField>
        )}

        {/* Queue type (for elo/win boost) */}
        {(serviceType === 'elo_boost' || serviceType === 'win_boost') && (
          <FormField label="Tipo de Fila" required>
            <div className="flex gap-3">
              {([['solo_duo', 'Solo/Duo'], ['flex', 'Flex']] as [QueueType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setQueueType(value)}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                    queueType === value
                      ? 'border-brand bg-brand-muted text-brand'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </FormField>
        )}

        {/* Rank selectors */}
        {serviceType === 'elo_boost' && (
          <>
            <RankSelect
              label="Rank Atual"
              selectedTier={currentRank?.tier ?? null}
              selectedDivision={currentRank?.division ?? null}
              onChange={(tier, division) => setCurrentRank({ tier, division })}
            />
            <RankSelect
              label="Rank Alvo"
              selectedTier={targetRank?.tier ?? null}
              selectedDivision={targetRank?.division ?? null}
              onChange={(tier, division) => setTargetRank({ tier, division })}
            />
          </>
        )}

        {(serviceType === 'placement_matches' || serviceType === 'win_boost') && (
          <RankSelect
            label={serviceType === 'placement_matches' ? 'Rank Desejado' : 'Rank Atual'}
            selectedTier={currentRank?.tier ?? null}
            selectedDivision={currentRank?.division ?? null}
            onChange={(tier, division) => setCurrentRank({ tier, division })}
          />
        )}

        {/* Wins for win boost */}
        {serviceType === 'win_boost' && (
          <FormField label="Número de Vitórias" required>
            <div className="flex flex-wrap gap-2">
              {[3, 5, 10, 15, 20, 30, 50].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setWinsPurchased(n)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all',
                    winsPurchased === n
                      ? 'border-brand bg-brand-muted text-brand'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                  )}
                >
                  {n} vitórias
                </button>
              ))}
            </div>
          </FormField>
        )}

        {/* Sessions for coaching */}
        {serviceType === 'coaching' && (
          <FormField label="Duração da Sessão" required>
            <div className="flex gap-3">
              {([['1h', 1], ['2h', 2]] as [string, number][]).map(([label, val]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSessionsPurchased(val)}
                  className={cn(
                    'flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-all',
                    sessionsPurchased === val
                      ? 'border-brand bg-brand-muted text-brand'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </FormField>
        )}

        {/* Notes */}
        <FormField label="Observações para o Booster" hint="Opcional: preferências de campeão, horário, pedidos especiais.">
          <textarea
            value={customerNotes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex: Só jogar com Jinx ADC, preferência pela manhã..."
            className="input-base min-h-[80px] resize-none"
            maxLength={500}
          />
        </FormField>
      </div>
    </div>
  )
}
