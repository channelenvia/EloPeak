import { useQuery } from '@tanstack/react-query'
import { Trophy, XCircle, Clock, RefreshCw, Crown, Gamepad2, History } from 'lucide-react'
import { Card, Skeleton, ErrorAlert } from '@/components/ui'
import { cn, timeAgo } from '@/lib/utils'
import { getQueueLabel } from '@/lib/riotQueues'
import { useOrderMatches } from '@/api/orders'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

// Versão mais recente do Data Dragon (CDN pública de assets do LoL) -- usada
// só pra montar a URL do ícone do campeão. Cacheada 24h (o patch não muda
// no meio do dia) e pega o item [0] do array, que a própria Riot documenta
// como o mais recente primeiro. Sem chave de API, sem custo.
function useDdragonVersion() {
  const { data } = useQuery({
    queryKey: ['ddragon-version'],
    queryFn: async () => {
      const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      if (!res.ok) throw new Error('ddragon versions fetch failed')
      const versions = await res.json() as string[]
      return versions[0] ?? null
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  })
  return data ?? null
}

// O campo `champion` já vem do match-v5 no formato "id" do Data Dragon (ex.:
// "MonkeyKing" pro Wukong, sem espaço/acento) -- mesma string, sem
// transformação nenhuma.
function championIconUrl(champion: string | null, version: string | null): string | null {
  if (!champion || !version) return null
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion}.png`
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

// A janela de partidas contadas é definida pelo backend (order_matches +
// match_sync_started_at, ver migration 052) -- desde que o booster clicou em
// "Iniciar pedido" até a conclusão, nunca antes disso. Esta tela só exibe o
// que já foi sincronizado, nunca recalcula a janela no front.
// `locked` cobre o intervalo entre o pedido existir e o booster de fato
// iniciá-lo -- sem partida nenhuma pra sincronizar ainda. Card continua
// aparecendo (com título e o botão de sincronizar, só travado) em vez de
// sumir e reaparecer depois, pro layout não pular de posição.
export function OrderMatchHistory({ orderId, sync, pdlEstimate, locked }: { orderId: string; sync?: SyncControls; pdlEstimate?: PdlEstimate | null; locked?: string }) {
  const { data: matches, isLoading } = useOrderMatches(locked ? undefined : orderId)
  const ddragonVersion = useDdragonVersion()

  const wins = matches?.filter((m) => m.result === 'win').length ?? 0
  const losses = (matches?.length ?? 0) - wins
  const winRate = matches?.length ? Math.round((wins / matches.length) * 100) : null
  const avgKda = matches?.length
    ? matches.reduce((sum, m) => sum + (m.deaths > 0 ? (m.kills + m.assists) / m.deaths : m.kills + m.assists), 0) / matches.length
    : null

  return (
    <Card padding="md" className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-semibold text-ink">Histórico de partidas</h3>
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
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-bg-elevated p-3 text-center" data-tabular>
            <div>
              <p className="text-sm font-bold text-ink">{wins}V / {losses}D</p>
              <p className="text-[10px] text-ink-muted mt-0.5">Resultado</p>
            </div>
            <div>
              <p className="text-sm font-bold text-ink">{winRate != null ? `${winRate}%` : '—'}</p>
              <p className="text-[10px] text-ink-muted mt-0.5">Win rate</p>
            </div>
            <div>
              <p className="text-sm font-bold text-ink">{avgKda != null ? avgKda.toFixed(2) : '—'}</p>
              <p className="text-[10px] text-ink-muted mt-0.5">KDA médio</p>
            </div>
          </div>

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
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold text-ink truncate">
                        {match.champion ?? 'Campeão desconhecido'}
                      </p>
                      <span className="shrink-0 text-[9px] font-semibold text-ink-muted bg-bg-elevated px-1.5 py-0.5 rounded">
                        {getQueueLabel(match.queue_id)}
                      </span>
                    </div>
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
      </>
      )}
    </Card>
  )
}
