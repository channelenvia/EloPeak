import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Trophy, Swords, Users, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { Button, Card, BoosterStatusBadge, Avatar } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { formatDate, formatRank } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import type { BoosterProfile } from '@/types'

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

export function AdminBoosterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const currency = useCurrency()

  const { data: booster, isLoading } = useQuery({
    queryKey: ['admin-booster', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('booster_profiles').select('*').eq('id', id!).single()
      if (error) throw error
      return data as unknown as BoosterProfile
    },
    enabled: !!id,
  })

  const { data: slotInfo } = useQuery({
    queryKey: ['admin-booster-slots', booster?.user_id],
    queryFn: async () => {
      const { data } = await supabase.rpc('can_booster_accept_order', {
        p_booster_user_id: booster!.user_id,
        p_boost_mode: 'solo',
      })
      return data as unknown as { solo_count: number; duo_count: number; total_count: number; max_total: number; max_duo: number; is_top5: boolean } | null
    },
    enabled: !!booster?.user_id && booster?.status === 'approved',
  })

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { data, error } = await supabase.rpc('approve_booster', { p_booster_id: id!, p_new_status: status })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao atualizar booster')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-booster', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-boosters'] })
    },
  })

  if (isLoading) return null
  if (!booster) return <p className="text-ink-muted">Booster não encontrado.</p>

  const isPending = booster.status === 'pending' || booster.status === 'under_review'

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button asChild variant="ghost" size="icon">
          <Link to="/admin/boosters"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-xl font-bold text-ink">{booster.display_name}</h1>
        <BoosterStatusBadge status={booster.status} />
        {booster.is_top5 && (
          <span className="flex items-center gap-1 text-xs font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2.5 py-1 uppercase tracking-wide">
            <Trophy className="h-3 w-3" /> TOP 5
          </span>
        )}
      </div>

      {/* Action buttons for pending boosters */}
      {isPending && (
        <Card padding="md">
          <p className="text-sm font-semibold text-ink mb-3">Decisão sobre a candidatura</p>
          <div className="flex gap-3">
            <Button
              variant="success"
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              loading={updateStatus.isPending}
              onClick={() => updateStatus.mutate('approved')}
              className="flex-1"
            >
              Aprovar Booster
            </Button>
            <Button
              variant="danger"
              leftIcon={<XCircle className="h-4 w-4" />}
              loading={updateStatus.isPending}
              onClick={() => updateStatus.mutate('rejected')}
              className="flex-1"
            >
              Rejeitar
            </Button>
          </div>
          {updateStatus.isError && (
            <p className="text-danger text-xs mt-2">{(updateStatus.error as Error).message}</p>
          )}
          {updateStatus.isSuccess && (
            <p className="text-success text-xs mt-2">Status atualizado com sucesso.</p>
          )}
        </Card>
      )}

      {booster.status === 'approved' && (
        <Card padding="md">
          <div className="flex gap-3">
            <Button
              variant="danger-ghost"
              size="sm"
              loading={updateStatus.isPending}
              onClick={() => updateStatus.mutate('suspended')}
            >
              Suspender Booster
            </Button>
          </div>
        </Card>
      )}

      {booster.status === 'suspended' && (
        <Card padding="md">
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={updateStatus.isPending}
              onClick={() => updateStatus.mutate('approved')}
            >
              Reativar Booster
            </Button>
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* Profile overview */}
        <Card padding="md">
          <div className="flex items-start gap-4 mb-4">
            <Avatar name={booster.display_name} size="lg" online={booster.is_available} />
            <div>
              <p className="font-bold text-ink">{booster.display_name}</p>
              <p className="text-sm text-ink-secondary">
                {booster.peak_rank ? formatRank(booster.peak_rank.tier, booster.peak_rank.division) : 'Sem rank de pico'}
              </p>
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
              ['Entrou em',   formatDate(booster.created_at)],
              ['Verificado',  booster.verified_at ? formatDate(booster.verified_at) : 'Ainda não'],
              ['Disponível',  booster.hours_per_day_min || booster.hours_per_day_max
                ? `${booster.hours_per_day_min ?? '?'}–${booster.hours_per_day_max ?? '?'} h/dia`
                : 'Não informado'],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <span className="text-ink-muted">{l}</span>
                <span className="text-ink font-medium">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Personal info / PIX */}
        <Card padding="md">
          <h3 className="text-sm font-semibold text-ink mb-3">Dados Pessoais / PIX</h3>
          <div className="space-y-2 text-sm">
            {[
              ['Nome completo', booster.full_name ?? '—'],
              ['Email',         booster.email    ?? '—'],
              ['CPF',           booster.cpf      ? booster.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—'],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-4">
                <span className="text-ink-muted shrink-0">{l}</span>
                <span className="text-ink font-medium text-right break-all">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Performance */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-3">Desempenho</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: 'Pedidos', value: booster.total_completed },
            { label: 'Ganhos',  value: currency(booster.total_earnings) },
            { label: 'Rating',  value: booster.rating.toFixed(1) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-lg font-bold text-ink">{value}</p>
              <p className="text-xs text-ink-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Active slots */}
      {slotInfo && (
        <Card padding="md">
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
            Uso de Slots
            <span className="text-[10px] font-normal text-ink-muted">
              ({slotInfo.is_top5 ? 'Top5: máx 3 / 2 duo' : 'Normal: máx 2 / 1 duo'})
            </span>
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Solo', value: slotInfo.solo_count, icon: Swords, color: 'text-brand bg-brand/10' },
              { label: 'Duo',  value: `${slotInfo.duo_count}/${slotInfo.max_duo}`, icon: Users, color: 'text-accent bg-accent/10' },
              { label: 'Total', value: `${slotInfo.total_count}/${slotInfo.max_total}`, icon: Trophy,
                color: slotInfo.total_count >= slotInfo.max_total ? 'text-danger bg-danger/10' : 'text-success bg-success/10' },
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

      {/* Bio */}
      {booster.bio && (
        <Card padding="md">
          <h3 className="text-sm font-semibold text-ink mb-2">Biografia</h3>
          <p className="text-sm text-ink-secondary leading-relaxed">{booster.bio}</p>
        </Card>
      )}
    </div>
  )
}
