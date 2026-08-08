import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { checkRateLimit, limits } from '@/lib/rateLimit'
import { useOnboardBooster } from '@/api/boosters'

const DAYS = [
  { key: 'mon', label: 'Seg' },
  { key: 'tue', label: 'Ter' },
  { key: 'wed', label: 'Qua' },
  { key: 'thu', label: 'Qui' },
  { key: 'fri', label: 'Sex' },
  { key: 'sat', label: 'Sáb' },
  { key: 'sun', label: 'Dom' },
]

const PEAK_OPTIONS = [
  { value: 'grandmaster', label: 'Grão-mestre' },
  { value: 'challenger',  label: 'Desafiante'  },
] as const

const schema = z.object({
  full_name:         z.string().min(3, 'Nome completo obrigatório'),
  cpf:               z.string().regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, 'CPF inválido (ex: 000.000.000-00)'),
  opgg_link:         z.string().min(1, 'Link do OP.GG obrigatório').url('URL inválida'),
  bio:               z.string().min(1, 'Conte um pouco sobre você').max(256, 'Máximo 256 caracteres'),
  peak_tier:         z.enum(['grandmaster', 'challenger'], { required_error: 'Selecione seu rank de pico' }),
  available_days:    z.array(z.string()).min(1, 'Selecione ao menos um dia'),
  hours_per_day_min: z.coerce.number().min(1).max(24),
  hours_per_day_max: z.coerce.number().min(1).max(24),
}).refine((data) => data.hours_per_day_max >= data.hours_per_day_min, {
  path: ['hours_per_day_max'],
  message: 'O máximo deve ser maior ou igual ao mínimo',
})

type FormData = z.infer<typeof schema>

interface BoosterApplicationFormProps {
  submitLabel?: string
  onEnsureBoosterRole?: () => Promise<boolean>
  /** Prefills the form — used to let approved boosters edit their existing application data. */
  initialData?: Partial<FormData>
  /** Called after a successful save instead of the default onboarding redirect. */
  onSuccess?: () => void
}

