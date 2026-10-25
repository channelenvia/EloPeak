import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Eye, EyeOff, Search } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { FormField } from '@/components/ui/FormField'
import { Button, ErrorAlert, Modal, RankBadge } from '@/components/ui'
import { RANK_TIER_LABEL } from '@/lib/utils'
import { useAdminSaveDuoAccount } from '@/api/duoAccounts'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import type { Division, RankTier } from '@/types'
import { EMPTY_FORM, accountToForm } from './duoAccountUtils'
import type { AccountForm } from './duoAccountUtils'
import { useDuoRiotLookup } from './useDuoRiotLookup'

export interface DuoFormModalState { mode: 'create' | 'edit'; account?: AdminDuoAccount }

function buildAccountSchema(isCreate: boolean, riotVerified: boolean) {
  return z.object({
    riot_id: z.string().trim().min(1, 'Riot ID obrigatório.'),
    tier: z.custom<RankTier>(),
    division: z.custom<Division>(),
    leaguePoints: z.number().nullable(),
    avgGain: z.number().nullable(),
    avgLoss: z.number().nullable(),
    notes: z.string(),
    is_active: z.boolean(),
    login: z.string(),
    password: z.string(),
  }).superRefine((data, ctx) => {
    if (!isCreate) return
    if (!riotVerified) ctx.addIssue({ code: 'custom', path: ['riot_id'], message: 'Verifique o Riot ID antes de salvar.' })
    if (!data.login.trim()) ctx.addIssue({ code: 'custom', path: ['login'], message: 'Login obrigatório.' })
    if (!data.password.trim()) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Senha obrigatória.' })
  })
}

