import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Star, Clock, CheckCircle2, Trophy, TrendingUp, Zap } from 'lucide-react'
import { Button, Card, RankBadge, Avatar, Skeleton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { timeAgo, formatRank } from '@/lib/utils'
import type { BoosterProfile, RankTier } from '@/types'

type RankGroup = 'gold_minus' | 'plat_diamond' | 'master_plus'

const RANK_GROUPS: { key: RankGroup; label: string; sublabel: string }[] = [
  { key: 'gold_minus',   label: 'Gold e Abaixo',     sublabel: 'Ferro · Bronze · Prata · Ouro'            },
  { key: 'plat_diamond', label: 'Platina – Diamante', sublabel: 'Platina · Esmeralda · Diamante'           },
  { key: 'master_plus',  label: 'Mestre+',            sublabel: 'Mestre · Grão-mestre · Desafiante'        },
]

function StarRating({ rating, count }: { rating: number; count: number }) {
  const filled = Math.round(rating)
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={`h-4 w-4 ${i <= filled ? 'text-warning fill-warning' : 'text-bg-overlay'}`} />
        ))}
      </div>
      <span className="text-sm font-bold text-ink">{rating.toFixed(1)}</span>
      <span className="text-xs text-ink-muted">({count} avaliações)</span>
    </div>
  )
}

export function BoosterPublicProfilePage() {
  const { id } = useParams<{ id: string }>()

  const { data: booster, isLoading } = useQuery({
    queryKey: ['public-booster', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_booster_profiles')
        .select('*')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as BoosterProfile
    },
    enabled: !!id,
  })

  if (isLoading) return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
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

  const hasRankStats = booster.rank_stats && Object.keys(booster.rank_stats).length > 0

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 space-y-6">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/boosters"><ArrowLeft className="h-4 w-4 mr-1" /> Todos os Boosters</Link>
      </Button>

      {/* Hero card */}
      <Card padding="lg">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="relative shrink-0">
            <Avatar name={booster.display_name} size="xl" />
            {booster.is_available && (
              <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-bg-surface" title="Disponível" />
            )}
          </div>

          <div className="flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1">
              <h1 className="text-xl font-extrabold text-ink">{booster.display_name}</h1>
              {booster.is_top5 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 px-2 py-0.5 rounded-full">
                  <Trophy className="h-3 w-3" /> Top 5
                </span>
              )}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                booster.is_available
                  ? 'text-success bg-success/10 border-success/20'
                  : 'text-ink-muted bg-bg-elevated border-bg-overlay'
              }`}>
                {booster.is_available ? 'Disponível' : 'Indisponível'}
              </span>
            </div>

            {booster.rating_count > 0 && (
              <div className="flex justify-center sm:justify-start mb-3">
                <StarRating rating={booster.rating} count={booster.rating_count} />
              </div>
            )}

            {booster.bio && (
              <p className="text-sm text-ink-secondary leading-relaxed">{booster.bio}</p>
            )}
          </div>

          {booster.current_rank && (
            <div className="shrink-0 text-center">
              <p className="text-[10px] text-ink-muted mb-1">Rank Atual</p>
              <RankBadge
                tier={booster.current_rank.tier as RankTier}
                division={booster.current_rank.division}
                size="md"
                showLabel={false}
              />
              <p className="text-[10px] font-semibold text-ink-secondary mt-1">
                {formatRank(booster.current_rank.tier as RankTier, booster.current_rank.division)}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: CheckCircle2, label: 'Concluídos', value: String(booster.total_completed), color: 'text-success' },
          {
            icon: Star,
            label: 'Avaliação',
            value: booster.rating_count > 0 ? `${booster.rating.toFixed(1)} / 5` : '—',
            color: 'text-warning',
          },
          {
            icon: Clock,
            label: 'Visto por último',
            value: booster.last_active_at ? timeAgo(booster.last_active_at) : '—',
            color: 'text-ink-secondary',
          },
          {
            icon: TrendingUp,
            label: 'Rank Máximo',
            value: booster.peak_rank
              ? `${booster.peak_rank.tier}${booster.peak_rank.division ? ' ' + booster.peak_rank.division : ''}`
              : '—',
            color: 'text-brand',
          },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} padding="md" className="flex flex-col gap-1">
            <Icon className={`h-4 w-4 ${color}`} />
            <p className="text-[10px] text-ink-muted mt-1">{label}</p>
            <p className="text-sm font-bold text-ink capitalize">{value}</p>
          </Card>
        ))}
      </div>

      {/* Rank stats per group */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-bold text-ink">Desempenho por Faixa de Elo</h2>
        </div>

        {!hasRankStats ? (
          <p className="text-xs text-ink-muted py-4 text-center">Estatísticas ainda não informadas.</p>
        ) : (
          <div className="space-y-3">
            {RANK_GROUPS.map(g => {
              const stats = booster.rank_stats?.[g.key]
              return (
                <div key={g.key} className="flex items-center gap-4 py-3 border-b border-bg-elevated last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink">{g.label}</p>
                    <p className="text-[10px] text-ink-muted">{g.sublabel}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-6 text-right">
                    <div>
                      <p className="text-[10px] text-ink-muted">KDA Médio</p>
                      <p className="text-sm font-bold text-ink">{stats?.kda != null ? stats.kda.toFixed(1) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-ink-muted">Winrate</p>
                      <p className="text-sm font-bold text-brand">{stats?.winrate != null ? `${stats.winrate}%` : '—'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* CTA */}
      <Card padding="md" variant="brand" className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-ink">Quer boostar com {booster.display_name}?</p>
          <p className="text-xs text-ink-secondary mt-0.5">Faça um pedido e o booster poderá aceitar.</p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link to="/orders/new">Fazer Pedido</Link>
        </Button>
      </Card>
    </div>
  )
}
