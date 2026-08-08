import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Star, Clock, CheckCircle2, Trophy, Zap, DollarSign, Package, MessageSquare } from 'lucide-react'
import { Button, Card, RankBadge, Avatar, Skeleton, StarRating, EmptyState } from '@/components/ui'
import { timeAgo, formatRank, formatDate, formatLastSeen, getServiceLabel } from '@/lib/utils'
import { LANE_LABEL, SPECIALTY_LABEL } from '@/lib/lolTaxonomy'
import type { RankTier } from '@/types'
import { useCurrency } from '@/hooks/useCurrency'
import { usePublicBooster, useBoosterPerformanceByRank } from '@/api/boosters'
import { usePublicCoachingPackages } from '@/api/coaching'
import { useBoosterReviews } from '@/api/reviews'

// ── Helpers ───────────────────────────────────────────────────────────────────

type RankGroup = 'gold_minus' | 'plat_diamond' | 'master_plus'

const RANK_GROUPS: { key: RankGroup; label: string; sublabel: string; tiers: RankTier[] }[] = [
  { key: 'gold_minus',   label: 'Gold e Abaixo',     sublabel: 'Ferro · Bronze · Prata · Ouro',      tiers: ['iron', 'bronze', 'silver', 'gold'] },
  { key: 'plat_diamond', label: 'Platina - Diamante', sublabel: 'Platina · Esmeralda · Diamante',     tiers: ['platinum', 'emerald', 'diamond'] },
  { key: 'master_plus',  label: 'Mestre+',            sublabel: 'Mestre · Grão-mestre · Desafiante',  tiers: ['master', 'grandmaster', 'challenger'] },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export function BoosterPublicProfilePage() {
  const { displayName } = useParams<{ displayName: string }>()
  const currency = useCurrency()

  const { data: booster, isLoading } = usePublicBooster(displayName)
  const { data: services = [] } = usePublicCoachingPackages(booster?.user_id)
  const { data: reviews = [] } = useBoosterReviews(booster?.user_id)

  // Desempenho por faixa de elo vem de booster_performance_segments —
  // calculado automaticamente a partir de partidas reais (order_matches,
  // sincronizadas via sync-order-matches) e reviews, nunca digitado à mão
  // (ver refresh_booster_performance_segments, migration 054).
  const { data: performanceSegments = [] } = useBoosterPerformanceByRank(booster?.user_id)

  if (isLoading) return (
    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64 w-full rounded-2xl lg:col-span-1" />
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )

  if (!booster) return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 text-center">
      <p className="text-ink-secondary">Booster não encontrado.</p>
      <Button asChild variant="ghost" className="mt-4">
        <Link to="/boosters">Voltar</Link>
      </Button>
    </div>
  )

  const hasRankStats = performanceSegments.some(s => s.total_matches > 0)
  const rankGroups = RANK_GROUPS.filter(group =>
    performanceSegments.some(s => s.rank_bucket === group.key && s.total_matches > 0))
  const hasLanes      = booster.lanes && booster.lanes.length > 0
  const hasSpecialties = booster.specialties && booster.specialties.length > 0

  const statCells: {
    key: string
    label: string
    value: string
    color: string
    icon?: typeof CheckCircle2
    rankTier?: RankTier
    rankDivision?: string | null
  }[] = [
    { key: 'completed', icon: CheckCircle2, label: 'Concluídos',       value: String(booster.total_completed), color: 'text-success' },
    { key: 'rating',    icon: Star,         label: 'Avaliação',        value: booster.rating_count > 0 ? `${booster.rating.toFixed(1)} / 5` : '—', color: 'text-warning' },
    { key: 'lastSeen',  icon: Clock,        label: 'Visto por último', value: booster.last_active_at ? timeAgo(booster.last_active_at) : '—', color: 'text-ink-secondary' },
    {
      key: 'peakRank',
      label: 'Rank Máximo',
      value: booster.peak_rank ? formatRank(booster.peak_rank.tier as RankTier, (booster.peak_rank as { division?: string | null }).division ?? null) : '—',
      color: 'text-brand',
      rankTier: booster.peak_rank?.tier as RankTier | undefined,
      rankDivision: (booster.peak_rank as { division?: string | null })?.division ?? null,
    },
  ]

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 space-y-10">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/boosters"><ArrowLeft className="h-4 w-4 mr-1" /> Todos os Boosters</Link>
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

        {/* ── Sidebar: perfil ── */}
        <div className="lg:col-span-1 lg:sticky lg:top-24 space-y-6">
          <Card padding="lg" className="text-center space-y-3">
            <Avatar src={booster.avatar_url} name={booster.display_name} size="xl" className="mx-auto" />

            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <h1 className="text-xl font-extrabold text-ink">{booster.display_name}</h1>
                {booster.is_top3 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 px-2 py-0.5 rounded-full">
                    <Trophy className="h-3 w-3" /> Top 3
                  </span>
                )}
              </div>
              <p className="text-[10px] font-medium text-ink-muted">
                {formatLastSeen(booster.last_active_at)}
              </p>
            </div>

            {/* Estatísticas — 2x2 logo abaixo do nome/badge */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {statCells.map(({ key, icon: Icon, label, value, color, rankTier, rankDivision }) => (
                <div key={key} className="rounded-xl bg-bg-elevated/50 p-2.5 flex flex-col items-center gap-1">
                  {rankTier ? (
                    <RankBadge tier={rankTier} division={rankDivision as never} size="xs" showLabel={false} />
                  ) : Icon ? (
                    <Icon className={`h-4 w-4 ${color}`} />
                  ) : null}
                  <p className="text-xs font-bold text-ink text-center leading-tight">{value}</p>
                  <p className="text-[9px] text-ink-muted uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {booster.rating_count > 0 && (
              <div className="flex justify-center">
                <StarRating rating={booster.rating} count={booster.rating_count} />
              </div>
            )}

            {booster.current_rank && (
              <div className="flex flex-col items-center gap-1 py-1">
                <RankBadge
                  tier={booster.current_rank.tier as RankTier}
                  division={booster.current_rank.division}
                  size="md"
                  showLabel={false}
                />
                <p className="text-[10px] font-semibold text-ink-secondary">
                  {formatRank(booster.current_rank.tier as RankTier, booster.current_rank.division)}
                </p>
              </div>
            )}

            {booster.bio && (
              <p className="text-sm text-ink-secondary leading-relaxed">{booster.bio}</p>
            )}

            {/* Lanes */}
            {hasLanes && (
              <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                {booster.lanes!.map(lane => (
                  <span
                    key={lane}
                    className="px-2.5 py-0.5 rounded-full bg-brand/10 border border-brand/20 text-[11px] font-bold text-brand"
                  >
                    {LANE_LABEL[lane] ?? lane}
                  </span>
                ))}
              </div>
            )}

            {/* Specialties */}
            {hasSpecialties && (
              <div className="flex flex-wrap gap-1.5 justify-center">
                {booster.specialties!.map(s => (
                  <span
                    key={s}
                    className="px-2.5 py-0.5 rounded-full bg-bg-elevated text-[11px] font-medium text-ink-secondary"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Main content ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Serviços */}
          {services.length > 0 && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-4">
                <Package className="h-4 w-4 text-brand" />
                <h2 className="text-sm font-bold text-ink">Serviços</h2>
              </div>
              <p className="text-xs text-ink-muted mb-4">
                Pacotes oferecidos diretamente por {booster.display_name} — cada um com escopo, tempo estimado e preço fechado.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="rounded-xl border border-bg-elevated bg-bg-elevated/30 p-4 flex flex-col gap-2">
                    <div>
                      <p className="text-sm font-bold text-ink">{s.title}</p>
                      {s.service_type && (
                        <p className="text-[10px] font-semibold text-brand uppercase tracking-wide mt-0.5">{getServiceLabel(s.service_type)}</p>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-xs text-ink-secondary leading-relaxed flex-1">{s.description}</p>
                    )}
                    {(s.lanes?.length || s.specialties?.length) && (
                      <div className="flex flex-wrap gap-1.5">
                        {s.lanes?.map(l => (
                          <span key={l} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
                            {LANE_LABEL[l] ?? l}
                          </span>
                        ))}
                        {s.specialties?.map(sp => (
                          <span key={sp} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-bg-elevated text-ink-secondary">
                            {SPECIALTY_LABEL[sp] ?? sp}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-auto pt-2 border-t border-bg-elevated">
                      {s.tempo && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-ink-muted" />
                          <span className="text-[11px] text-ink-secondary">{s.tempo}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 ml-auto">
                        <DollarSign className="h-3 w-3 text-brand" />
                        <span className="text-sm font-bold text-brand">{currency(s.price)}</span>
                      </div>
                    </div>
                    <Button asChild size="sm" className="w-full mt-1">
                      <Link to={
                        s.service_type === 'coaching'
                          ? `/orders/new?service=coaching&booster=${booster.user_id}&coach_package=${s.id}`
                          : `/orders/new?booster=${booster.user_id}`
                      }>Contratar</Link>
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* CTA — logo abaixo dos serviços */}
          <Card padding="md" variant="brand" className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <p className="text-sm font-bold text-ink">Quer boostar com {booster.display_name}?</p>
              <p className="text-xs text-ink-secondary mt-0.5">Faça um pedido e o booster poderá aceitar.</p>
            </div>
            <Button asChild size="sm" className="w-full sm:w-auto shrink-0">
              <Link to={`/orders/new?booster=${booster.user_id}`}>Fazer Pedido</Link>
            </Button>
          </Card>

          {/* Rank stats */}
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-bold text-ink">Desempenho por Faixa de Elo</h2>
            </div>

            {!hasRankStats ? (
              <p className="text-xs text-ink-muted py-4 text-center">Estatísticas ainda não informadas.</p>
            ) : (
              <div className="space-y-3">
                {rankGroups.map(g => {
                  const stats = performanceSegments.find(s => s.rank_bucket === g.key)
                  return (
                    <div key={g.key} className="flex items-center gap-4 py-3 border-b border-bg-elevated last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1 mb-2">
                          {g.tiers.map(tier => (
                            <RankBadge key={tier} tier={tier} size="xs" showDivision={false} showLabel={false} />
                          ))}
                        </div>
                        <p className="text-xs font-semibold text-ink">{g.label}</p>
                        <p className="text-[10px] text-ink-muted">{g.sublabel}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-6 text-right">
                        <div>
                          <p className="text-[10px] text-ink-muted">KDA Médio</p>
                          <p className="text-sm font-bold text-ink">{stats?.average_kda != null ? stats.average_kda.toFixed(1) : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-ink-muted">Winrate</p>
                          <p className="text-sm font-bold text-brand">{stats && stats.total_matches > 0 ? `${Math.round((stats.adjusted_win_rate ?? 0) * 100)}%` : '—'}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

        </div>
      </div>

      {/* ── Avaliações — carrossel full-width no rodapé ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-bold text-ink">Avaliações</h2>
        </div>
        {!reviews.length ? (
          <EmptyState icon={MessageSquare} title="Este booster ainda não recebeu avaliações." />
        ) : reviews.length < 5 ? (
          // Poucas avaliações reais -- lista estática, sem duplicar o array
          // pro efeito de marquee (com 1-2 cards, o loop duplicado só parecia
          // avaliação repetida, não um carrossel de verdade).
          <div className="flex flex-wrap gap-4">
            {reviews.map((review) => (
              <div key={review.id} className="w-72 shrink-0 rounded-xl border border-bg-elevated bg-bg-card p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <StarRating rating={review.rating} size="xs" showValue={false} />
                  <span className="text-[10px] text-ink-muted">{formatDate(review.created_at)}</span>
                </div>
                {review.content && <p className="text-xs text-ink-secondary leading-relaxed line-clamp-4">{review.content}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
            <div className="flex w-max gap-4 animate-marquee group-hover:[animation-play-state:paused]">
              {[...reviews, ...reviews].map((review, i) => (
                <div key={`${review.id}-${i}`} className="w-72 shrink-0 rounded-xl border border-bg-elevated bg-bg-card p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <StarRating rating={review.rating} size="xs" showValue={false} />
                    <span className="text-[10px] text-ink-muted">{formatDate(review.created_at)}</span>
                  </div>
                  {review.content && <p className="text-xs text-ink-secondary leading-relaxed line-clamp-4">{review.content}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
