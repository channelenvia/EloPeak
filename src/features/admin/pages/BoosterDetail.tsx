import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Trophy, Swords, Users, ExternalLink, ShieldAlert } from 'lucide-react'
import { Button, Card, BoosterStatusBadge, Avatar, Skeleton } from '@/components/ui'
import { formatDate, formatDateTime, formatRank, formatLastSeen } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminBoosterDetail, useBoosterActiveDropWarnings, useBoosterPerformanceByRank } from '@/api/boosters'
import { useBoosterSlotInfo } from '@/api/orders'

type RankBucket = 'gold_minus' | 'plat_diamond' | 'master_plus'
const BRACKET_LABEL: Record<RankBucket, string> = {
  gold_minus: 'Ouro e abaixo',
  plat_diamond: 'Platina–Diamante',
  master_plus: 'Mestre+',
}

function safeOpggUrl(url: string | null): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

const DAY_LABEL: Record<string, string> = { mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb', sun: 'Dom' }

export function AdminBoosterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()

  const { data: booster, isLoading } = useAdminBoosterDetail(id)
  const { data: slotInfo } = useBoosterSlotInfo(booster?.user_id, booster?.status === 'approved')

  // Desempenho por faixa de elo -- calculado automaticamente a partir de
  // partidas reais sincronizadas (order_matches) e reviews, nunca digitado
  // à mão (ver refresh_booster_performance_segments, migration 054).
  const { data: performanceSegments } = useBoosterPerformanceByRank(booster?.user_id)
  const { data: activeWarnings } = useBoosterActiveDropWarnings(booster?.user_id)

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (!booster) return <p className="text-ink-muted">Booster não encontrado.</p>

  const hasStats = !!performanceSegments?.some(s => s.total_matches > 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/admin/boosters"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-xl font-bold text-ink">{booster.display_name}</h1>
        <BoosterStatusBadge status={booster.status} />
        {booster.is_top3 && (
          <span className="flex items-center gap-1 text-xs font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2.5 py-1 uppercase tracking-wide">
            <Trophy className="h-3 w-3" /> TOP 3
          </span>
        )}
      </div>

      {/* Aprovar/rejeitar/suspender/reativar -- só no menu "Ações" da lista
          de boosters (/admin/boosters), pra não ter o mesmo botão em dois
          lugares. Top3 é automático (refresh_top3_boosters), sem toggle manual. */}

      {/* Dados da candidatura -- replica o que foi submetido no formulário
          (BoosterApplicationForm), pra fins de verificação/controle. Não é
          o perfil profissional (isso o cliente já vê na página pública). */}
      <div className="grid md:grid-cols-2 gap-5">
        <Card padding="md">
          <div className="flex items-start gap-4 mb-4">
            <Avatar name={booster.display_name} size="lg" />
            <div>
              <p className="font-bold text-ink">{booster.display_name}</p>
              <p className="text-sm text-ink-secondary">
                {booster.peak_rank ? formatRank(booster.peak_rank.tier, booster.peak_rank.division) : 'Sem rank de pico'}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">{formatLastSeen(booster.last_active_at)}</p>
              {safeOpggUrl(booster.opgg_link) && (
                <a
                  href={safeOpggUrl(booster.opgg_link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-brand hover:underline mt-1"
                >
                  <ExternalLink className="h-3 w-3" /> OP.GG
                </a>
              )}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            {[
              ['Entrou em', formatDate(booster.created_at)],
              ['Verificado', booster.verified_at ? formatDate(booster.verified_at) : 'Ainda não'],
              ['Disponibilidade', booster.available_days?.length
                ? booster.available_days.map(d => DAY_LABEL[d] ?? d).join(', ')
                : 'Não informado'],
              ['Carga horária', booster.hours_per_day_min || booster.hours_per_day_max
                ? `${booster.hours_per_day_min ?? '?'}–${booster.hours_per_day_max ?? '?'} h/dia`
                : 'Não informado'],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-4">
                <span className="text-ink-muted shrink-0">{l}</span>
                <span className="text-ink font-medium text-right">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-ink mb-3">Dados Pessoais / PIX</h3>
          <div className="space-y-2 text-sm">
            {[
              ['Nome completo', booster.full_name ?? '—'],
              ['Email', booster.email ?? '—'],
              ['CPF', booster.cpf ? booster.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—'],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-4">
                <span className="text-ink-muted shrink-0">{l}</span>
                <span className="text-ink font-medium text-right break-all">{v}</span>
              </div>
            ))}
          </div>
          {booster.bio && (
            <div className="mt-3 pt-3 border-t border-bg-elevated">
              <p className="text-xs text-ink-muted mb-1">Bio (candidatura)</p>
              <p className="text-sm text-ink-secondary leading-relaxed">{booster.bio}</p>
            </div>
          )}
        </Card>
      </div>

      {/* Performance */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-3">Desempenho</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: 'Pedidos', value: booster.total_completed },
            { label: 'Ganhos', value: currency(booster.total_earnings) },
            { label: 'Rating', value: booster.rating.toFixed(1) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-lg font-bold text-ink">{value}</p>
              <p className="text-xs text-ink-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Advertências de drop -- contador ativo (últimos 30 dias) + bloqueio
          temporário, se houver. Isenção específica de um drop fica na tela
          de Solicitações de Drop (/admin/drops), pra não duplicar a ação. */}
      {(!!activeWarnings || (booster.blocked_until && new Date(booster.blocked_until) > new Date())) && (
        <Card padding="md" className="ring-1 ring-warning/30">
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" /> Advertências de Drop
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              <span className="font-bold text-ink">{activeWarnings ?? 0}/5</span>{' '}
              <span className="text-ink-muted">advertências ativas (últimos 30 dias)</span>
            </span>
            {booster.blocked_until && new Date(booster.blocked_until) > new Date() && (
              <span className="badge text-xs font-bold text-danger bg-danger/10">
                Bloqueado até {formatDateTime(booster.blocked_until)}
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Estatísticas por faixa de elo -- somente leitura, calculadas
          automaticamente a partir de partidas reais sincronizadas. */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-1">Estatísticas por Faixa de Elo</h3>
        <p className="text-xs text-ink-muted mb-4">
          Calculado automaticamente a partir das partidas sincronizadas dos pedidos concluídos -- mesmos dados exibidos no perfil público.
        </p>
        {!hasStats ? (
          <p className="text-xs text-ink-muted py-4 text-center">Ainda sem partidas suficientes para gerar estatísticas.</p>
        ) : (
          <div className="space-y-3">
            {(Object.keys(BRACKET_LABEL) as RankBucket[]).map((bracket) => {
              const stats = performanceSegments?.find(s => s.rank_bucket === bracket)
              if (!stats || stats.total_matches === 0) return null
              return (
                <div key={bracket} className="flex items-center justify-between py-2 border-b border-bg-elevated last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-ink">{BRACKET_LABEL[bracket]}</p>
                    <p className="text-[10px] text-ink-muted">{stats.total_matches} partida{stats.total_matches === 1 ? '' : 's'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-6 text-right">
                    <div>
                      <p className="text-[10px] text-ink-muted">KDA Médio</p>
                      <p className="text-sm font-bold text-ink">{stats.average_kda != null ? stats.average_kda.toFixed(1) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-ink-muted">Winrate</p>
                      <p className="text-sm font-bold text-brand">{Math.round((stats.adjusted_win_rate ?? 0) * 100)}%</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Active slots */}
      {slotInfo && (
        <Card padding="md">
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
            Uso de Slots
            <span className="text-[10px] font-normal text-ink-muted">
              ({slotInfo.is_top3 ? 'Top3: máx 4 pedidos' : 'Normal: máx 3 pedidos'})
            </span>
          </h3>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Solo', value: slotInfo.solo_count, icon: Swords, color: 'text-brand bg-brand/10' },
              { label: 'Duo',  value: `${slotInfo.duo_count}`, icon: Users, color: 'text-accent bg-accent/10' },
              { label: 'Exclusivo', value: `${slotInfo.exclusive_slot_used ? 1 : 0}/${slotInfo.max_exclusive ?? 1}`, icon: Trophy,
                color: slotInfo.exclusive_slot_used ? 'text-danger bg-danger/10' : 'text-success bg-success/10' },
              { label: 'Total', value: `${slotInfo.total_count}/${slotInfo.max_total}`, icon: Trophy,
                color: (slotInfo.total_count ?? 0) >= (slotInfo.max_total ?? 3) ? 'text-danger bg-danger/10' : 'text-success bg-success/10' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="text-center">
                <div className={`h-9 w-9 rounded-xl ${color} flex items-center justify-center mx-auto mb-2`}>
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-lg font-bold text-ink">{value}</p>
                <p className="text-[10px] text-ink-muted">{label}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  )
}