function VerifiedRankPanel({ form, message }: { form: AccountForm; message: string | null }) {
  return (
    <div className="flex items-center gap-6 rounded-xl border border-brand/25 bg-brand/10 px-5 py-4">
      <RankBadge tier={form.tier} division={form.division} size="lg" showLabel={false} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-ink">{RANK_TIER_LABEL[form.tier]} {form.division}</p>
        <p className="text-xs text-ink-secondary flex items-center gap-1 mt-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
          {message ?? 'Rank cadastrado — verifique novamente pra atualizar.'}
        </p>
      </div>
      {form.leaguePoints != null && (
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-ink">{form.leaguePoints} PDL</p>
          {form.avgGain != null && (
            <p className="text-xs text-ink-muted mt-1">
              Média: +{form.avgGain}{form.avgLoss != null ? ` / −${form.avgLoss}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CredentialFields({ register, isEdit, showPassword, onTogglePassword }: {
  register: UseFormRegister<AccountForm>; isEdit: boolean; showPassword: boolean; onTogglePassword: () => void
}) {
  const hint = isEdit ? ' (deixe em branco p/ manter)' : ''
  return (
    <div className="grid sm:grid-cols-2 gap-6">
      <FormField label={`Login${hint}`} id="duo-account-login">
        <input id="duo-account-login" {...register('login')} className="input-base w-full py-3" autoComplete="off" />
      </FormField>
      <FormField label={`Senha${hint}`} id="duo-account-password">
        <div className="relative">
          <input
            id="duo-account-password"
            type={showPassword ? 'text' : 'password'}
            {...register('password')}
            className="input-base w-full py-3 pr-10"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={onTogglePassword}
            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </FormField>
    </div>
  )
}

export function DuoAccountFormModal({ modal, onClose }: { modal: DuoFormModalState | null; onClose: () => void }) {
  const [showPasswordField, setShowPasswordField] = useState(false)
  const saveMutation = useAdminSaveDuoAccount()
  const isEdit = modal?.mode === 'edit'

  // riotVerified/mode não são campos do form -- são regras de quando login/
  // senha passam a ser obrigatórios, então o schema é reconstruído a cada
  // render fechando sobre eles.
  const lookup = useDuoRiotLookup({
    getRiotId: () => getValues('riot_id'),
    applyRank: (result) => {
      setValue('tier', result.tier!)
      setValue('division', result.division ?? 'IV')
      setValue('leaguePoints', result.league_points ?? null)
      setValue('avgGain', result.avg_lp_gain ?? null)
      setValue('avgLoss', result.avg_lp_loss ?? null)
    },
  })
  const { riotVerified, resetLookup } = lookup
  const { register, handleSubmit, watch, setValue, reset, getValues } = useForm<AccountForm>({
    resolver: zodResolver(buildAccountSchema(modal?.mode === 'create', riotVerified)),
    defaultValues: EMPTY_FORM,
  })
  const form = watch()

  useEffect(() => {
    if (!modal) return
    reset(modal.mode === 'edit' && modal.account ? accountToForm(modal.account) : EMPTY_FORM)
    // Contas já existentes já passaram pela verificação em algum momento —
    // só uma nova conta exige rodar o lookup antes de liberar as credenciais.
    resetLookup(modal.mode === 'edit')
    setShowPasswordField(false)
  }, [modal, reset, resetLookup])

  function onSubmit(data: AccountForm) {
    saveMutation.mutate({
      accountId: modal?.mode === 'edit' ? modal.account?.id : undefined,
      riotId: data.riot_id.trim(),
      label: data.riot_id.trim(),
      tier: data.tier,
      division: data.division,
      notes: data.notes.trim() || undefined,
      isActive: data.is_active,
      login: data.login.trim() || undefined,
      password: data.password || undefined,
    }, { onSuccess: onClose })
  }

  return (
    <Modal
      open={!!modal}
      onOpenChange={(open) => !open && onClose()}
      title={isEdit ? 'Editar Conta Duo' : 'Adicionar conta Duo'}
      description="Login e senha são criptografados no banco e só podem ser revelados por admins e boosters aprovados."
      maxWidth="2xl"
    >
      <div className="space-y-6">
        <FormField
          label="Riot ID"
          id="duo-account-riot-id"
          required
          hint="Consulta rank, divisão e PDL/LP atuais na Riot — nenhum campo de rank é preenchido manualmente."
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="duo-account-riot-id"
              {...register('riot_id', { onChange: () => resetLookup(false) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); lookup.lookupRiot.mutate() }
              }}
              className="input-base flex-1 text-base py-3"
              placeholder="NomeDaConta#TAG"
              autoComplete="off"
              disabled={isEdit}
              maxLength={32}
            />
            <Button
              type="button"
              onClick={() => lookup.lookupRiot.mutate()}
              disabled={lookup.lookupRiot.isPending || !form.riot_id.trim()}
              variant="primary" size="md" className="disabled:cursor-not-allowed shrink-0"
            >
              <Search className="h-4 w-4" />
              {lookup.lookupRiot.isPending ? 'Consultando…' : 'Verificar'}
            </Button>
          </div>
          {lookup.riotLookupError && <ErrorAlert message={lookup.riotLookupError} className="mt-2" />}
        </FormField>

        {riotVerified && <VerifiedRankPanel form={form} message={lookup.riotLookupMessage} />}

        {riotVerified ? (
          <CredentialFields
            register={register}
            isEdit={isEdit}
            showPassword={showPasswordField}
            onTogglePassword={() => setShowPasswordField((v) => !v)}
          />
        ) : (
          <p className="text-sm text-ink-muted rounded-xl border border-border-subtle bg-bg-raised/40 px-5 py-4">
            Verifique o Riot ID acima para liberar os campos de login e senha.
          </p>
        )}

        <FormField label="Notas internas" id="duo-account-notes">
          <textarea id="duo-account-notes" {...register('notes')} rows={3} className="input-base w-full resize-none" />
        </FormField>

        <label className="flex items-center gap-3 text-sm text-ink-secondary rounded-xl border border-border-subtle bg-bg-raised/40 px-5 py-3.5 w-fit">
          <input type="checkbox" {...register('is_active')} className="h-4 w-4" />
          Disponível para boosters
        </label>

        {saveMutation.isError && <ErrorAlert message={(saveMutation.error as Error).message} />}

        <ActionBar className="border-t border-border-subtle -mx-6 px-6 -mb-6 pb-6 mt-2">
          <Button disabled={saveMutation.isPending} variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saveMutation.isPending} onClick={handleSubmit(onSubmit)}>Salvar</Button>
        </ActionBar>
      </div>
    </Modal>
  )
}