export function BoosterApplicationForm({
  submitLabel = 'Completar Cadastro',
  onEnsureBoosterRole,
  initialData,
  onSuccess,
}: BoosterApplicationFormProps) {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const onboardBooster = useOnboardBooster(profile?.id)

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: {
      full_name:         initialData?.full_name ?? '',
      cpf:               initialData?.cpf ?? '',
      opgg_link:         initialData?.opgg_link ?? '',
      bio:               initialData?.bio ?? '',
      peak_tier:         initialData?.peak_tier as FormData['peak_tier'],
      available_days:    initialData?.available_days ?? [],
      hours_per_day_min: initialData?.hours_per_day_min ?? 2,
      hours_per_day_max: initialData?.hours_per_day_max ?? 8,
    },
  })

  const peakTier      = watch('peak_tier')
  const availableDays = watch('available_days') ?? []
  const cpfValue      = watch('cpf') ?? ''
  const bioValue      = watch('bio') ?? ''

  function handleCpfChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11)
    let formatted = digits
    if (digits.length > 9) formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    else if (digits.length > 6) formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
    else if (digits.length > 3) formatted = `${digits.slice(0, 3)}.${digits.slice(3)}`
    setValue('cpf', formatted, { shouldValidate: true })
  }

  function toggleDay(key: string) {
    setValue(
      'available_days',
      availableDays.includes(key)
        ? availableDays.filter(day => day !== key)
        : [...availableDays, key],
      { shouldValidate: true },
    )
  }

  async function onSubmit(data: FormData) {
    if (!profile) return
    setSubmitError(null)
    if (!checkRateLimit(`onboarding-${profile.id}`, limits.formSubmit)) {
      setSubmitError('Muitas tentativas. Aguarde alguns segundos.')
      return
    }

    if (onEnsureBoosterRole) {
      const canContinue = await onEnsureBoosterRole()
      if (!canContinue) {
        setSubmitError('Não foi possível iniciar a candidatura. Tente novamente.')
        return
      }
    }

    try {
      await onboardBooster.mutateAsync({
        displayName: profile.username,
        bio: data.bio,
        peakRank: { tier: data.peak_tier, division: null },
        opggLink: data.opgg_link,
        hoursPerDayMin: data.hours_per_day_min,
        hoursPerDayMax: data.hours_per_day_max,
        fullName: data.full_name,
        cpf: data.cpf.replace(/\D/g, ''),
        availableDays: data.available_days,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao enviar candidatura.')
      return
    }

    if (onSuccess) onSuccess()
    else navigate('/booster')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Card padding="md">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-1">Dados Pessoais</p>
        <p className="text-xs text-ink-muted mb-4">Usados para pagamentos via PIX. Não serão exibidos publicamente.</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Nome completo (como no CPF)</label>
            <input
              {...register('full_name')}
              placeholder="João da Silva"
              maxLength={120}
              className="input-base w-full text-sm"
            />
            {errors.full_name && <p className="text-xs text-danger">{errors.full_name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs text-ink-muted">CPF</label>
            <input
              value={cpfValue}
              onChange={(event) => handleCpfChange(event.target.value)}
              placeholder="000.000.000-00"
              className="input-base w-full text-sm max-w-[200px]"
            />
            {errors.cpf && <p className="text-xs text-danger">{errors.cpf.message}</p>}
          </div>
        </div>
      </Card>

      <Card padding="md">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-4">Conta de Jogo</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Link do OP.GG</label>
            <input
              {...register('opgg_link')}
              placeholder="https://op.gg/summoners/br/SeuNome"
              className="input-base w-full text-sm"
            />
            {errors.opgg_link && <p className="text-xs text-danger">{errors.opgg_link.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Sobre você (aparece no perfil público, máx. 256 chars)</label>
            <textarea
              {...register('bio')}
              rows={3}
              placeholder="Jogador GM há 2 temporadas, especialista em mid-lane..."
              maxLength={256}
              className="input-base w-full text-sm resize-none"
            />
            <p className="text-[10px] text-ink-muted text-right">{bioValue.length}/256</p>
            {errors.bio && <p className="text-xs text-danger">{errors.bio.message}</p>}
          </div>
        </div>
      </Card>

      <Card padding="md">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-3">Rank de Pico</p>
        <div className="grid grid-cols-2 gap-3">
          {PEAK_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setValue('peak_tier', value, { shouldValidate: true })}
              className={cn(
                'py-3 px-4 rounded-xl border-2 text-sm font-bold transition-all',
                peakTier === value
                  ? 'bg-brand/15 border-brand text-brand'
                  : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {errors.peak_tier && <p className="text-xs text-danger mt-2">Selecione seu rank de pico</p>}
      </Card>

      <Card padding="md">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-4">Disponibilidade</p>

        <div className="mb-1">
          <p className="text-xs text-ink-muted mb-2">Dias disponíveis</p>
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map(({ key, label }) => {
              const selected = availableDays.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(key)}
                  className={cn(
                    'px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                    selected
                      ? 'bg-brand/15 border-brand text-brand'
                      : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {errors.available_days && (
            <p className="text-xs text-danger mt-2">{errors.available_days.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Horas mínimas / dia</label>
            <input
              type="number" min={1} max={24}
              {...register('hours_per_day_min')}
              className="input-base w-full text-sm"
            />
            {errors.hours_per_day_min && <p className="text-xs text-danger">{errors.hours_per_day_min.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Horas máximas / dia</label>
            <input
              type="number" min={1} max={24}
              {...register('hours_per_day_max')}
              className="input-base w-full text-sm"
            />
            {errors.hours_per_day_max && <p className="text-xs text-danger">{errors.hours_per_day_max.message}</p>}
          </div>
        </div>
      </Card>

      {submitError && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-danger text-sm">
          {submitError}
        </div>
      )}

      <Button type="submit" className="w-full" loading={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  )
}
