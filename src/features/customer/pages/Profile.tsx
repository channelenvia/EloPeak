import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { User, Mail, Lock } from 'lucide-react'
import { Button, Card, FormField, Input, Avatar } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useState } from 'react'

const profileSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
})

const passwordSchema = z.object({
  newPassword: z.string().min(8),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, {
  path: ['confirmPassword'],
})

type ProfileData = z.infer<typeof profileSchema>
type PasswordData = z.infer<typeof passwordSchema>

export function CustomerProfilePage() {
  const { profile, setProfile } = useAuthStore()
  const { t } = useTranslation()
  const [profileSaved, setProfileSaved] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  const profileForm = useForm<ProfileData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { username: profile?.username ?? '' },
  })

  const passwordForm = useForm<PasswordData>({
    resolver: zodResolver(passwordSchema),
  })

  async function onProfileSave(data: ProfileData) {
    if (!profile) return
    const { data: result, error } = await supabase.rpc('update_my_username', { p_username: data.username })
    if (error) {
      profileForm.setError('username', { message: 'Erro ao salvar' })
      return
    }
    const res = result as { success: boolean; error?: string }
    if (!res.success) {
      profileForm.setError('username', {
        message: res.error === 'username_taken' ? 'Este nome já está em uso' : 'Erro ao salvar',
      })
      return
    }
    setProfile({ ...profile, username: data.username })
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 3000)
  }

  async function onPasswordSave(data: PasswordData) {
    const { error } = await supabase.auth.updateUser({ password: data.newPassword })
    if (!error) {
      passwordForm.reset()
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 3000)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">{t('customer.profile.title')}</h1>

      {/* Avatar & identity */}
      <Card padding="md">
        <div className="flex items-center gap-4 mb-6">
          <Avatar name={profile?.username} size="xl" />
          <div>
            <p className="font-semibold text-ink">{profile?.username}</p>
            <p className="text-sm text-ink-secondary">{profile?.email}</p>
            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-muted text-brand">
              {t('customer.profile.role')}
            </span>
          </div>
        </div>

        <form onSubmit={profileForm.handleSubmit(onProfileSave)} className="space-y-4">
          <FormField label={t('customer.profile.username')} error={profileForm.formState.errors.username?.message} required>
            <Input
              leftElement={<User className="h-4 w-4" />}
              error={!!profileForm.formState.errors.username}
              {...profileForm.register('username')}
            />
          </FormField>

          <FormField label={t('customer.profile.email')}>
            <Input
              type="email"
              value={profile?.email}
              leftElement={<Mail className="h-4 w-4" />}
              disabled
            />
            <p className="text-xs text-ink-muted mt-1">{t('customer.profile.emailHint')}</p>
          </FormField>

          <div className="flex items-center gap-3">
            <Button type="submit" loading={profileForm.formState.isSubmitting}>
              {t('customer.profile.saveProfile')}
            </Button>
            {profileSaved && <span className="text-sm text-success">{t('customer.profile.saved')}</span>}
          </div>
        </form>
      </Card>

      {/* Password */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
          <Lock className="h-4 w-4 text-ink-secondary" />
          Definir / Alterar Senha
        </h3>
        <p className="text-xs text-ink-muted mb-4">
          Opcional. Permite entrar com e-mail e senha além do Discord.
        </p>

        <form onSubmit={passwordForm.handleSubmit(onPasswordSave)} className="space-y-4">
          <FormField label="Nova senha" error={passwordForm.formState.errors.newPassword?.message} required>
            <Input type="password" placeholder="Mínimo 8 caracteres" error={!!passwordForm.formState.errors.newPassword} {...passwordForm.register('newPassword')} />
          </FormField>
          <FormField label="Confirmar senha" error={passwordForm.formState.errors.confirmPassword?.message} required>
            <Input type="password" placeholder="••••••••" error={!!passwordForm.formState.errors.confirmPassword} {...passwordForm.register('confirmPassword')} />
          </FormField>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary" loading={passwordForm.formState.isSubmitting}>
              Salvar Senha
            </Button>
            {passwordSaved && <span className="text-sm text-success">Senha salva com sucesso!</span>}
          </div>
        </form>
      </Card>
    </div>
  )
}
