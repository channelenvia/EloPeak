import { Link } from 'react-router-dom'
import { ChevronRight, Star } from 'lucide-react'
import { Avatar, Button, RankBadge } from '@/components/ui'
import { boosterProfilePath } from '@/lib/boosterPath'
import { formatRank } from '@/lib/utils'
import type { RankTier } from '@/types'
import { useTopBoosters } from '@/api/boosters'
import { Rise } from './Rise'
import { WordsHeading } from './WordsHeading'

const FEATURED_COUNT = 4

// Mesma seleção sistemática do Top 3 da /boosters (get_top_boosters), com 1 a mais
// para preencher as 4 colunas da home; não é uma lista fixa/manual.
export function FeaturedBoosters() {
  const { data } = useTopBoosters(FEATURED_COUNT)
  const boosters = (data ?? []).map((b) => ({
    id: b.booster_profile_id,
    display_name: b.display_name,
    avatar_url: b.avatar_url,
    current_rank: b.current_rank,
    rating: b.average_rating ?? 0,
    rating_count: b.review_count,
    win_rate_pct: b.win_rate_pct,
    total_matches: b.total_matches,
  }))
  if (boosters.length === 0) return null

  return (
    <section className="py-16 lg:py-24">
      <div className="container-wide">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Rise><p className="section-label mb-3">Boosters</p></Rise>
            <WordsHeading text="Perfis em destaque" className="font-display text-4xl font-black text-ink md:text-5xl" highlight={[1]} />
            <Rise step={1}><p className="mt-4 max-w-xl text-lg text-ink-secondary">Boosters aprovados manualmente, com dados carregados direto do catálogo público.</p></Rise>
          </div>
          <Button asChild variant="link"><Link to="/boosters">Ver todos <ChevronRight className="h-4 w-4" /></Link></Button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {boosters.map((booster, i) => (
            <Rise key={booster.id} step={i} className="h-full">
              <Link to={boosterProfilePath(booster)} className="card flex h-full flex-col gap-4 p-5 transition-all hover:-translate-y-1 hover:border-brand/25 hover:shadow-card-hover">
                <div className="flex items-center gap-3">
                  <Avatar src={booster.avatar_url} name={booster.display_name} size="md" />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{booster.display_name}</p>
                    <div className="mt-0.5 flex items-center gap-1">
                      <Star className="h-3 w-3 fill-warning text-warning" />
                      <span className="text-xs font-semibold text-ink-secondary">{booster.rating_count > 0 ? booster.rating.toFixed(1) : 'Novo'}</span>
                    </div>
                  </div>
                </div>
                {booster.current_rank && (
                  <div className="flex items-center gap-2">
                    <RankBadge tier={booster.current_rank.tier as RankTier} division={booster.current_rank.division} size="sm" showLabel={false} />
                    <span className="text-xs font-semibold text-ink-secondary">{formatRank(booster.current_rank.tier as RankTier, booster.current_rank.division)}</span>
                  </div>
                )}
                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
                  <div>
                    <p className="text-2xs text-ink-muted">Winrate</p>
                    <p className="text-sm font-extrabold text-brand">{booster.win_rate_pct && booster.win_rate_pct > 0 ? `${booster.win_rate_pct}%` : 'Sem partidas'}</p>
                  </div>
                  <div>
                    <p className="text-2xs text-ink-muted">Partidas</p>
                    <p className="text-sm font-extrabold text-ink">{booster.total_matches}</p>
                  </div>
                </div>
              </Link>
            </Rise>
          ))}
        </div>
      </div>
    </section>
  )
}
