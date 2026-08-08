import { useState, useEffect, KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { LANES } from '@/lib/lolTaxonomy'
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

const MAX_SPECIALTIES = 8

const DISPLAY_NAME_COOLDOWN_DAYS = 30

export function BoosterProfessionalProfileForm({ userId }: { userId: string }) {
  const qc = useQueryClient()

  const [displayName, setDisplayName]       = useState('')
  const [bio, setBio]                       = useState('')
  const [lanes, setLanes]                   = useState<string[]>([])
  const [specialties, setSpecialties]       = useState<string[]>([])
  const [specialtyInput, setSpecialtyInput] = useState('')
  const [peakTier, setPeakTier]             = useState<string | null>(null)
  const [opggLink, setOpggLink]             = useState('')
  const [availableDays, setAvailableDays]   = useState<string[]>([])
  const [hoursMin, setHoursMin]             = useState('')
  const [hoursMax, setHoursMax]             = useState('')
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  const { data: profile, isLoading } = useOwnProfessionalProfile(userId)
  const updateProfile = useUpdateProfessionalProfile(userId)

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.display_name ?? '')
    setBio(profile.bio ?? '')
    setLanes(profile.lanes ?? [])
    setSpecialties(profile.specialties ?? [])
    setPeakTier(profile.peak_rank?.tier ?? null)
    setOpggLink(profile.opgg_link ?? '')
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

  function toggleLane(key: string) {
    setLanes(prev => (prev.includes(key) ? prev.filter(l => l !== key) : prev.length < 2 ? [...prev, key] : prev))
  }

  function toggleDay(key: string) {
    setAvailableDays(prev => (prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]))
  }

  function addSpecialty() {
    const s = specialtyInput.trim().slice(0, 30)
    if (!s || specialties.includes(s) || specialties.length >= MAX_SPECIALTIES) return
    setSpecialties(prev => [...prev, s])
    setSpecialtyInput('')
  }

  function handleSpecialtyKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addSpecialty() }
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
        lanes,
        specialties,
        peakTier: peakTier ?? '',
        opggLink: opggLink.trim(),
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

  const isComplete = !!(displayName.trim() && bio.trim() && lanes.length && peakTier)
  const formValid = !!(
    displayName.trim() && bio.trim() && peakTier
    && lanes.length > 0 && specialties.length > 0
    && opggLink.trim() && availableDays.length > 0
    && hoursMin && hoursMax
  )

  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="text-sm font-bold text-ink">Perfil Profissional</h2>
        <p className="text-xs text-ink-muted mt-0.5">Visível para clientes ao acessar seu perfil público.</p>
        {!isComplete && (
          <p className="text-xs text-warning mt-2">Complete suas informações profissionais para aparecer para os clientes.</p>
        )}
      </div>

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
                  : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Lanes */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
          Lanes Masterizadas <span className="text-danger">*</span> <span className="normal-case font-normal">(máx. 2)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {LANES.map(({ key, label }) => {
            const selected = lanes.includes(key)
            const disabled = !selected && lanes.length >= 2
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLane(key)}
                disabled={disabled}
                className={cn(
                  'px-3.5 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                  selected
                    ? 'bg-brand/15 border-brand text-brand'
                    : disabled
                    ? 'border-bg-elevated text-ink-muted opacity-40 cursor-not-allowed'
                    : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Specialties */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
          Especialidades <span className="text-danger">*</span> <span className="normal-case font-normal">({specialties.length}/{MAX_SPECIALTIES})</span>
        </label>
        {specialties.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {specialties.map(s => (
              <span key={s} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg-elevated text-xs font-medium text-ink-secondary">
                {s}
                <button type="button" onClick={() => setSpecialties(prev => prev.filter(x => x !== s))} className="hover:text-danger transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {specialties.length < MAX_SPECIALTIES && (
          <div className="flex gap-2">
            <input
              value={specialtyInput}
              onChange={e => setSpecialtyInput(e.target.value.slice(0, 30))}
              onKeyDown={handleSpecialtyKey}
              placeholder="Ex: Farmador, Teamfighter, Macro..."
              className="input-base flex-1 text-sm"
            />
            <button
              type="button"
              onClick={addSpecialty}
              disabled={!specialtyInput.trim()}
              aria-label="Adicionar especialidade"
              className="px-3 py-2 rounded-xl bg-bg-elevated text-ink-secondary hover:text-ink hover:bg-bg-overlay disabled:opacity-40 transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
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
                    : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
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
  )
}
