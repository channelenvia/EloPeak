import { useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { FormField } from '@/components/ui/FormField'
import { RankLockGrid, WinCountButtons, PdlFieldRow, ErrorAlert } from '@/components/ui'
import { cn, RANK_TIER_ORDER } from '@/lib/utils'
import { isMasterPlusCurrentTier, isDuoBlockedAtTier } from '@/lib/boostDomain'
import { Info, Check } from 'lucide-react'
import { RiotIdField } from './RiotIdField'
import { useRiotLookup } from './useRiotLookup'
import { DeclaredRankNotice, ManualRankOfferCard } from './ManualRankOfferCard'
import { useBuilderPricing } from './useBuilderPricing'
import { CoachPackagePicker } from './CoachPackagePicker'
import { ClashConfigPicker } from './ClashConfigPicker'
import { LaneSelectField } from '@/components/order/LaneSelectField'

// ── Main component ────────────────────────────────────────────────────────────

export function StepConfigure() {
  const {
    serviceType, currentRank, targetRank, queueType, boostMode,
    winsPurchased,
    isMd5, md5MatchesRemaining,
    currentLp, avgLpGain,
    currentPdl, avgPdlGain,
    riotId, riotAutoFilled, riotVerified, riotLookupLoading, stepAttempted, rankDeclared,
    customerLanes, setCustomerLanes,
    setCurrentRank, setTargetRank, setQueueType, setBoostMode,
    setWinsPurchased,
    setCurrentLp, setAvgLpGain,
    setCurrentPdl, setAvgPdlGain,
    setRiotId,
  } = useOrderBuilderStore()

  const currentIsMasterPlus = currentRank ? isMasterPlusCurrentTier(currentRank.tier) : false
  // Duo bloqueado a partir de Master pra Vitórias (mesma regra de rank ATUAL
  // do Elo Boost abaixo), só na fila Solo/Duo -- MD5 nunca bloqueia por
  // rank, e a Flex nunca bloqueia por elo.
  const currentTierBlocksDuo = currentRank && queueType === 'solo_duo' ? currentIsMasterPlus : false
  const winsMd5DuoBlocked = !isMd5 && currentTierBlocksDuo
  // Elo Boost Duo só na fila Solo/Duo: bloqueado se o rank ATUAL já é
  // Master+ (não sobra subida abaixo de Master pra fazer em duo) ou se o
  // rank ALVO é Grão-Mestre/Challenger (exige jogar DENTRO do Master+, trecho
  // que a Riot restringe a solo) -- alvo Master em si é permitido (a subida
  // toda até lá acontece abaixo de Master). Na Flex, Duo é aceito em
  // qualquer alvo (a Riot não restringe duo por elo lá; master_plus_pricing
  // tem preço próprio pra essa combinação).
  const eloDuoBlockedByCurrent = currentIsMasterPlus && queueType !== 'flex'
  const eloDuoBlockedByTarget = targetRank && queueType !== 'flex'
    ? isDuoBlockedAtTier(targetRank.tier)
    : false
  const eloDuoBlocked = eloDuoBlockedByCurrent || eloDuoBlockedByTarget
  const {
    riotLookupMessage, riotLookupError, md5Message, unrankedOffer, manualRankOffer,
    resetLookupMessages, lookupRiotRank, lookupForWinBoost, migrateToMd5, declareRankManually,
  } = useRiotLookup()

  // Grão-Mestre só tem um destino válido (Challenger) — a interface pode
  // preenchê-lo automaticamente, mas o backend valida a combinação de novo.
  useEffect(() => {
    if (currentRank?.tier === 'grandmaster' && targetRank?.tier !== 'challenger') {
      setTargetRank({ tier: 'challenger', division: null })
    }
  }, [currentRank, targetRank, setTargetRank])

  const { masterPlusPriceRow, loadingMasterPlusPrice, leagueCutoffs } = useBuilderPricing()

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Configurar Pedido</h2>
      <p className="text-sm text-ink-secondary mb-6">Defina seus ranks e preferências.</p>

      <div className="space-y-6">
        {/* Modalidade (Solo/Duo Boost) — escolha livre do cliente, mesmo
            padrão visual do seletor de Tipo de Fila logo abaixo. Fica antes
            de tudo porque não depende do Riot ID. Duo não existe a partir de
            Grão-Mestre (Master ainda aceita), mas isso só se sabe depois de
            verificar o elo — o próprio store (setCurrentRank/setBoostMode)
            já força 'solo' e recusa 'duo' nesse caso, então o botão só
            some/trava quando descobrimos. */}
        {serviceType === 'elo_boost' && (
          <FormField label="Modalidade">
            <div className="grid sm:grid-cols-2 gap-3" role="group" aria-label="Modalidade">
              <button
                type="button"
                aria-pressed={boostMode === 'solo'}
                onClick={() => setBoostMode('solo')}
                className={cn(
                  'relative text-left p-4 rounded-2xl border-2 transition-all duration-150',
                  boostMode === 'solo'
                    ? 'border-brand bg-brand/10 shadow-brand'
                    : 'border-border-subtle bg-bg-surface hover:border-brand/40 hover:bg-bg-raised',
                )}
              >
                <p className={cn('text-sm font-bold', boostMode === 'solo' ? 'text-brand' : 'text-ink')}>Solo Boost</p>
                <p className="text-xs text-ink-secondary mt-1 leading-relaxed">O booster joga direto na sua conta.</p>
                {boostMode === 'solo' && <Check className="absolute top-3 right-3 h-4 w-4 text-brand" />}
              </button>
              <button
                type="button"
                aria-pressed={boostMode === 'duo'}
                onClick={() => setBoostMode('duo')}
                disabled={eloDuoBlocked}
                className={cn(
                  'relative text-left p-4 rounded-2xl border-2 transition-all duration-150',
                  boostMode === 'duo'
                    ? 'border-brand bg-brand/10 shadow-brand'
                    : 'border-border-subtle bg-bg-surface hover:border-brand/40 hover:bg-bg-raised',
                  eloDuoBlocked && 'opacity-50 cursor-not-allowed hover:border-border-subtle hover:bg-bg-surface',
                )}
              >
                <p className={cn('text-sm font-bold', boostMode === 'duo' ? 'text-brand' : 'text-ink')}>Duo Boost</p>
                <p className="text-xs text-ink-secondary mt-1 leading-relaxed">
                  {eloDuoBlockedByCurrent
                    ? 'Indisponível a partir de Mestre — Duo Boost é só até Diamante.'
                    : eloDuoBlockedByTarget
                      ? 'Indisponível para rank alvo Mestre+ — Duo Boost é só até Diamante.'
                      : 'Você joga junto com o booster na duo queue.'}
                </p>
                {boostMode === 'duo' && <Check className="absolute top-3 right-3 h-4 w-4 text-brand" />}
              </button>
            </div>
          </FormField>
        )}

        {/* Vitórias ou MD5 — NUNCA é escolha livre, o próprio Riot ID abaixo
            decide: conta sem rank nesta fila vira MD5 automaticamente, conta
            já rankeada trava em Vitórias (anti-fraude, o backend rejeita MD5
            de conta que já saiu do posicionamento de qualquer jeito). Não
            tem mais uma linha própria anunciando "Vitórias"/"MD5" aqui --
            fica implícito nos rótulos "Solo Vitórias"/"Solo MD5"/"Duo
            Vitórias"/"Duo MD5" da Modalidade logo abaixo, sem repetir a
            mesma informação duas vezes. A explicação genérica de "como
            funciona a detecção" também saiu daqui, virou um item na
            descrição do card de WinBoost no step 1 (StepService.tsx). */}

        {/* Solo/Duo Vitórias — vale tanto pra Vitórias quanto MD5 (mesma
            escolha, mesmo padrão visual do Modalidade do Elo Boost acima).
            Duo indisponível a partir de Master, igual Elo Boost -- exceto
            MD5, que nunca bloqueia Duo por rank (winsMd5DuoBlocked já
            considera isMd5). */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && (
          <FormField label="Modalidade">
            <div className="grid sm:grid-cols-2 gap-3" role="group" aria-label="Modalidade">
              <button
                type="button"
                aria-pressed={boostMode === 'solo'}
                onClick={() => setBoostMode('solo')}
                className={cn(
                  'relative text-left p-4 rounded-2xl border-2 transition-all duration-150',
                  boostMode === 'solo'
                    ? 'border-brand bg-brand/10 shadow-brand'
                    : 'border-border-subtle bg-bg-surface hover:border-brand/40 hover:bg-bg-raised',
                )}
              >
                <p className={cn('text-sm font-bold', boostMode === 'solo' ? 'text-brand' : 'text-ink')}>{isMd5 ? 'Solo MD5' : 'Solo Vitórias'}</p>
                <p className="text-xs text-ink-secondary mt-1 leading-relaxed">O booster joga direto na sua conta.</p>
                {boostMode === 'solo' && <Check className="absolute top-3 right-3 h-4 w-4 text-brand" />}
              </button>
              <button
                type="button"
                aria-pressed={boostMode === 'duo'}
                onClick={() => setBoostMode('duo')}
                disabled={winsMd5DuoBlocked}
                className={cn(
                  'relative text-left p-4 rounded-2xl border-2 transition-all duration-150',
                  boostMode === 'duo'
                    ? 'border-brand bg-brand/10 shadow-brand'
                    : 'border-border-subtle bg-bg-surface hover:border-brand/40 hover:bg-bg-raised',
                  winsMd5DuoBlocked && 'opacity-50 cursor-not-allowed hover:border-border-subtle hover:bg-bg-surface',
                )}
              >
                <p className={cn('text-sm font-bold', boostMode === 'duo' ? 'text-brand' : 'text-ink')}>{isMd5 ? 'Duo MD5' : 'Duo Vitórias'}</p>
                <p className="text-xs text-ink-secondary mt-1 leading-relaxed">
                  {winsMd5DuoBlocked ? 'Indisponível a partir de Master.' : 'Você joga junto com o booster na duo queue.'}
                </p>
                {boostMode === 'duo' && <Check className="absolute top-3 right-3 h-4 w-4 text-brand" />}
              </button>
            </div>
          </FormField>
        )}

        {/* Riot ID com largura máxima na linha -- o tipo de fila (que
            precisa estar definido antes da busca, pois decide qual fila a
            Riot consulta) fica embutido no fim do próprio campo em vez de
            num FormField à esquerda. */}
        {serviceType === 'elo_boost' && (
          <RiotIdField
            queueType={queueType}
            onQueueTypeChange={setQueueType}
            riotId={riotId}
            onRiotIdChange={value => {
              setRiotId(value)
              resetLookupMessages()
            }}
            onVerify={() => void lookupRiotRank()}
            loading={riotLookupLoading}
            verified={riotVerified}
            error={stepAttempted && !riotId.trim() ? 'Campo obrigatório' : undefined}
          >
            {riotLookupMessage && (
              <p className="mt-2 text-xs text-success">{riotLookupMessage}</p>
            )}
            {riotLookupError && <ErrorAlert message={riotLookupError} className="mt-2" />}
          </RiotIdField>
        )}

        {/* Eloboost sem rank na fila — oferta de migrar o pedido pra MD5 na
            mesma fila, já configurando tudo. O form segue travado até aqui. */}
        {serviceType === 'elo_boost' && !riotVerified && unrankedOffer && (
          <div className="rounded-2xl border-2 border-warning/30 bg-warning/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-ink">Conta sem rank nesta fila</p>
                <p className="text-xs text-ink-secondary mt-0.5">
                  Sua conta ainda está no posicionamento nesta fila, então não dá pra fazer um Elo Boost.
                  Você pode migrar este pedido para uma <span className="font-semibold">MD5</span> na mesma
                  fila — garantimos 80%+ de win rate nas {unrankedOffer.matchesRemaining} partida(s) restantes
                  (você ajusta o número depois).
                </p>
              </div>
            </div>
            <Button
              type="button"
              onClick={migrateToMd5}
              variant="primary" size="md" className="w-full"
            >
              Migrar para MD5
            </Button>
          </div>
        )}

        {(serviceType === 'elo_boost' || serviceType === 'win_boost') && !riotVerified && manualRankOffer && (
          <ManualRankOfferCard onDeclare={declareRankManually} />
        )}

        {/* Riot ID com largura máxima na linha, igual ao fluxo de Elo Boost
            acima -- a consulta usa a fila marcada no seletor embutido no
            campo, e a checagem de elegibilidade MD5 precisa acontecer antes
            de qualquer outro campo. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && (
          <RiotIdField
            queueType={queueType}
            onQueueTypeChange={setQueueType}
            riotId={riotId}
            onRiotIdChange={value => {
              setRiotId(value)
              resetLookupMessages()
            }}
            onVerify={() => void lookupForWinBoost()}
            loading={riotLookupLoading}
            verified={riotVerified}
            error={stepAttempted && !riotId.trim() ? 'Campo obrigatório' : undefined}
          >
            {md5Message && <p className="mt-2 text-xs text-success">{md5Message}</p>}
            {riotLookupMessage && !md5Message && <p className="mt-2 text-xs text-success">{riotLookupMessage}</p>}
            {riotLookupError && <ErrorAlert message={riotLookupError} className="mt-2" />}
          </RiotIdField>
        )}

        {/* Rank + Vitórias/Partidas — win boost / MD5, seção única dividida ao
            meio (mesmo padrão visual do split Rank Atual/Rank Alvo do elo
            boost logo abaixo): rank da última temporada à esquerda, número
            de vitórias/partidas à direita, como se fosse o "alvo" de um
            configurador de elo boost. Só após verificar o elo. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && riotVerified && (
          <div className="rounded-2xl border border-border-subtle overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* ── Rank column ── */}
              <div className="p-4 space-y-4 border-b border-border-subtle md:border-b-0 md:border-r">
                <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">
                  {isMd5 ? 'Rank Anterior' : 'Rank Atual'}
                </p>
                <RankLockGrid
                  tiers={RANK_TIER_ORDER}
                  current={null}
                  selectedTier={currentRank?.tier ?? null}
                  selectedDivision={currentRank?.division ?? null}
                  onChange={(tier, division) => setCurrentRank({ tier, division })}
                  disabled={(serviceType === 'win_boost' && !rankDeclared) || riotAutoFilled}
                />
                {stepAttempted && !currentRank ? (
                  <p className="text-xs text-danger">Selecione um rank</p>
                ) : isMd5 ? (
                  <p className="text-xs text-ink-muted">Sem LP — apenas o rank da temporada anterior.</p>
                ) : null}
                {rankDeclared && <DeclaredRankNotice pastSeason={isMd5} />}
              </div>

              {/* ── Vitórias/Partidas column ── */}
              <div className="p-4 space-y-4">
                <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">
                  {isMd5 ? 'Partidas' : 'Vitórias'}
                </p>
                <WinCountButtons
                  value={winsPurchased}
                  max={isMd5 ? Math.max(1, md5MatchesRemaining ?? 5) : 5}
                  onChange={setWinsPurchased}
                />
                <p className="text-xs text-ink-muted">
                  {isMd5
                    ? `Máximo ${Math.max(1, md5MatchesRemaining ?? 5)} (restantes detectadas pela Riot)`
                    : 'Máximo 5'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Rotas — logo após a seção que aparece depois de consultar o Riot
            ID (rank + vitórias acima). Rótulo/sentido mudam com boostMode
            dentro do próprio LaneSelectField. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && riotVerified && (
          <LaneSelectField
            lanes={customerLanes}
            onChange={setCustomerLanes}
            boostMode={boostMode}
          />
        )}

        {/* Rank selection — elo boost (split two-column layout). Só após
            verificar o elo (o rank atual vem preenchido da Riot). */}
        {serviceType === 'elo_boost' && riotVerified && (
          <div className="rounded-2xl border border-border-subtle overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* ── Current rank column ── */}
              <div className="p-4 space-y-4 border-b border-border-subtle md:border-b-0 md:border-r">
                <div className="flex items-center justify-between">
                  <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Rank Atual</p>
                </div>

                <RankLockGrid
                  tiers={RANK_TIER_ORDER.filter(t => t !== 'challenger')}
                  current={null}
                  selectedTier={currentRank?.tier ?? null}
                  selectedDivision={currentRank?.division ?? null}
                  onChange={(tier, division) => setCurrentRank({ tier, division })}
                  disabled={!rankDeclared}
                />
                {stepAttempted && !currentRank && (
                  <p className="text-xs text-danger">Selecione um rank</p>
                )}
                {rankDeclared && <DeclaredRankNotice />}

                {/* PDL Atual — mesmo cartão para os dois fluxos, só trocando
                    quais campos do estado ficam ligados a cada input. Master+
                    não tem PDL alvo — o preço depende da faixa do PDL atual,
                    não de um alvo informado pelo cliente. */}
                {currentRank && (
                  <Card variant="inset" padding="xs" className="space-y-3">
                    {currentIsMasterPlus ? (
                      <PdlFieldRow fields={[
                        { label: 'PDL Atual', value: currentPdl, min: 0, max: 9999, onChange: setCurrentPdl, disabled: !rankDeclared },
                        { label: 'Média PDL', value: avgPdlGain, min: 1, max: 99, onChange: setAvgPdlGain, disabled: true },
                      ]} />
                    ) : (
                      <PdlFieldRow fields={[
                        { label: 'PDL Atual', value: currentLp, min: 0, max: 99, onChange: setCurrentLp, disabled: !rankDeclared },
                        { label: 'Média PDL', value: avgLpGain, min: 1, max: 50, onChange: setAvgLpGain, disabled: true },
                      ]} />
                    )}
                  </Card>
                )}
              </div>

              {/* ── Target rank column ── */}
              <div className="p-4 space-y-4">
                <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Rank Alvo</p>

                {!currentRank ? (
                  <p className="text-xs text-ink-muted pt-2">Selecione o rank atual primeiro.</p>
                ) : (
                  // A grade sempre mostra os 10 tiers, travando só os que estão
                  // no mesmo degrau ou abaixo do rank atual (RankLockGrid usa
                  // rankStep — Master/Grão-Mestre/Challenger entram na mesma
                  // regra, sem lista de progressões separada). Vale tanto para
                  // o fluxo padrão mirando Master+ (Diamond → Master, por
                  // exemplo) quanto para quem já está em Master+. Challenger
                  // fica travado à parte (additionalLockedTiers) quando a
                  // modalidade é Duo na fila Solo/Duo -- nessa fila Duo nunca
                  // chega lá, então nem deixa escolher em vez de só avisar
                  // depois. Na Flex, Duo chega em Master+ normalmente (preço
                  // próprio em master_plus_pricing), então a grade não trava.
                  <RankLockGrid
                    tiers={RANK_TIER_ORDER}
                    current={currentRank}
                    selectedTier={targetRank?.tier ?? null}
                    selectedDivision={targetRank?.division ?? null}
                    onChange={(tier, division) => setTargetRank({ tier, division })}
                    additionalLockedTiers={boostMode === 'duo' && queueType !== 'flex' ? ['master', 'grandmaster', 'challenger'] : []}
                    additionalLockedTitle="Duo Boost não é aceito para Challenger como rank alvo na fila Solo/Duo"
                  />
                )}
                {/* Corte ao vivo de GM/Challenger vem logo após o rank alvo
                    ser GM/Challenger, antes de qualquer outro aviso -- vale
                    pro fluxo Master+ (rank atual já é Master/GM) E pro fluxo
                    padrão mirando GM/Challenger direto de Diamond ou abaixo
                    (progressão por degrau, mesma RankLockGrid acima). Não
                    depende de currentIsMasterPlus, só do rank alvo escolhido. */}
                {targetRank?.tier === 'grandmaster' && leagueCutoffs?.grandmaster_cutoff != null && (
                  <p className="text-xs text-ink-muted">Corte atual do Grão-Mestre: {leagueCutoffs.grandmaster_cutoff} PDL (atualizado automaticamente)</p>
                )}
                {targetRank?.tier === 'challenger' && leagueCutoffs?.challenger_cutoff != null && (
                  <p className="text-xs text-ink-muted">Corte atual do Challenger: {leagueCutoffs.challenger_cutoff} PDL (atualizado automaticamente)</p>
                )}
                {currentIsMasterPlus && (
                  <>
                    {loadingMasterPlusPrice && <p className="text-xs text-ink-muted">Calculando preço…</p>}
                    {!loadingMasterPlusPrice && targetRank && masterPlusPriceRow?.price == null && (
                      <p className="text-xs text-warning">Preço ainda não configurado para esse tier. Fale com o suporte.</p>
                    )}
                  </>
                )}
                {/* Duo Boost nunca chega em Challenger na fila Solo/Duo --
                    o tile já vem travado na grade acima (additionalLockedTiers),
                    esta mensagem só cobre o caso de o alvo já estar em
                    Challenger (escolhido em Solo) quando o cliente troca a
                    modalidade pra Duo -- ver o bloqueio do próprio botão Duo
                    Boost em "Modalidade" (eloDuoBlockedByTarget) mais acima. */}
                {queueType === 'solo_duo' && boostMode === 'duo' && targetRank?.tier === 'challenger' && (
                  <p className="text-xs text-warning">Duo Boost não é aceito para Challenger como rank alvo na fila Solo/Duo — escolha Solo, mire até Master, ou troque para a fila Flex.</p>
                )}
                {stepAttempted && currentRank && !targetRank && (
                  <p className="text-xs text-danger">Selecione o rank alvo</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Rotas — logo após a seção de ranks acima (mesma regra do
            win_boost/md5: rótulo/sentido mudam com boostMode). */}
        {serviceType === 'elo_boost' && riotVerified && (
          <LaneSelectField
            lanes={customerLanes}
            onChange={setCustomerLanes}
            boostMode={boostMode}
          />
        )}

        {/* Coaching — escolhe um pacote real de um booster; preço vem do
            pacote, nunca é combinado depois. */}
        {serviceType === 'coaching' && <CoachPackagePicker />}

        {/* Clash — modalidade, tier fixo e dia; preço vem da tabela fixa
            (mode × tier), setado dentro do próprio picker. */}
        {serviceType === 'clash' && <ClashConfigPicker />}
      </div>
    </div>
  )
}
