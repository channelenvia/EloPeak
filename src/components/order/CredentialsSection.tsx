import { useState } from 'react'
import { Button, ErrorAlert } from '@/components/ui'
import { useSetOrderCredentials } from '@/api/orders'
import type { CustomerOrderState } from '@/api/orders'
import type { Order } from '@/types'

export function CredentialsSection({ order, state }: { order: Order; state?: CustomerOrderState }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState(false)
  const saveCredentials = useSetOrderCredentials(order.id)

  if (!state?.requires_credentials) return null
  const canSet = state.can_submit_credentials === true
  if (!canSet && !state.credentials_set) return null

  function submit() {
    saveCredentials.mutate({ orderId: order.id, login: login.trim(), password }, {
      onSuccess: () => {
        setSaved(true)
        setLogin('')
        setPassword('')
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
            <label className="text-xs font-semibold text-ink-secondary block mb-1">Login / E-mail da conta</label>
            <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Ex: SeuUsuario#BR1" className="input-base w-full text-sm" autoComplete="username" maxLength={160} />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">Senha da conta</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input-base w-full text-sm" autoComplete="current-password" maxLength={256} />
            <p className="text-[10px] text-ink-muted mt-1">O valor enviado é transformado em payload criptografado no banco. Não compartilhe a senha no chat.</p>
          </div>
          <Button size="sm" className="w-full" loading={saveCredentials.isPending} disabled={!login.trim() || password.length < 4} onClick={submit} variant={saved ? 'success' : 'primary'}>
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
