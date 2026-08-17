import type { LucideIcon } from 'lucide-react'
import { Zap, Trophy, TrendingUp, Sprout, Swords, Star, Gamepad2 } from 'lucide-react'
import { Card, RankBadge, Skeleton, EmptyState } from '@/components/ui'
import { cn } from '@/lib/utils'
import { RANK_PERFORMANCE_GROUPS } from '@/lib/lolTaxonomy'
import { useBoosterPerformanceByRank } from '@/api/boosters'

interface RankPerformanceBreakdownProps {
  boosterUserId: string | undefined
  className?: string
}

// Faixas de cor por métrica (verde = bom, amarelo = intermediário, vermelho
// = ruim) -- benchmarks gerais de LoL, aplicados só às métricas de
// qualidade (winrate, KDA, farm/min, avaliação). "Partidas" fica de fora:
// é volume, não qualidade. `null` (sem dado ainda) não recebe cor.
const TONE_CLASS = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const

function toneFromThresholds(value: number | null | undefined, good: number, ok: number): string | undefined {
  if (value == null) return undefined
  if (value >= good) return TONE_CLASS.success
  if (value >= ok) return TONE_CLASS.warning
  return TONE_CLASS.danger
}

const winrateTone = (pct: number | null) => toneFromThresholds(pct, 55, 45)
const kdaTone = (kda: number | null | undefined) => toneFromThresholds(kda, 4, 2.5)
const csPerMinTone = (cs: number | null | undefined) => toneFromThresholds(cs, 7, 5)
const ratingTone = (rating: number | null | undefined) => toneFromThresholds(rating, 4.5, 3.5)

// Mesma badge quadradinha do mini-perfil do booster (Rank Máximo/
// Concluídos): fundo bg-bg-elevated/50, ícone em cima, valor em negrito,
// label pequeno em caps embaixo.
function StatCell({ icon: Icon, label, value, valueClassName }: { icon: LucideIcon; label: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded-xl bg-bg-elevated/50 p-2.5 flex flex-col items-center gap-1">
      <Icon className="h-5 w-5 text-ink-muted" />
      <p className={cn('text-xs font-bold text-ink text-center leading-tight', valueClassName)} data-tabular>{value}</p>
      <p className="text-[10px] text-ink-muted uppercase tracking-wide">{label}</p>
    </div>
  )
}

// Versão maior da mesma StatCell, pra linha-resumo (KDA/winrate/avaliação
// médios do booster em todas as faixas) -- se destaca por cima dos 3 cards
// de faixa, que continuam com os valores por faixa individual.
function SummaryStat({ icon: Icon, label, value, valueClassName }: { icon: LucideIcon; label: string; value: string; valueClassName?: string }) {
  return (
    <div className="text-center">
      <p className="text-xs text-ink-muted flex items-center justify-center gap-1.5 uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5 shrink-0" />{label}
      </p>
      <p className={cn('text-xl font-extrabold text-ink mt-1', valueClassName)} data-tabular>{value}</p>
    </div>
  )
}

// Único ponto de renderização da "Desempenho por Faixa de Elo" -- usado tanto
// no perfil público do booster quanto no dashboard dele, pra garantir que
// sejam literalmente a mesma coisa (mesmo componente, mesmos dados reais de
// booster_performance_segments), não duas implementações parecidas.
export function RankPerformanceBreakdown({ boosterUserId, className }: RankPerformanceBreakdownProps) {
  const { data: segments = [], isLoading } = useBoosterPerformanceByRank(boosterUserId)

  const overall = segments.find((s) => s.rank_bucket === '__all__')
  const hasRankStats = segments.some((s) => s.rank_bucket !== '__all__' && s.total_matches > 0)
  const overallWinratePct = overall && overall.total_matches > 0 ? Math.round((overall.wins / overall.total_matches) * 100) : null

  return (
    <Card padding="md" className={className}>
      <div className="flex items-center gap-2 mb-8">
        <Zap className="h-4 w-4 text-brand" />
        <h2 className="text-base font-bold text-ink">Desempenho por Faixa de Elo</h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : !hasRankStats ? (
        <EmptyState
          icon={Trophy}
          title="Estatísticas ainda não informadas"
          description="Complete partidas pra ver o desempenho por faixa de elo aqui."
          className="py-8"
        />
      ) : (
        <>
        <div className="flex items-center justify-center gap-10 sm:gap-16 mb-6 pb-5 border-b border-border-subtle">
          <SummaryStat icon={Swords} label="KDA Médio" value={overall?.average_kda != null ? overall.average_kda.toFixed(1) : '—'} valueClassName={kdaTone(overall?.average_kda)} />
          <SummaryStat icon={TrendingUp} label="Winrate Médio" value={overallWinratePct != null ? `${overallWinratePct}%` : '—'} valueClassName={winrateTone(overallWinratePct)} />
          <SummaryStat
            icon={Star}
            label="Avaliação Média"
            value={overall?.average_rating != null ? `${overall.average_rating.toFixed(1)} (${overall.review_count ?? 0})` : '—'}
            valueClassName={ratingTone(overall?.average_rating)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-4">
          {RANK_PERFORMANCE_GROUPS.map((g) => {
            const stats = segments.find((s) => s.rank_bucket === g.key)
            const winratePct = stats && stats.total_matches > 0 ? Math.round((stats.wins / stats.total_matches) * 100) : null
            return (
              <div key={g.key}>
                <div className="flex flex-col items-center text-center mb-4">
                  <div className="flex items-center mb-2">
                    {g.tiers.map((tier, i) => (
                      <RankBadge key={tier} tier={tier} size="sm" showDivision={false} showLabel={false} className={i > 0 ? '-ml-5' : undefined} />
                    ))}
                  </div>
                  <p className="text-[10px] text-ink-muted">{g.sublabel}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatCell icon={TrendingUp} label="Winrate" value={winratePct != null ? `${winratePct}%` : '—'} valueClassName={winrateTone(winratePct)} />
                  <StatCell icon={Sprout} label="Farm/min" value={stats?.avg_cs_per_min != null ? stats.avg_cs_per_min.toFixed(1) : '—'} valueClassName={csPerMinTone(stats?.avg_cs_per_min)} />
                  <StatCell icon={Swords} label="KDA" value={stats?.average_kda != null ? stats.average_kda.toFixed(1) : '—'} valueClassName={kdaTone(stats?.average_kda)} />
                  <StatCell icon={Gamepad2} label="Partidas" value={String(stats?.total_matches ?? 0)} />
                </div>
              </div>
            )
          })}
        </div>
        </>
      )}
    </Card>
  )
}
