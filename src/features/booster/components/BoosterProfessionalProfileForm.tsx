import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useOwnProfessionalProfile, useUpdateProfessionalProfile } from '@/api/boosters'

const DAYS = [
  { key: 'mon', label: 'Seg' },
  { key: 'tue', label: 'Ter' },
  { key: 'wed', label: 'Qua' },
  { key: 'thu', label: 'Qui' },
  { key: 'fri', label: 'Sex' },
  { key: 'sat', label: 'Sáb' },
  { key: 'sun', label: 'Dom' },
]

// Mesmo critério aceito na candidatura (BoosterApplicationForm) — mantém o
// rank de pico exibido publicamente consistente com o que foi validado.
const PEAK_OPTIONS = [
  { value: 'grandmaster', label: 'Grão-mestre' },
  { value: 'challenger',  label: 'Desafiante'  },
] as const

const DISPLAY_NAME_COOLDOWN_DAYS = 30

export function BoosterProfessionalProfileForm({ userId }: { userId: string }) {
  const qc = useQueryClient()

  const [displayName, setDisplayName]       = useState('')
  const [bio, setBio]                       = useState('')
  const [peakTier, setPeakTier]             = useState<string | null>(null)
  const [opggLink, setOpggLink]             = useState('')
  const [opggLinkVisible, setOpggLinkVisible] = useState(true)
  const [availableDays, setAvailableDays]   = useState<string[]>([])
  const [hoursMin, setHoursMin]             = useState('')
  const [hoursMax, setHoursMax]             = useState('')
  const [open, setOpen]                     = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  const { data: profile, isLoading } = useOwnProfessionalProfile(userId)
  const updateProfile = useUpdateProfessionalProfile(userId)

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.display_name ?? '')
    setBio(profile.bio ?? '')
    setPeakTier(profile.peak_rank?.tier ?? null)
    setOpggLink(profile.opgg_link ?? '')
    setOpggLinkVisible(profile.opgg_link_visible ?? true)
    setAvailableDays(profile.available_days ?? [])
    setHoursMin(profile.hours_per_day_min != null ? String(profile.hours_per_day_min) : '')
    setHoursMax(profile.hours_per_day_max != null ? String(profile.hours_per_day_max) : '')
  }, [profile])

  // Espelha, só pra UX (desabilitar o campo e mostrar quantos dias faltam),
  // a mesma janela de 30 dias que o trigger trg_fn_enforce_booster_display_name_cooldown
  // já impõe de verdade no banco (migration 025) — a fonte da regra é sempre
  // o backend; isso aqui só evita que o booster tente em vão.
  const changedAt = profile?.display_name_changed_at ? new Date(profile.display_name_changed_at) : null
  const cooldownEndsAt = changedAt ? new Date(changedAt.getTime() + DISPLAY_NAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) : null
  const nameChangeLocked = !!cooldownEndsAt && cooldownEndsAt.getTime() > Date.now()
  const daysRemaining = nameChangeLocked ? Math.ceil((cooldownEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0

  function toggleDay(key: string) {
    setAvailableDays(prev => (prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    // Enquanto no cooldown, nunca manda um display_name diferente do já
    // salvo — mesmo que o campo (desabilitado) tenha algum valor digitado
    // antes de travar. O backend rejeitaria de qualquer forma (migration
    // 025), isso só evita barrar o resto do formulário por causa disso.
    const nextDisplayName = (nameChangeLocked ? profile?.display_name : displayName.trim()) ?? ''
    try {
      await updateProfile.mutateAsync({
        displayName: nextDisplayName,
        bio: bio.trim(),
        peakTier: peakTier ?? '',
        opggLink: opggLink.trim(),
        opggLinkVisible,
        availableDays,
        hoursPerDayMin: hoursMin ? Number(hoursMin) : 0,
        hoursPerDayMax: hoursMax ? Number(hoursMax) : 0,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // Prefix match: cobre ['boosters', 'public-profile', id] (BoosterPublicProfilePage),
      // ['boosters', 'public-list'] (BoostersPage) e ['boosters', 'top'] (HomePage).
      qc.invalidateQueries({ queryKey: ['boosters'] })
    } catch (err) {
      // ApiError.message já vem traduzido (ver PROFESSIONAL_PROFILE_MESSAGES
      // em src/api/boosters/mutations.ts); a mensagem do trigger de cooldown
      // (migration 025/067) chega como erro Postgres cru, com "...em 30
      // dias" já pronta pro usuário -- ambos os casos já têm texto exibível.
      setError(err instanceof Error ? err.message : 'Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="card p-6 space-y-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  const isComplete = !!(displayName.trim() && bio.trim() && peakTier)
  const formValid = !!(
    displayName.trim() && bio.trim() && peakTier
    && opggLink.trim() && availableDays.length > 0
    && hoursMin && hoursMax
  )

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-start gap-3 w-full text-left"
      >
        <ChevronDown className={cn('h-4 w-4 mt-0.5 text-ink-muted shrink-0 transition-transform', !open && '-rotate-90')} />
        <div>
          <h2 className="text-base font-bold text-ink">Perfil Profissional</h2>
          <p className="text-xs text-ink-secondary mt-0.5">Visível para clientes ao acessar seu perfil público.</p>
          {!isComplete && (
            <p className="text-xs text-warning mt-2">Complete suas informações profissionais para aparecer para os clientes.</p>
          )}
        </div>
      </button>

      {open && (
      <div className="card p-6 space-y-6">
      {/* Nome de exibição */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Nome de exibição <span className="text-danger">*</span></label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value.slice(0, 32))}
          maxLength={32}
          placeholder="Nome público"
          disabled={nameChangeLocked}
          className="input-base w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
        />
        {nameChangeLocked && (
          <p className="text-xs text-ink-muted">
            Você já alterou seu nome recentemente. Poderá alterar novamente em {daysRemaining} dia{daysRemaining === 1 ? '' : 's'}.
          </p>
        )}
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Apresentação / Bio <span className="text-danger">*</span></label>
          <span className="text-[10px] text-ink-muted">{bio.length}/256</span>
        </div>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value.slice(0, 256))}
          rows={3}
          placeholder="Conte sobre sua experiência, estilo de jogo e o que te diferencia..."
          className="input-base w-full text-sm resize-none"
        />
      </div>

      {/* Rank de pico */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Rank de Pico <span className="text-danger">*</span></label>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {PEAK_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeakTier(value)}
              className={cn(
                'py-2.5 px-4 rounded-xl border-2 text-sm font-bold transition-all',
                peakTier === value
                  ? 'bg-brand/15 border-brand text-brand'
                  : 'border-border-subtle text-ink-secondary hover:border-brand/40 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* OP.GG */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Link do OP.GG <span className="text-danger">*</span></label>
        <input
          value={opggLink}
          onChange={e => setOpggLink(e.target.value)}
          placeholder="https://op.gg/summoners/br/SeuNome"
          className="input-base w-full text-sm"
        />
        <label className="flex items-center gap-2 pt-1 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={opggLinkVisible}
            onChange={e => setOpggLinkVisible(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-subtle accent-brand"
          />
          <span className="text-xs text-ink-secondary">Exibir link do OP.GG no meu perfil público</span>
        </label>
      </div>

      {/* Disponibilidade de horários */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Disponibilidade <span className="text-danger">*</span></label>
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
                    : 'border-border-subtle text-ink-secondary hover:border-brand/40 hover:text-ink',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Horas mín. / dia</label>
            <input type="number" min={1} max={24} value={hoursMin} onChange={e => setHoursMin(e.target.value)} className="input-base w-full text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted">Horas máx. / dia</label>
            <input type="number" min={1} max={24} value={hoursMax} onChange={e => setHoursMax(e.target.value)} className="input-base w-full text-sm" />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-success">Perfil salvo!</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !formValid}
          title={!formValid ? 'Preencha todos os campos obrigatórios para salvar' : undefined}
          className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold hover:bg-brand/90 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Salvando...' : 'Salvar perfil'}
        </button>
      </div>
      </div>
      )}
    </div>
  )
}
