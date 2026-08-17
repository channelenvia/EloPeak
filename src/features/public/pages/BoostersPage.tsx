import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Zap, Star, Trophy, Swords, Sparkles } from 'lucide-react'
import { Avatar, Skeleton, RankBadge } from '@/components/ui'
import { SEOHead } from '@/components/SEOHead'
import { cn, formatRank, formatLastSeen, isBoosterOnline } from '@/lib/utils'
import type { BoosterProfile, RankTier } from '@/types'
import { usePublicBoosters, useTopBoosters, useBoostersPerformance } from '@/api/boosters'
import type { TopBoosterEntry } from '@/api/boosters'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MEDAL: Record<number, { border: string; badge: string; text: string }> = {
  1: { border: 'border-yellow-400/60', badge: 'bg-yellow-400 text-bg-base', text: 'text-yellow-400' },
  2: { border: 'border-slate-300/50',  badge: 'bg-slate-300 text-bg-base',  text: 'text-slate-300'  },
  3: { border: 'border-amber-500/50',  badge: 'bg-amber-500 text-white',     text: 'text-amber-500'  },
}

// ── TopBoosterCard ───────────────────────────────────────────────────────────
// Seleção sistemática (get_top_boosters) — nunca uma lista fixa/manual.
// Ver supabase/migrations_archive/054_booster_performance_segments.sql e
// 055_top_boosters_selection.sql para a fórmula, o fallback e o desempate.

