import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Zap, Star } from 'lucide-react'
import { Card, RankBadge, Avatar, Skeleton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { formatRank } from '@/lib/utils'
import type { BoosterProfile, RankTier } from '@/types'

function BoosterCard({ booster }: { booster: BoosterProfile }) {
  return (
    <Link to={`/boosters/${booster.id}`}>
      <Card padding="md" className="flex flex-col items-center text-center gap-3 hover:border-brand/30 hover:shadow-card-hover transition-all cursor-pointer h-full">
        <div className="relative">
          <Avatar name={booster.display_name} size="lg" />
          {booster.is_available && (
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-success border-2 border-bg-surface" />
          )}
        </div>

        <div className="flex-1 min-w-0 w-full">
          <p className="text-sm font-bold text-ink truncate">{booster.display_name}</p>
          {booster.is_top5 && (
            <span className="inline-block text-[9px] font-bold text-warning bg-warning/10 border border-warning/20 px-1.5 py-0.5 rounded-md mt-0.5">
              TOP 5
            </span>
          )}
        </div>

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
      </Card>
    </Link>
  )
}

function BoosterCardSkeleton() {
  return (
    <Card padding="md" className="flex flex-col items-center gap-3">
      <Skeleton className="h-12 w-12 rounded-full" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-14 w-12 rounded-xl" />
      <Skeleton className="h-3 w-16" />
    </Card>
  )
}

export function BoostersPage() {
  const { data: boosters, isLoading } = useQuery({
    queryKey: ['public-boosters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_booster_profiles')
        .select('*')
        .order('is_top5', { ascending: false })
        .order('rating', { ascending: false })
      if (error) throw error
      return data as BoosterProfile[]
    },
    staleTime: 60_000,
  })

  return (
    <div className="max-w-screen-xl mx-auto px-5 sm:px-8 py-16">
      <div className="text-center mb-12">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <BoosterCardSkeleton key={i} />)}
        </div>
      ) : !boosters?.length ? (
        <div className="text-center py-20">
          <p className="text-ink-secondary text-sm">Nenhum booster disponível no momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {boosters.map(b => <BoosterCard key={b.id} booster={b} />)}
        </div>
      )}
    </div>
  )
}
