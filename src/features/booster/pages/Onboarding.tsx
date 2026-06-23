import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, FormField, Input, Card } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { RANK_TIER_LABEL, cn } from '@/lib/utils'
import type { RankTier } from '@/types'
import { useTranslation } from 'react-i18next'

const PEAK_TIERS: RankTier[] = ['master', 'grandmaster', 'challenger']

const schema = z.object({
  full_name: z.string().min(3, 'Nome completo obrigatório'),
  cpf: z.string().regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, 'CPF inválido (ex: 000.000.000-00)'),
  display_name: z.string().min(2).max(32),
  bio: z.string().max(500),
  peak_tier: z.string().min(1, 'Selecione seu rank de pico'),
  opgg_link: z.string().url('URL inválida (ex: https://op.gg/...)').or(z.literal('')).optional(),
  hours_per_day_min: z.coerce.number().min(1).max(24).optional(),
  hours_per_day_max: z.coerce.number().min(1).max(24).optional(),
})

type FormData = z.infer<typeof schema>

export function BoosterOnboardingPage() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { peak_tier: '', bio: '', opgg_link: '' },
  })

  const peakTier = watch('peak_tier') as RankTier | ''

  async function onSubmit(data: FormData) {
    if (!profile) return
    setSubmitError(null)

    const { data: result, error } = await supabase.rpc('onboard_booster', {
      p_display_name:      data.display_name,
      p_bio:               data.bio || '',
      p_peak_rank:         data.peak_tier ? { tier: data.peak_tier, division: null } : null,
      p_opgg_link:         data.opgg_link || null,
      p_hours_per_day_min: data.hours_per_day_min ?? null,
      p_hours_per_day_max: data.hours_per_day_max ?? null,
      p_full_name:         data.full_name,
      p_cpf:               data.cpf.replace(/\D/g, ''),
    })

    if (error) {
      setSubmitError(`Erro: ${error.message}`)
      return
    }

    const res = result as { success: boolean; error?: string }

    if (!res.success) {
      setSubmitError(`Erro: ${res.error ?? 'falha desconhecida'}`)
      return
    }

    navigate('/booster')
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t('booster.onboarding.title')}</h1>
        <p className="text-sm text-ink-secondary mt-1">
          {t('booster.onboarding.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Dados pessoais / PIX */}
        <Card padding="lg">
          <h2 className="text-base font-bold text-ink mb-1">Dados Pessoais</h2>
          <p className="text-xs text-ink-muted mb-4">
            Usados para processar seus pagamentos via PIX. Não serão exibidos publicamente.
          </p>
          <div className="space-y-4">
            <FormField label="Nome completo (como no CPF)" error={errors.full_name?.message} required>
              <Input placeholder="João da Silva" {...register('full_name')} />
            </FormField>

            <FormField
              label="CPF"
              error={errors.cpf?.message}
              hint="Sua chave PIX padrão para receber os pagamentos dos seus pedidos."
              required
            >
              <Input placeholder="000.000.000-00" maxLength={14} className="max-w-[200px]" {...register('cpf')} />
            </FormField>
          </div>
        </Card>

        {/* Perfil de booster */}
        <Card padding="lg">
          <h2 className="text-base font-bold text-ink mb-4">Perfil de Booster</h2>
          <div className="space-y-4">
            <FormField label={t('booster.onboarding.displayName')} error={errors.display_name?.message} required>
              <Input placeholder="YourBoosterName" {...register('display_name')} />
            </FormField>

            <FormField label={t('booster.onboarding.bio')} hint={t('booster.onboarding.bioHint')}>
              <textarea
                placeholder={t('booster.onboarding.bioPlaceholder')}
                className="input-base min-h-[80px] resize-none"
                {...register('bio')}
              />
            </FormField>

            <FormField label={t('booster.onboarding.peakRank')} error={errors.peak_tier?.message} required>
              <div className="flex flex-wrap gap-1.5">
                {PEAK_TIERS.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setValue('peak_tier', tier, { shouldValidate: true })}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-semibold border transition-all',
                      peakTier === tier
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30'
                    )}
                  >
                    {RANK_TIER_LABEL[tier]}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="Link do OP.GG" error={errors.opgg_link?.message}>
              <Input placeholder="https://op.gg/summoners/br/SeuNome" {...register('opgg_link')} />
            </FormField>

            <FormField label="Horas disponíveis para jogar por dia">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-ink-muted mb-1">Mínimo</p>
                  <Input type="number" min={1} max={24} placeholder="ex: 2" {...register('hours_per_day_min')} />
                </div>
                <span className="text-ink-muted mt-5">–</span>
                <div className="flex-1">
                  <p className="text-xs text-ink-muted mb-1">Máximo</p>
                  <Input type="number" min={1} max={24} placeholder="ex: 8" {...register('hours_per_day_max')} />
                </div>
                <span className="text-sm text-ink-muted mt-5">horas/dia</span>
              </div>
            </FormField>
          </div>
        </Card>

        {submitError && (
          <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-danger text-sm">
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" loading={isSubmitting}>
          {t('booster.onboarding.submit')}
        </Button>
      </form>
    </div>
  )
}