function TopBoosterCard({ entry, position }: { entry: TopBoosterEntry; position: number }) {
  const medal = MEDAL[position]

  return (
    <Link
      to={`/boosters/${encodeURIComponent(entry.display_name)}`}
      className={cn(
        'card flex flex-col gap-3 p-5 border-2 transition-all hover:-translate-y-1 hover:shadow-card-hover',
        medal.border,
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn('h-7 w-7 rounded-full flex items-center justify-center text-xs font-black shrink-0', medal.badge)}>
          {position}
        </span>
        <Avatar src={entry.avatar_url} name={entry.display_name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink truncate">{entry.display_name}</p>
          {entry.current_rank && (
            <p className="text-[11px] text-ink-secondary">{formatRank(entry.current_rank.tier, entry.current_rank.division)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center bg-bg-elevated rounded-xl py-2.5">
        <div>
          <p className={cn('text-base font-extrabold', medal.text)}>{entry.win_rate_pct != null ? `${entry.win_rate_pct}%` : '—'}</p>
          <p className="text-[10px] text-ink-muted uppercase tracking-wide">Win rate</p>
        </div>
        <div>
          <p className="text-base font-extrabold text-ink">{entry.average_kda != null ? entry.average_kda.toFixed(1) : '—'}</p>
          <p className="text-[10px] text-ink-muted uppercase tracking-wide">KDA</p>
        </div>
        <div>
          <p className="text-base font-extrabold text-ink flex items-center justify-center gap-1">
            {entry.average_rating != null ? entry.average_rating.toFixed(1) : '—'}
            <Star className="h-3 w-3 text-warning fill-warning" />
          </p>
          <p className="text-[10px] text-ink-muted uppercase tracking-wide">{entry.review_count} avaliações</p>
        </div>
      </div>

      <p className="text-[11px] text-ink-muted flex items-center gap-1.5">
        <Swords className="h-3 w-3 shrink-0" />
        {entry.total_matches} partida{entry.total_matches === 1 ? '' : 's'} analisada{entry.total_matches === 1 ? '' : 's'}
      </p>
    </Link>
  )
}

// ── BoosterCard (grid) ────────────────────────────────────────────────────────

function BoosterCard({ booster, winRate }: { booster: BoosterProfile; winRate: number }) {
  return (
    <Link to={`/boosters/${encodeURIComponent(booster.display_name)}`}>
      <div className="card flex flex-col items-center text-center gap-3 p-4 hover:border-brand/30 hover:shadow-card-hover transition-all cursor-pointer h-full">
        <Avatar src={booster.avatar_url} name={booster.display_name} size="lg" />

        <p className="text-sm font-bold text-ink truncate w-full">{booster.display_name}</p>
        {isBoosterOnline(booster.last_active_at) ? (
          <p className="text-[10px] font-semibold text-success -mt-2 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Online
          </p>
        ) : (
          <p className="text-[10px] text-ink-muted -mt-2">{formatLastSeen(booster.last_active_at)}</p>
        )}

        {winRate > 0 && (
          <div className="text-center">
            <p className="text-lg font-extrabold text-brand leading-none">{winRate.toFixed(1)}%</p>
            <p className="text-[9px] text-ink-muted">winrate</p>
          </div>
        )}

        {booster.current_rank && (
          <div className="flex flex-col items-center gap-1">
            <RankBadge
              tier={booster.current_rank.tier as RankTier}
              division={booster.current_rank.division}
              size="sm"
              showLabel={false}
            />
            <span className="text-[10px] font-semibold text-ink-secondary">
              {formatRank(booster.current_rank.tier as RankTier, booster.current_rank.division)}
            </span>
          </div>
        )}

        {booster.rating_count > 0 ? (
          <div className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-warning fill-warning" />
            <span className="text-xs font-semibold text-ink">{booster.rating.toFixed(1)}</span>
            <span className="text-[10px] text-ink-muted">({booster.rating_count})</span>
          </div>
        ) : (
          <span className="text-[10px] text-ink-muted">Sem avaliações ainda</span>
        )}
      </div>
    </Link>
  )
}

function BoosterCardSkeleton() {
  return (
    <div className="card flex flex-col items-center gap-3 p-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-16" />
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function BoostersPage() {
  const { data: boosters, isLoading } = usePublicBoosters()
  const { data: top3 } = useTopBoosters(3)

  const boosterUserIds = useMemo(() => (boosters ?? []).map(b => b.user_id), [boosters])

  // Win rate real, calculado a partir de partidas sincronizadas
  // (booster_performance_segments -- ver migration 054), nunca digitado à
  // mão. Rollup geral do booster: service_type/rank_bucket = '__all__'.
  const { data: overallPerformance } = useBoostersPerformance(boosterUserIds)

  const winRateByUserId = useMemo(() => new Map(
    (overallPerformance ?? [])
      .filter(s => s.total_matches > 0)
      .map(s => [s.booster_id, (s.wins / s.total_matches) * 100]),
  ), [overallPerformance])

  const sorted = boosters ? [...boosters].sort((a, b) => b.rating - a.rating) : []
  // booster_profile_id (não booster_id/user_id) -- precisa bater com b.id
  // (booster_profiles.id) pra de fato excluir os Top 3 da grade "Demais
  // Boosters" abaixo. Antes disso comparava contra o id errado e todo Top 3
  // aparecia duplicado nas duas seções.
  const top3Ids = new Set((top3 ?? []).map(b => b.booster_profile_id))
  const rest = sorted.filter(b => !top3Ids.has(b.id))

  return (
    <div className="container-wide py-16">
      <SEOHead
        title="Nossos Boosters"
        description="Conheça os boosters verificados do EloPeak, com estatísticas reais de desempenho e win rate por elo."
      />
      {/* Header */}
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 text-brand text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
          <Zap className="h-3.5 w-3.5" />
          Boosters Verificados
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-ink mb-3">
          Nossos <span className="text-brand">Boosters</span>
        </h1>
        <p className="text-ink-secondary max-w-xl mx-auto text-sm leading-relaxed">
          Todos os boosters são verificados e aprovados manualmente. Clique em um perfil para ver estatísticas detalhadas.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <BoosterCardSkeleton key={i} />)}
        </div>
      ) : !sorted.length ? (
        <div className="text-center py-20">
          <p className="text-ink-secondary text-sm">Nenhum booster encontrado no momento.</p>
        </div>
      ) : (
        <div className="space-y-16">

          {/* ── Top 3 Boosters ── */}
          {top3 && top3.length > 0 && (
            <section>
              <div className="flex items-center justify-center gap-2 mb-2">
                <Trophy className="h-5 w-5 text-yellow-400" />
                <h2 className="text-xl font-black text-ink">Top 3 Boosters</h2>
                <Trophy className="h-5 w-5 text-yellow-400" />
              </div>
              <p className="text-center text-xs text-ink-muted mb-8 flex items-center justify-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Seleção automática por win rate, KDA e avaliações — não é uma lista fixa
              </p>

              <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
                {/* Pódio: 2º à esquerda, 1º no meio (mais destaque visual),
                    3º à direita -- position continua vindo do rank real
                    (top3 já chega ordenado 1º->3º), só a ORDEM DE EXIBIÇÃO
                    muda. */}
                {top3
                  .map((entry, idx) => ({ entry, position: idx + 1 }))
                  .sort((a, b) => {
                    const podiumIndex = (p: number) => (p === 1 ? 1 : p === 2 ? 0 : 2)
                    return podiumIndex(a.position) - podiumIndex(b.position)
                  })
                  .map(({ entry, position }, idx) => (
                    <motion.div
                      key={entry.booster_id}
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: idx * 0.08 }}
                    >
                      <TopBoosterCard entry={entry} position={position} />
                    </motion.div>
                  ))}
              </div>
            </section>
          )}

          {/* ── Rest of boosters ── */}
          {rest.length > 0 && (
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-ink-muted text-center mb-8">
                Demais Boosters
              </p>
              {/* flex-wrap centralizado em vez de grid rígido: com poucos
                  boosters (plataforma nova), os cards ficam centralizados e
                  compactos em vez de esparramados num grid de 5 colunas com
                  metade da tela vazia. */}
              <div className="flex flex-wrap justify-center gap-4">
                {rest.map(b => (
                  <motion.div
                    key={b.id}
                    className="w-[160px] sm:w-[180px]"
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35 }}
                  >
                    <BoosterCard booster={b} winRate={winRateByUserId.get(b.user_id) ?? 0} />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  )
}
