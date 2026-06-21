import { useQuery } from '@tanstack/react-query'
import { Star, Trophy, TrendingUp } from 'lucide-react'
import { Card, Avatar, Skeleton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatRank } from '@/lib/utils'
import type { BoosterProfile } from '@/types'
import { useTranslation } from 'react-i18next'

export function BoosterProfilePage() {
  const { profile } = useAuthStore()
  const { t } = useTranslation()

  const { data: boosterProfile, isLoading } = useQuery({
    queryKey: ['booster-profile', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('booster_profiles').select('*').eq('user_id', profile!.id).single()
      if (error) throw error
      return data as unknown as BoosterProfile
    },
    enabled: !!profile?.id,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (!boosterProfile) return null

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">{t('booster.profile.title')}</h1>

      <Card padding="lg">
        <div className="flex items-start gap-5">
          <Avatar name={boosterProfile.display_name} size="xl" online={boosterProfile.is_available} />
          <div className="flex-1">
            <h2 className="text-xl font-bold text-ink">{boosterProfile.display_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Star className="h-4 w-4 fill-accent text-accent" />
              <span className="text-sm font-semibold text-ink">{boosterProfile.rating.toFixed(1)}</span>
              <span className="text-xs text-ink-muted">{t('booster.profile.reviews', { count: boosterProfile.rating_count })}</span>
            </div>
          </div>
        </div>

        {boosterProfile.bio && (
          <p className="mt-4 text-sm text-ink-secondary leading-relaxed">{boosterProfile.bio}</p>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card padding="md" className="text-center">
          <Trophy className="h-6 w-6 text-accent mx-auto mb-2" />
          <p className="text-2xl font-bold text-ink">{boosterProfile.total_completed}</p>
          <p className="text-xs text-ink-secondary">{t('booster.profile.ordersDone')}</p>
        </Card>
        <Card padding="md" className="text-center">
          <Star className="h-6 w-6 fill-accent text-accent mx-auto mb-2" />
          <p className="text-2xl font-bold text-ink">{boosterProfile.rating.toFixed(1)}</p>
          <p className="text-xs text-ink-secondary">{t('booster.profile.avgRating')}</p>
        </Card>
        <Card padding="md" className="text-center">
          <TrendingUp className="h-6 w-6 text-brand mx-auto mb-2" />
          <p className="text-sm font-bold text-ink">
            {boosterProfile.peak_rank
              ? formatRank(boosterProfile.peak_rank.tier, boosterProfile.peak_rank.division)
              : '—'}
          </p>
          <p className="text-xs text-ink-secondary">{t('booster.profile.peakRank')}</p>
        </Card>
      </div>
    </div>
  )
}
