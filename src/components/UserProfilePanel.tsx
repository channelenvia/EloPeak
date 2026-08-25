import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, LogOut } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { signOut } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { AvatarIconPicker } from '@/components/profile/AvatarIconPicker'
import { DiscordAccountNotice } from '@/components/DiscordAccountNotice'
import type { UserRole } from '@/types'
import { useBoosterPanelFields, useUpdateMyAvatar, useBoosterPanelMutations } from '@/api/auth'
import { ApiError } from '@/api/core/errors'

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<UserRole, { label: string; className: string }> = {
  customer: { label: 'Cliente',  className: 'text-brand bg-brand/10'      },
  booster:  { label: 'Booster',  className: 'text-success bg-success/10'  },
  admin:    { label: 'Admin',    className: 'text-danger bg-danger/10'     },
}

// A personalização do perfil acontece exclusivamente aqui no popover —
// não existe mais página "Meu Perfil" separada para nenhum papel.

// ── Component ─────────────────────────────────────────────────────────────────

interface UserProfilePanelProps {
  open: boolean
  onClose: () => void
}

export function UserProfilePanel({ open, onClose }: UserProfilePanelProps) {
  const { profile, setProfile } = useAuthStore()
  const navigate = useNavigate()

  const isBooster = profile?.role === 'booster'

  const updateAvatar = useUpdateMyAvatar()
  const boosterMutations = useBoosterPanelMutations(profile?.id)

  // ── Booster: display_name (30-day cooldown, enforced server-side em
  // update_my_display_name -- ver booster_display_name_cooldown_days_remaining) ──
  const [displayName, setDisplayName]             = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError]   = useState<string | null>(null)
  const [displayNameSaved, setDisplayNameSaved]   = useState(false)

  // ── Booster: full_name ──
  const [fullName, setFullName]           = useState('')
  const [fullNameSaving, setFullNameSaving] = useState(false)
  const [fullNameSaved, setFullNameSaved]   = useState(false)

  // ── Booster: CPF ──
  const [cpf, setCpf]             = useState('')
  const [cpfSaving, setCpfSaving] = useState(false)
  const [cpfError, setCpfError]   = useState<string | null>(null)
  const [cpfSaved, setCpfSaved]   = useState(false)

  // Booster profile data
  const { data: boosterData } = useBoosterPanelFields(profile?.id, open && isBooster)

  useEffect(() => {
    if (boosterData) {
      setDisplayName(boosterData.display_name ?? '')
      setFullName(boosterData.full_name ?? '')
      setCpf(boosterData.cpf ? formatCpf(boosterData.cpf) : '')
    }
  }, [boosterData])

  // Espelha, só pra UX, o mesmo cooldown de 30 dias que
  // update_my_display_name já impõe de verdade no banco.
  const DISPLAY_NAME_COOLDOWN_DAYS = 30
  const changedAt = boosterData?.display_name_changed_at ? new Date(boosterData.display_name_changed_at) : null
  const cooldownEndsAt = changedAt ? new Date(changedAt.getTime() + DISPLAY_NAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) : null
  const displayNameLocked = !!cooldownEndsAt && cooldownEndsAt.getTime() > Date.now()
  const displayNameDaysRemaining = displayNameLocked ? Math.ceil((cooldownEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0

  function formatCpf(raw: string) {
    const d = raw.replace(/\D/g, '')
    if (d.length !== 11) return raw
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  }

  function handleCpfChange(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 11)
    let fmt = digits
    if (digits.length > 9) fmt = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    else if (digits.length > 6) fmt = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
    else if (digits.length > 3) fmt = `${digits.slice(0, 3)}.${digits.slice(3)}`
    setCpf(fmt)
    setCpfError(null)
  }

  // ── Handlers ──

  async function handleSaveDisplayName() {
    if (!profile || !displayName.trim()) return
    setDisplayNameSaving(true)
    setDisplayNameError(null)
    try {
      await boosterMutations.updateDisplayName.mutateAsync({ userId: profile.id, displayName: displayName.trim() })
      setDisplayNameSaved(true)
      setTimeout(() => setDisplayNameSaved(false), 3000)
    } catch (err) {
      setDisplayNameError(err instanceof ApiError ? err.message : 'Erro ao salvar')
    } finally {
      setDisplayNameSaving(false)
    }
  }

  async function handleSelectIcon(url: string) {
    if (!profile) return
    await updateAvatar.mutateAsync({ userId: profile.id, avatarUrl: url })
    setProfile({ ...profile, avatar_url: url })
  }

  async function handleSaveFullName() {
    if (!profile) return
    setFullNameSaving(true)
    await boosterMutations.updateFullName.mutateAsync({ userId: profile.id, fullName: fullName.trim() || null })
    setFullNameSaving(false)
    setFullNameSaved(true)
    setTimeout(() => setFullNameSaved(false), 3000)
  }

  async function handleSaveCpf() {
    if (!profile) return
    const digits = cpf.replace(/\D/g, '')
    if (digits.length !== 11) { setCpfError('CPF inválido'); return }
    setCpfSaving(true)
    setCpfError(null)
    try {
      await boosterMutations.updateCpf.mutateAsync({ userId: profile.id, cpf: digits })
      setCpfSaved(true)
      setTimeout(() => setCpfSaved(false), 3000)
    } catch {
      setCpfError('Erro ao salvar')
    } finally {
      setCpfSaving(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    // Rascunho do configurador de pedido não pode sobreviver a um logout --
    // senão o próximo login na mesma aba/computador (outra conta) veria/
    // continuaria o rascunho de quem saiu.
    useOrderBuilderStore.getState().reset()
    navigate('/')
  }

  if (!open) return null

  const role = profile?.role ?? 'customer'
  const roleBadge = ROLE_BADGE[role]

  // Portal pra document.body: os headers que montam esse painel (Booster/
  // Customer/AdminLayout) usam backdrop-blur, que -- assim como transform/
  // filter/will-change -- cria containing block pra descendentes
  // `position: fixed`. Sem o portal, o backdrop e o aside abaixo ficavam
  // confinados à caixa do header (~68px), não ao viewport inteiro.
  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <aside className="fixed right-0 top-0 h-full w-96 bg-bg-surface/90 backdrop-blur-xl border-l border-border-subtle z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <h2 className="text-base font-bold text-ink">Minha Conta</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-lg hover:bg-bg-elevated text-ink-muted hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <Avatar src={profile?.avatar_url} name={profile?.username} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold text-ink text-sm truncate">{profile?.username}</p>
              <p className="text-xs text-ink-muted truncate">{profile?.email}</p>
              {roleBadge && (
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full mt-1 inline-block font-semibold', roleBadge.className)}>
                  {roleBadge.label}
                </span>
              )}
            </div>
          </div>

          {/* Dados da conta */}
          <div className="rounded-xl border border-border-subtle p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">Username do Discord</span>
              <span className="text-ink font-medium truncate max-w-[160px]">{profile?.username ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">ID do Discord</span>
              <span className="text-ink font-medium font-mono truncate max-w-[160px]">{profile?.discord_id ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">E-mail</span>
              <span className="text-ink font-medium truncate max-w-[160px]">{profile?.email ?? '—'}</span>
            </div>
          </div>

          {/* Riot icon picker */}
          <AvatarIconPicker currentUrl={profile?.avatar_url} onSelect={handleSelectIcon} maxIcons={90} />

          {/* Booster-only fields */}
          {isBooster && (
            <div className="border-t border-border-subtle pt-4 space-y-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Conta Booster</p>

              {/* Nome de exibição (público, cooldown de 30 dias) */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Nome de exibição</p>
                <div className="flex gap-2">
                  <input
                    value={displayName}
                    onChange={e => { setDisplayName(e.target.value.slice(0, 32)); setDisplayNameError(null) }}
                    placeholder="Nome público"
                    maxLength={32}
                    disabled={displayNameLocked}
                    className="input-base flex-1 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={handleSaveDisplayName}
                    disabled={displayNameSaving || displayNameLocked || !displayName.trim() || displayName === boosterData?.display_name}
                    className="px-3 py-2 rounded-xl bg-brand text-white text-xs font-bold hover:bg-brand/90 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {displayNameSaving ? '...' : 'Salvar'}
                  </button>
                </div>
                {displayNameLocked && (
                  <p className="text-xs text-ink-muted">
                    Você já alterou seu nome de exibição recentemente. Poderá alterar novamente em {displayNameDaysRemaining} dia{displayNameDaysRemaining === 1 ? '' : 's'}.
                  </p>
                )}
                {displayNameError && <p className="text-xs text-danger">{displayNameError}</p>}
                {displayNameSaved && <p className="text-xs text-success">Nome de exibição salvo!</p>}
              </div>

              {/* Full name */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Nome completo (PIX)</p>
                <div className="flex gap-2">
                  <input
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Como no CPF"
                    maxLength={120}
                    className="input-base flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSaveFullName}
                    disabled={fullNameSaving || fullName.trim() === (boosterData?.full_name ?? '')}
                    className="px-3 py-2 rounded-xl bg-brand text-white text-xs font-bold hover:bg-brand/90 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {fullNameSaving ? '...' : 'Salvar'}
                  </button>
                </div>
                {fullNameSaved && <p className="text-xs text-success">Nome salvo!</p>}
              </div>

              {/* CPF */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">CPF (PIX)</p>
                <div className="flex gap-2">
                  <input
                    value={cpf}
                    onChange={e => handleCpfChange(e.target.value)}
                    placeholder="000.000.000-00"
                    className="input-base flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCpf}
                    disabled={cpfSaving || cpf.replace(/\D/g, '').length !== 11}
                    className="px-3 py-2 rounded-xl bg-brand text-white text-xs font-bold hover:bg-brand/90 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {cpfSaving ? '...' : 'Salvar'}
                  </button>
                </div>
                {cpfError && <p className="text-xs text-danger">{cpfError}</p>}
                {cpfSaved && <p className="text-xs text-success">CPF salvo!</p>}
              </div>
            </div>
          )}

          <DiscordAccountNotice />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle shrink-0">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition-colors text-sm font-semibold"
          >
            <LogOut className="h-4 w-4" />
            Sair da conta
          </button>
        </div>
      </aside>
    </>,
    document.body
  )
}
