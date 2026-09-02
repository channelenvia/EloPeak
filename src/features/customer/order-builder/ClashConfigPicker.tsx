// src/features/customer/order-builder/ClashConfigPicker.tsx
import { useEffect, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { RankBadge, ErrorAlert, InlineFieldSelect } from '@/components/ui'
import { FormField } from '@/components/ui/FormField'
import { LaneSelectField } from '@/components/order/LaneSelectField'
import { getClashBasePrice, CLASH_ESTIMATED_HOURS } from '@/lib/pricing'
import {
  CLASH_TIER_LABEL, CLASH_TIER_RANGE_LABEL, CLASH_TIER_BOUNDARY_RANKS, CLASH_DAY_LABEL, rankTierToClashTier,
} from '@/lib/clashDomain'
// Mesma consulta riot-account-rank (fila fixa solo_duo) já usada pelo admin
// pra reconsultar rank de conta Duo — não é específico de duo_accounts, só
// nasceu ali primeiro. Reaproveitado aqui em vez de duplicar o fetch.
import { lookupDuoAccountRiotRank } from '@/api/duoAccounts'
import type { ClashDay, BoostMode } from '@/types'

// Mesmo formato aceito pelo backend (riot-account-rank bodySchema) e usado
// em StepConfigure.tsx para elo_boost/win_boost/md5.
const RIOT_ID_FORMAT = /^[^#]{1,16}#[^#]{2,5}$/

const CLASH_DAY_OPTIONS: readonly [ClashDay, ClashDay] = ['saturday', 'sunday']
const CLASH_MODES: { mode: BoostMode; title: string; desc: string }[] = [
  { mode: 'solo', title: 'Solo Clash', desc: 'O booster joga na sua conta e monta o time dentro do jogo.' },
  { mode: 'duo', title: 'Duo Clash', desc: 'Você joga junto com o booster, que monta o restante do time.' },
]

export function ClashConfigPicker() {
  const {
    boostMode, setBoostMode, clashTier, setClashTier, clashDay, setClashDay,
    setBasePrice, setEstimatedHours, setPdlModifierPct, stepAttempted,
    riotId, setRiotId, riotVerified, setRiotVerified, riotAutoFilled, setRiotAutoFilled,
    riotLookupLoading, setRiotLookupLoading, clearRiotLookup, setClashCurrentRank,
    customerLanes, setCustomerLanes,
  } = useOrderBuilderStore()
  const currency = useCurrency()
  const [riotLookupMessage, setRiotLookupMessage] = useState<string | null>(null)
  const [riotLookupError, setRiotLookupError] = useState<string | null>(null)
  const detectedTierRanks = clashTier ? CLASH_TIER_BOUNDARY_RANKS[clashTier] : null

  useEffect(() => {
    setPdlModifierPct(null)
    if (!clashTier) {
      setBasePrice(0)
      setEstimatedHours(null)
      return
    }
    setBasePrice(getClashBasePrice(boostMode, clashTier))
    setEstimatedHours(CLASH_ESTIMATED_HOURS)
  }, [boostMode, clashTier, setBasePrice, setEstimatedHours, setPdlModifierPct])

  // O dia agora vive num seletor embutido no campo Riot ID (sempre mostra
  // um valor, igual o Tipo de Fila em StepConfigure.tsx) em vez de dois
  // botões lado a lado sem seleção prévia -- por isso precisa de um
  // padrão assim que a tela abre, em vez de ficar null até o clique.
  useEffect(() => {
    if (!clashDay) setClashDay('saturday')
  }, [clashDay, setClashDay])

  // Riot ID obrigatório nos dois modos: no Solo é referência do booster
  // antes de logar via credenciais; no Duo é o identificador que o booster
  // usa pra convidar o cliente pro time dentro do jogo. A busca resolve o
  // rank atual na fila solo/duo e preenche o tier de Clash sozinho
  // (rankTierToClashTier). Sem rank nesta fila não há como determinar o tier
  // do Clash, então o restante da configuração continua oculto.
  async function lookupRiotRank() {
    if (riotLookupLoading) return
    const trimmed = riotId.trim()
    setRiotLookupMessage(null)
    setRiotLookupError(null)
    if (!RIOT_ID_FORMAT.test(trimmed)) {
      setRiotLookupError('Riot ID inválido. Use o formato Nome#TAG (ex.: Fulano#BR1).')
      return
    }
    clearRiotLookup()
    setClashTier(null)

    setRiotLookupLoading(true)
    try {
      const result = await lookupDuoAccountRiotRank(trimmed)
      if (!result?.found) {
        setRiotLookupError('Conta Riot não encontrada.')
        return
      }
      if (!result.ranked || !result.tier) {
        setRiotLookupError('Não foi possível detectar o tier: esta conta não tem rank na fila solo/duo.')
        return
      }
      setClashTier(rankTierToClashTier(result.tier))
      // Rank real (tier+divisão+LP) além do tier/faixa -- só pro card de
      // detalhes do pedido, nunca usado pra precificar (isso continua sendo
      // só o tier de Clash). Ver setClashCurrentRank: não passa pelas regras
      // de Master+/Duo do setCurrentRank de elo_boost, que não fazem sentido
      // aqui.
      setClashCurrentRank({ tier: result.tier, division: result.division ?? null }, result.league_points ?? 0)
      setRiotAutoFilled(true)
      setRiotVerified(true)
      setRiotLookupMessage('Tier detectado automaticamente pelo seu rank atual.')
    } catch (error) {
      setRiotLookupError(error instanceof Error ? error.message : 'Não foi possível consultar a Riot agora.')
    } finally {
      setRiotLookupLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-ink-muted mb-3">Modalidade</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {CLASH_MODES.map(({ mode, title, desc }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBoostMode(mode)}
              className={cn(
                'relative text-left p-4 rounded-2xl border-2 transition-all duration-150',
                boostMode === mode
                  ? 'border-brand bg-brand/10 shadow-brand'
                  : 'border-border-subtle bg-bg-card hover:border-brand/40 hover:bg-bg-elevated',
              )}
            >
              <p className={cn('text-sm font-bold', boostMode === mode ? 'text-brand' : 'text-ink')}>{title}</p>
              <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{desc}</p>
              {boostMode === mode && <Check className="absolute top-3 right-3 h-4 w-4 text-brand" />}
            </button>
          ))}
        </div>
      </div>

      {/* Riot ID com largura máxima na linha -- o dia do Clash (antes um
          FormField à parte, ao lado) fica embutido no fim do próprio
          campo, mesmo padrão do Tipo de Fila em StepConfigure.tsx. Riot ID
          obrigatório nos dois modos — no Solo é referência do booster (que
          loga via credenciais), no Duo é o identificador que o booster usa
          pra te convidar pro time dentro do jogo. A busca preenche o tier
          sozinho a partir do rank atual na fila solo/duo. */}
      <FormField
        label="Riot ID"
        required
        error={stepAttempted && !riotId.trim() ? 'Campo obrigatório' : undefined}
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={riotId}
              onChange={e => {
                setRiotId(e.target.value)
                setClashTier(null)
                setRiotLookupMessage(null)
                setRiotLookupError(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void lookupRiotRank()
                }
              }}
              placeholder="NomeDoInvocador#TAG"
              className="input-base w-full pr-[8.5rem]"
              maxLength={32}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <InlineFieldSelect
                value={clashDay ?? 'saturday'}
                options={CLASH_DAY_OPTIONS}
                label={day => CLASH_DAY_LABEL[day]}
                onChange={setClashDay}
                fieldLabel="dia do Clash"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void lookupRiotRank()}
            disabled={riotLookupLoading}
            className={cn(
              'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
              'bg-brand text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed',
            )}
          >
            <Search className="h-4 w-4" />
            {riotLookupLoading ? 'Consultando...' : 'Verificar elo'}
          </button>
        </div>
        {riotLookupMessage && <p className="mt-2 text-xs text-success">{riotLookupMessage}</p>}
        {riotLookupError && <ErrorAlert message={riotLookupError} className="mt-2" />}
      </FormField>

      {riotVerified && riotAutoFilled && clashTier && detectedTierRanks && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-muted mb-3">Tier</p>
          <div className="relative flex items-center gap-3 p-4 rounded-2xl border-2 border-brand bg-brand/10 shadow-brand">
            <div className="flex items-center shrink-0">
              <RankBadge tier={detectedTierRanks.low} size="xs" showLabel={false} />
              {detectedTierRanks.high !== detectedTierRanks.low && (
                <RankBadge tier={detectedTierRanks.high} size="xs" showLabel={false} className="-ml-2" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand">{CLASH_TIER_LABEL[clashTier]}</p>
              <p className="text-xs text-ink-secondary truncate">{CLASH_TIER_RANGE_LABEL[clashTier]}</p>
              <p className="text-xs font-bold mt-0.5 text-brand">
                {currency(getClashBasePrice(boostMode, clashTier))}
              </p>
            </div>
            <Check className="absolute top-3 right-3 h-4 w-4 text-brand" />
          </div>
        </div>
      )}

      {/* Rotas — logo após a seção que aparece depois de consultar o Riot ID
          (Tier acima). Rótulo/sentido mudam com boostMode do próprio Clash. */}
      {riotVerified && riotAutoFilled && clashTier && detectedTierRanks && (
        <LaneSelectField
          lanes={customerLanes}
          onChange={setCustomerLanes}
          boostMode={boostMode}
        />
      )}
    </div>
  )
}
