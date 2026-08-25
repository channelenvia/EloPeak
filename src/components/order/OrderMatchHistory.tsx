import type { LucideIcon } from 'lucide-react'
import { Trophy, XCircle, Clock, RefreshCw, Crown, Gamepad2, History, Swords, TrendingUp } from 'lucide-react'
import { Card, Skeleton, ErrorAlert } from '@/components/ui'
import { cn, timeAgo } from '@/lib/utils'
import { useDdragonVersion, championIconUrl } from '@/lib/ddragon'
import { useOrderMatches, useOrderBoosterDuoMatches } from '@/api/orders'
import type { OrderMatch } from '@/types'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

interface SyncControls {
  onSync: () => void
  syncing: boolean
  cooldownSeconds?: number
  error?: string | null
  resultMessage?: string | null
}

// Riot não expõe PDL/LP ganho POR PARTIDA em nenhum endpoint (match-v5 não
// tem esse dado; league-v4 só dá o total atual, não o histórico) -- por
// isso é sempre uma ESTIMATIVA (média informada pelo cliente no
// configurador, order.avg_pdl_gain/avg_pdl_loss), nunca um valor exato
// puxado da partida. `label` já vem pronto do chamador (PDL pra Master+,
// LP pro fluxo padrão -- mesma regra de OrderRankSummary).
export interface PdlEstimate {
  gain: number | null
  loss: number | null
  label: string
}

function SummaryStat({ icon: Icon, label, value, valueClassName }: { icon: LucideIcon; label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="flex items-center justify-center gap-1 text-xs text-ink-muted">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p className={cn('mt-0.5 text-sm font-semibold text-ink', valueClassName)} data-tabular>{value}</p>
    </div>
  )
}

// Resultado/winrate vêm da MESMA partida pros dois lados de um duo (cliente
// e booster jogaram juntos) -- só o KDA é de fato individual (kills/deaths/
// assists são por jogador, não por time). Extraído pra computar isso uma vez
// só no cabeçalho compartilhado (ver OrderMatchHistory) em vez de duplicar
// V/D e winrate nos dois painéis lado a lado.
function computeMatchSummary(matches: OrderMatch[] | undefined) {
  const wins = matches?.filter((m) => m.result === 'win').length ?? 0
  const losses = (matches?.length ?? 0) - wins
  const winRate = matches?.length ? Math.round((wins / matches.length) * 100) : null
  const avgKda = matches?.length
    ? matches.reduce((sum, m) => sum + (m.deaths > 0 ? (m.kills + m.assists) / m.deaths : m.kills + m.assists), 0) / matches.length
    : null
  return { wins, losses, winRate, avgKda }
}

