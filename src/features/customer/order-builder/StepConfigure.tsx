import { useEffect } from 'react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { FormField } from '@/components/ui/FormField'
import { RankBadge } from '@/components/ui/RankBadge'
import { cn, RANK_TIER_LABEL, RANK_TIER_ORDER, formatRank } from '@/lib/utils'
import {
  calcEloPrice, getWinBoostPrice, PLACEMENT_PRICE, DUO_BOOST_PCT,
  calcMasterPlusPrice, applyLpModifier,
} from '@/lib/pricing'
import type { BoostMode, Division, QueueType, RankTier } from '@/types'

const DIVISIONS: Division[] = ['IV', 'III', 'II', 'I']
const MASTER_PLUS: RankTier[] = ['master', 'grandmaster', 'challenger']

function divStep(d: Division): number {
  return { IV: 0, III: 1, II: 2, I: 3 }[d]
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface RankSelectProps {
  label: string
  selectedTier: RankTier | null
  selectedDivision: Division | null
  onChange: (tier: RankTier, division: Division | null) => void
  minTier?: RankTier | null
  minDiv?: Division | null
  maxTier?: RankTier | null
}

function RankSelect({ label, selectedTier, selectedDivision, onChange, minTier, minDiv, maxTier }: RankSelectProps) {
  const hasDivision = selectedTier && !MASTER_PLUS.includes(selectedTier)
  const minIdx = minTier ? RANK_TIER_ORDER.indexOf(minTier) : 0
  const maxIdx = maxTier ? RANK_TIER_ORDER.indexOf(maxTier) + 1 : undefined
  const availableTiers = RANK_TIER_ORDER.slice(minIdx, maxIdx)

  const validDivisions = hasDivision
    ? DIVISIONS.filter(d => {
        if (!minTier || selectedTier !== minTier) return true
        return divStep(d) > divStep(minDiv ?? 'IV')
      })
    : []

  function handleTier(tier: RankTier) {
    const div = MASTER_PLUS.includes(tier) ? null : (selectedDivision ?? 'IV')
    if (minTier && tier === minTier && minDiv) {
      const first = DIVISIONS.find(d => divStep(d) > divStep(minDiv))
      onChange(tier, first ?? 'I')
      return
    }
    onChange(tier, div)
  }

  return (
    <FormField label={label} required>
      <div className="space-y-3">
        {selectedTier && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-elevated/50 border border-bg-overlay">
            <RankBadge tier={selectedTier} division={selectedDivision} size="sm" showLabel={false} />
            <p className="text-sm font-bold text-ink">
              {formatRank(selectedTier, selectedDivision)}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {availableTiers.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => handleTier(tier)}
              className={cn(
                'flex items-center gap-2 px-2 py-1 rounded-xl ring-2 transition-all focus:outline-none',
                selectedTier === tier ? 'ring-brand bg-brand/10' : 'ring-transparent hover:ring-brand/30 bg-bg-elevated/40'
              )}
            >
              <RankBadge tier={tier} showDivision={false} size="xs" showLabel={false} />
              <span className={cn(
                'text-xs font-semibold leading-none',
                selectedTier === tier ? 'text-brand' : 'text-ink-secondary'
              )}>
                {RANK_TIER_LABEL[tier]}
              </span>
            </button>
          ))}
        </div>

        {hasDivision && validDivisions.length > 0 && (
          <div className="flex gap-1.5">
            {validDivisions.map((div) => (
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
      </div>
    </FormField>
  )
}

function LpCounter({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-ink-secondary">{label}</p>
      <div className="flex items-center rounded-xl border-2 border-bg-elevated bg-bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="px-3 py-2 text-sm font-bold text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-all"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => {
            const v = parseInt(e.target.value)
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
          }}
          className="flex-1 text-center py-2 border-x border-bg-elevated bg-transparent text-sm font-extrabold text-ink focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="px-3 py-2 text-sm font-bold text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-all"
        >
          +
        </button>
      </div>
    </div>
  )
}

function LpFieldsIronDiamond({ currentLp, avgLpGain, avgLpLoss, onCurrentLp, onAvgGain, onAvgLoss }: {
  currentLp: number; avgLpGain: number; avgLpLoss: number;
  onCurrentLp: (v: number) => void; onAvgGain: (v: number) => void; onAvgLoss: (v: number) => void
}) {
  return (
    <div className="rounded-xl border border-bg-elevated bg-bg-elevated/20 p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">PDL</p>
      <div className="grid grid-cols-3 gap-3">
        <LpCounter label="LP Atual" value={currentLp} min={0} max={99} onChange={onCurrentLp} />
        <LpCounter label="Média Ganhos" value={avgLpGain} min={1} max={50} onChange={onAvgGain} />
        <LpCounter label="Média Perdidos" value={avgLpLoss} min={1} max={40} onChange={onAvgLoss} />
      </div>
      <p className="text-[10px] text-ink-muted leading-relaxed">
        Seu LP na divisão atual e médias influenciam o cálculo de preço.
      </p>
    </div>
  )
}

function LpFieldsMasterPlus({ currentLp, targetLp, onCurrentLp, onTargetLp }: {
  currentLp: number; targetLp: number | null;
  onCurrentLp: (v: number) => void; onTargetLp: (v: number | null) => void
}) {
  return (
    <div className="rounded-xl border border-bg-elevated bg-bg-elevated/20 p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">LP</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-secondary">LP Atual</p>
          <input
            type="number"
            min={0}
            max={9999}
            value={currentLp || ''}
            onChange={e => onCurrentLp(Math.max(0, parseInt(e.target.value) || 0))}
            placeholder="ex: 200"
            className="input-base text-center font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-secondary">LP Alvo</p>
          <input
            type="number"
            min={0}
            max={9999}
            value={targetLp ?? ''}
            onChange={e => {
              const v = parseInt(e.target.value)
              onTargetLp(isNaN(v) ? null : Math.max(0, v))
            }}
            placeholder="ex: 800"
            className="input-base text-center font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>
      <p className="text-[10px] text-ink-muted">O preço é calculado com base na diferença de LP.</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function StepConfigure() {
  const {
    serviceType, currentRank, targetRank, queueType, boostMode,
    winsPurchased, sessionsPurchased,
    currentLp, avgLpGain, avgLpLoss, targetLp,
    setCurrentRank, setTargetRank, setQueueType, setBoostMode,
    setWinsPurchased, setSessionsPurchased,
    setCurrentLp, setAvgLpGain, setAvgLpLoss, setTargetLp,
    setBasePrice, setEstimatedHours,
  } = useOrderBuilderStore()

  const currentIsMasterPlus = currentRank ? MASTER_PLUS.includes(currentRank.tier) : false

  useEffect(() => {
    if (serviceType === 'elo_boost') {
      if (!currentRank) return

      if (currentIsMasterPlus) {
        if (targetLp === null || targetLp <= currentLp) {
          setBasePrice(0)
          setEstimatedHours(null)
          return
        }
        const price = calcMasterPlusPrice(currentRank.tier, currentLp, targetLp)
        const finalPrice = boostMode === 'duo'
          ? Math.round(price * (1 + DUO_BOOST_PCT / 100) * 100) / 100
          : price
        setBasePrice(finalPrice)
        setEstimatedHours(Math.max(1, Math.round((targetLp - currentLp) / 25)))
        return
      }

      if (!targetRank) return
      const { price, hours } = calcEloPrice(
        currentRank.tier, currentRank.division ?? null,
        targetRank.tier, targetRank.division ?? null,
      )
      const withLp = applyLpModifier(price, currentRank.tier, currentLp, avgLpGain, avgLpLoss)
      const finalPrice = boostMode === 'duo'
        ? Math.round(withLp * (1 + DUO_BOOST_PCT / 100) * 100) / 100
        : withLp
      setBasePrice(finalPrice)
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
      setBasePrice(0)
      setEstimatedHours(sessionsPurchased ?? 1)
    }
  }, [
    serviceType, currentRank, targetRank, boostMode, winsPurchased, sessionsPurchased,
    currentLp, avgLpGain, avgLpLoss, targetLp, currentIsMasterPlus,
    setBasePrice, setEstimatedHours,
  ])

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Configurar Pedido</h2>
      <p className="text-sm text-ink-secondary mb-6">Defina seus ranks e preferências.</p>

      <div className="space-y-6">
        {/* Duo Boost toggle */}
        {serviceType === 'elo_boost' && (
          <FormField label="Extras" hint="Duo Boost: você joga junto ao booster na duo queue (+50% no preço).">
            <button
              type="button"
              onClick={() => setBoostMode(boostMode === 'duo' ? 'solo' : 'duo')}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left',
                boostMode === 'duo'
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30 hover:text-ink'
              )}
            >
              <div>
                <p className="text-sm font-bold">Duo Boost <span className="text-xs font-normal opacity-70">(+50%)</span></p>
                <p className="text-[11px] font-normal mt-0.5 opacity-70">Você joga junto com o booster na duo queue</p>
              </div>
              <div className={cn(
                'h-5 w-5 rounded border-2 flex items-center justify-center shrink-0',
                boostMode === 'duo' ? 'border-brand bg-brand' : 'border-bg-overlay'
              )}>
                {boostMode === 'duo' && <span className="text-white text-[10px] font-black">✓</span>}
              </div>
            </button>
          </FormField>
        )}

        {/* Queue type */}
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
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </FormField>
        )}

        {/* Ranks — elo boost */}
        {serviceType === 'elo_boost' && (
          <>
            <RankSelect
              label="Rank Atual"
              selectedTier={currentRank?.tier ?? null}
              selectedDivision={currentRank?.division ?? null}
              onChange={(tier, division) => {
                setCurrentRank({ tier, division })
                if (MASTER_PLUS.includes(tier)) {
                  setCurrentLp(0)
                  setTargetLp(null)
                  setTargetRank(null)
                } else {
                  setTargetLp(null)
                  setCurrentLp(0)
                }
              }}
              maxTier="grandmaster"
            />

            {/* LP fields — Iron-Diamond */}
            {currentRank && !currentIsMasterPlus && (
              <LpFieldsIronDiamond
                currentLp={currentLp}
                avgLpGain={avgLpGain}
                avgLpLoss={avgLpLoss}
                onCurrentLp={setCurrentLp}
                onAvgGain={setAvgLpGain}
                onAvgLoss={setAvgLpLoss}
              />
            )}

            {/* Master+: LP Atual + LP Alvo (replaces Rank Alvo) */}
            {currentRank && currentIsMasterPlus ? (
              <LpFieldsMasterPlus
                currentLp={currentLp}
                targetLp={targetLp}
                onCurrentLp={setCurrentLp}
                onTargetLp={setTargetLp}
              />
            ) : (
              <RankSelect
                label="Rank Alvo"
                selectedTier={targetRank?.tier ?? null}
                selectedDivision={targetRank?.division ?? null}
                onChange={(tier, division) => setTargetRank({ tier, division })}
                minTier={currentRank?.tier ?? null}
                minDiv={currentRank?.division ?? null}
              />
            )}
          </>
        )}

        {/* Rank — win boost */}
        {serviceType === 'win_boost' && (
          <RankSelect
            label="Rank Atual"
            selectedTier={currentRank?.tier ?? null}
            selectedDivision={currentRank?.division ?? null}
            onChange={(tier, division) => setCurrentRank({ tier, division })}
          />
        )}

        {/* Rank — MD5 */}
        {serviceType === 'placement_matches' && (
          <RankSelect
            label="Rank Final da Última Temporada"
            selectedTier={currentRank?.tier ?? null}
            selectedDivision={currentRank?.division ?? null}
            onChange={(tier, division) => setCurrentRank({ tier, division })}
          />
        )}

        {/* Wins counter — win boost */}
        {serviceType === 'win_boost' && (
          <FormField label="Número de Vitórias" required>
            <div className="flex items-center gap-0 rounded-xl border-2 border-bg-elevated bg-bg-card overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => setWinsPurchased(Math.max(1, (winsPurchased ?? 1) - 1))}
                className="px-4 py-3 text-lg font-bold text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-all"
              >
                −
              </button>
              <div className="px-6 py-3 text-center min-w-[110px] border-x border-bg-elevated">
                <p className="text-xl font-extrabold text-ink leading-none">{winsPurchased ?? 1}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">vitórias</p>
              </div>
              <button
                type="button"
                onClick={() => setWinsPurchased(Math.min(50, (winsPurchased ?? 1) + 1))}
                className="px-4 py-3 text-lg font-bold text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-all"
              >
                +
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-1.5">Mínimo 1 · Máximo 50</p>
          </FormField>
        )}

        {/* Coaching */}
        {serviceType === 'coaching' && (
          <div className="rounded-xl border border-bg-elevated bg-bg-elevated/40 p-4 space-y-1.5">
            <p className="text-sm font-semibold text-ink">Coaching por sessão</p>
            <p className="text-xs text-ink-secondary leading-relaxed">
              O valor é combinado diretamente com o booster após a criação do pedido. Nenhum pagamento antecipado é necessário.
            </p>
            <p className="text-sm font-bold text-brand mt-1">Valor a combinar</p>
          </div>
        )}
      </div>
    </div>
  )
}
