import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, ErrorAlert } from '@/components/ui'
import { useSetOrderCredentials } from '@/api/orders'
import type { CustomerOrderState } from '@/api/orders'
import type { Order } from '@/types'

interface CredentialsFormData {
  login: string
  password: string
}

export function CredentialsSection({ order, state }: { order: Order; state?: CustomerOrderState }) {
  const [saved, setSaved] = useState(false)
  const saveCredentials = useSetOrderCredentials(order.id)
  const { register, handleSubmit, reset, formState: { isValid } } = useForm<CredentialsFormData>({
    resolver: zodResolver(z.object({
      login: z.string().trim().min(1, 'Login obrigatório.'),
      password: z.string().min(4, 'Senha deve ter pelo menos 4 caracteres.'),
    })),
    defaultValues: { login: '', password: '' },
    mode: 'onChange',
  })

  if (!state?.requires_credentials) return null
  const canSet = state.can_submit_credentials === true
  if (!canSet && !state.credentials_set) return null

  function submit(data: CredentialsFormData) {
    saveCredentials.mutate({ orderId: order.id, login: data.login.trim(), password: data.password }, {
      onSuccess: () => {
        setSaved(true)
        reset({ login: '', password: '' })
        setTimeout(() => setSaved(false), 3000)
      },
    })
  }

  return (
    <div>
      <p className="text-xs text-ink-secondary mb-4">Evite entrar na conta até o pedido terminar.</p>
      {canSet && (
        <div className="space-y-3">
          <div>
            <label htmlFor="order-credentials-login" className="text-xs font-semibold text-ink-secondary block mb-1">Login / E-mail da conta</label>
            <input id="order-credentials-login" type="text" {...register('login')} placeholder="Ex: SeuUsuario#BR1" className="input-base w-full text-sm" autoComplete="username" maxLength={160} />
          </div>
          <div>
            <label htmlFor="order-credentials-password" className="text-xs font-semibold text-ink-secondary block mb-1">Senha da conta</label>
            <input id="order-credentials-password" type="password" {...register('password')} placeholder="••••••••" className="input-base w-full text-sm" autoComplete="current-password" maxLength={256} />
            <p className="text-[10px] text-ink-muted mt-1">O valor enviado é transformado em payload criptografado no banco. Não compartilhe a senha no chat.</p>
          </div>
          <Button size="sm" className="w-full" loading={saveCredentials.isPending} disabled={!isValid} onClick={handleSubmit(submit)} variant={saved ? 'success' : 'primary'}>
            {saved ? 'Credenciais salvas!' : state.credentials_set ? 'Atualizar credenciais' : 'Salvar credenciais'}
          </Button>
          {saveCredentials.isError && (
            <ErrorAlert message={saveCredentials.error instanceof Error ? saveCredentials.error.message : 'Erro'} />
          )}
        </div>
      )}
    </div>
  )
}