// Lista de partidas -- extraído porque pedidos duo agora mostram isso 2x
// lado a lado (conta do cliente + conta duo do booster), não mais só 1x.
// showSummary=false omite o bloco de estatísticas (já mostrado 1x só no
// cabeçalho de OrderMatchHistory pra duo, pra não duplicar em cada painel).
function MatchListPanel({
  label, matches, isLoading, ddragonVersion, pdlEstimate, showSummary = true,
}: {
  label?: string
  matches: OrderMatch[] | undefined
  isLoading: boolean
  ddragonVersion: string | null
  pdlEstimate?: PdlEstimate | null
  showSummary?: boolean
}) {
  const { wins, losses, winRate, avgKda } = computeMatchSummary(matches)

  return (
    <div>
      {label && <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-2">{label}</p>}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !matches?.length ? (
        <p className="text-xs text-ink-muted py-4 text-center">
          Nenhuma partida sincronizada ainda.
        </p>
      ) : (
        <>
          {showSummary && (
            <div className="mb-4 grid grid-cols-3 gap-2 border-b border-border-subtle pb-4">
              <SummaryStat icon={Trophy} label="Resultado" value={`${wins}V / ${losses}D`} />
              <SummaryStat
                icon={TrendingUp}
                label="Winrate médio"
                value={winRate != null ? `${winRate}%` : '—'}
                valueClassName={winRate == null ? undefined : winRate >= 55 ? 'text-success' : winRate >= 45 ? 'text-warning' : 'text-danger'}
              />
              <SummaryStat
                icon={Swords}
                label="KDA médio"
                value={avgKda != null ? avgKda.toFixed(1) : '—'}
                valueClassName={avgKda == null ? undefined : avgKda >= 4 ? 'text-success' : avgKda >= 2.5 ? 'text-warning' : 'text-danger'}
              />
            </div>
          )}

          <div className="space-y-2">
            {matches.map((match) => {
              const iconUrl = championIconUrl(match.champion, ddragonVersion)
              const cs = match.minions_killed != null || match.neutral_minions_killed != null
                ? (match.minions_killed ?? 0) + (match.neutral_minions_killed ?? 0)
                : null
              const csPerMin = cs != null && match.duration_seconds ? cs / (match.duration_seconds / 60) : null
              const pdlValue = pdlEstimate
                ? match.result === 'win' ? pdlEstimate.gain : pdlEstimate.loss
                : null
              return (
                <div
                  key={match.id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 border',
                    match.result === 'win'
                      ? 'bg-success/5 border-success/15'
                      : 'bg-danger/5 border-danger/15',
                  )}
                >
                  <div className="relative shrink-0">
                    {iconUrl ? (
                      <img
                        src={iconUrl}
                        alt={match.champion ?? 'Campeão'}
                        className="h-9 w-9 rounded-lg object-cover"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-elevated">
                        <Gamepad2 className="h-4 w-4 text-ink-muted" />
                      </div>
                    )}
                    {match.result === 'win' ? (
                      <Trophy className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-bg-surface p-0.5 text-success shadow" />
                    ) : (
                      <XCircle className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-bg-surface p-0.5 text-danger shadow" />
                    )}
                    {match.is_mvp && (
                      <Crown className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-accent" aria-label="MVP" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink truncate">
                      {match.champion ?? 'Campeão desconhecido'}
                    </p>
                    <p className="text-[10px] text-ink-muted" data-tabular>
                      {match.kills}/{match.deaths}/{match.assists} KDA
                      {cs != null && ` · ${cs} CS${csPerMin != null ? ` (${csPerMin.toFixed(1)}/min)` : ''}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {pdlValue != null && (
                      <p className={cn('text-xs font-bold', match.result === 'win' ? 'text-success' : 'text-danger')} data-tabular>
                        {match.result === 'win' ? '+' : '−'}{pdlValue} {pdlEstimate!.label}
                      </p>
                    )}
                    <p className="flex items-center gap-1 text-[10px] text-ink-muted justify-end" data-tabular>
                      <Clock className="h-3 w-3" /> {formatDuration(match.duration_seconds)}
                    </p>
                    <p className="text-[10px] text-ink-muted mt-0.5">{timeAgo(match.played_at)}</p>
                  </div>
                </div>
              )
            })}
          </div>
          {pdlEstimate && (
            <p className="mt-3 text-[10px] text-ink-muted text-center">
              {pdlEstimate.label} por partida é uma estimativa (média informada no pedido) — a Riot não expõe esse valor por partida.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// A janela de partidas contadas é definida pelo backend (order_matches +
// match_sync_started_at, ver migration 052) -- desde que o booster clicou em
// "Iniciar pedido" até a conclusão, nunca antes disso. Esta tela só exibe o
// que já foi sincronizado, nunca recalcula a janela no front.
// `locked` cobre o intervalo entre o pedido existir e o booster de fato
// iniciá-lo -- sem partida nenhuma pra sincronizar ainda. Card continua
// aparecendo (com título e o botão de sincronizar, só travado) em vez de
// sumir e reaparecer depois, pro layout não pular de posição.
// `boostMode === 'duo'` divide o conteúdo em 2 colunas (cliente + booster) --
// order_matches é sempre a conta do CLIENTE (mesmo em duo, é a conta sendo
// entregue, ver sync-order-matches); booster_duo_matches é sempre a conta
// duo do booster (própria ou do pool). Pedido solo continua com 1 lista só,
// já que não existe uma segunda conta separada nesse modo.
export function OrderMatchHistory({ orderId, sync, pdlEstimate, locked, boostMode }: { orderId: string; sync?: SyncControls; pdlEstimate?: PdlEstimate | null; locked?: string; boostMode?: string }) {
  const isDuo = boostMode === 'duo'
  const { data: matches, isLoading } = useOrderMatches(locked ? undefined : orderId)
  const { data: duoMatches, isLoading: duoLoading } = useOrderBoosterDuoMatches(locked ? undefined : orderId, isDuo)
  const ddragonVersion = useDdragonVersion()
  const matchSummary = computeMatchSummary(matches)

  return (
    <Card padding="md" className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-brand" />
          <h3 className="text-base font-semibold text-ink">Histórico de partidas</h3>
        </div>
        {sync && (
          <button
            type="button"
            onClick={sync.onSync}
            disabled={!!locked || sync.syncing || (sync.cooldownSeconds ?? 0) > 0}
            className="inline-flex items-center gap-1.5 text-sm font-semibold shrink-0 text-ink-secondary hover:text-ink transition-colors disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.syncing && 'animate-spin')} />
            {sync.cooldownSeconds ? `Aguarde ${sync.cooldownSeconds}s` : 'Sincronizar'}
          </button>
        )}
      </div>

      {locked ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <p className="text-xs text-ink-muted max-w-xs">{locked}</p>
        </div>
      ) : (
      <>
      {sync?.error && <ErrorAlert className="mb-3" message={sync.error} />}
      {sync?.resultMessage && <p className="text-xs text-ink-muted mb-3">{sync.resultMessage}</p>}

      {isDuo ? (
        <div>
          {/* Uma seção geral só (Resultado, Winrate, KDA médio) -- cliente e
              booster jogaram as mesmas partidas juntos, então repetir tudo
              nos 2 painéis abaixo seria redundante. Os painéis ficam só com
              a lista de partidas de cada conta. */}
          {isLoading ? (
            <div className="mb-4 grid grid-cols-3 gap-2 border-b border-border-subtle pb-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : matches?.length ? (
            <div className="mb-4 grid grid-cols-3 gap-2 border-b border-border-subtle pb-4">
              <SummaryStat icon={Trophy} label="Resultado" value={`${matchSummary.wins}V / ${matchSummary.losses}D`} />
              <SummaryStat
                icon={TrendingUp}
                label="Winrate médio"
                value={matchSummary.winRate != null ? `${matchSummary.winRate}%` : '—'}
                valueClassName={matchSummary.winRate == null ? undefined : matchSummary.winRate >= 55 ? 'text-success' : matchSummary.winRate >= 45 ? 'text-warning' : 'text-danger'}
              />
              <SummaryStat
                icon={Swords}
                label="KDA médio"
                value={matchSummary.avgKda != null ? matchSummary.avgKda.toFixed(1) : '—'}
                valueClassName={matchSummary.avgKda == null ? undefined : matchSummary.avgKda >= 4 ? 'text-success' : matchSummary.avgKda >= 2.5 ? 'text-warning' : 'text-danger'}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <MatchListPanel label="Cliente" matches={matches} isLoading={isLoading} ddragonVersion={ddragonVersion} pdlEstimate={pdlEstimate} showSummary={false} />
            <div className="border-l border-border-subtle pl-4">
              <MatchListPanel label="Booster" matches={duoMatches} isLoading={duoLoading} ddragonVersion={ddragonVersion} pdlEstimate={pdlEstimate} showSummary={false} />
            </div>
          </div>
        </div>
      ) : (
        <MatchListPanel matches={matches} isLoading={isLoading} ddragonVersion={ddragonVersion} pdlEstimate={pdlEstimate} />
      )}
      </>
      )}
    </Card>
  )
}
