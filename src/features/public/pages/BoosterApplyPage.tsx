import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LogoMark, PageLoader } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { BoosterApplicationForm } from '@/features/booster/components/BoosterApplicationForm'
import { PendingScreen, RejectedScreen, SuspendedScreen, RemovedScreen, BoosterStatusErrorScreen } from '@/features/booster/components/BoosterStatusScreens'
import { requestBoosterRole, useBoosterStatus } from '@/api/boosters'
import { queryKeys } from '@/api/core/queryKeys'

export function BoosterApplyPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile } = useAuthStore()
  const isBoosterIntent = searchParams.get('booster') === '1'
  const isAlreadyBooster = profile?.role === 'booster'
  const { data: access, isLoading: statusLoading } = useBoosterStatus(profile?.id)
  const state = statusLoading || !access ? 'loading' : access.state

  if (!isBoosterIntent) return <Navigate to="/" replace />
  if (!profile) return null
  if (profile.role !== 'customer' && !isAlreadyBooster) return <Navigate to="/" replace />
  // Fonte de verdade é o status real da candidatura, não a role -- role só
  // vira 'booster' em approve_booster() (após aprovação do admin), então um
  // candidato recém-aplicado continua com role='customer' durante toda a
  // análise. Checar só `isAlreadyBooster` aqui deixava pending/rejected sem
  // tela nenhuma pra quem ainda não foi aprovado.
  if (state === 'approved') return <Navigate to="/booster" replace />

  async function startBoosterApplication() {
    if (!profile) return false
    if (profile.role === 'booster') return true

    // Compatibility RPC: it no longer promotes the user to booster. It only
    // verifies the user can start an application; the role is changed by admin
    // approval in the database.
    const result = await requestBoosterRole().catch(() => null)
    return !!result?.success
  }

  async function handleApplicationSaved() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.boosters.status(profile?.id ?? '') })
    navigate('/apply?booster=1', { replace: true })
  }

  const header = (
    <div className="flex items-center">
      <Link to="/" className="flex items-center gap-2">
        <LogoMark className="h-9 w-9" />
        <span className="text-xl font-bold text-ink">
          Elo<span className="text-brand">Peak</span>
        </span>
      </Link>
    </div>
  )

  // Mostra as telas de status sempre que já existe uma candidatura (pending/
  // rejected/error), independente da role -- ver comentário acima. Sem
  // candidatura (`no_application`) cai pro formulário abaixo, que serve tanto
  // pra quem nunca aplicou quanto como rota de recuperação.
  if (state !== 'no_application') {
    return (
      <div className="min-h-screen px-4 py-10 flex flex-col">
        <div className="mx-auto w-full max-w-lg space-y-8">{header}</div>
        <div className="flex-1 flex items-center justify-center">
          {state === 'loading' && <PageLoader />}
          {state === 'pending' && <PendingScreen />}
          {state === 'rejected' && <RejectedScreen />}
          {state === 'suspended' && <SuspendedScreen suspendedUntil={access?.suspendedUntil ?? null} />}
          {state === 'removed' && <RemovedScreen />}
          {state === 'error' && <BoosterStatusErrorScreen />}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-8">
        {header}

        <div>
          <p className="section-label mb-3">Candidatura</p>
          <h1 className="text-3xl font-bold text-ink">Candidatar-se como booster</h1>
          <p className="text-sm text-ink-secondary mt-2">
            Preencha os dados abaixo. A mesma candidatura será analisada pela equipe antes da liberação dos pedidos.
          </p>
        </div>

        <BoosterApplicationForm
          submitLabel="Enviar Candidatura"
          onEnsureBoosterRole={startBoosterApplication}
          onSuccess={handleApplicationSaved}
        />
      </div>
    </div>
  )
}
