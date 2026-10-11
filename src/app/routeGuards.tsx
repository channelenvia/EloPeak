import { Suspense, useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { PageLoader } from '@/components/ui/Spinner'
import { hasAcceptedLegal } from '@/lib/legal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { signOut } from '@/lib/supabase'

// Volta pro topo em toda navegação -- sem isso, ao trocar de página o scroll
// ficava na mesma posição da tela anterior (comportamento padrão de qualquer
// app real é começar do topo). SuspensePage envolve TODA rota de página (ver
// router.tsx), então este é o único lugar que precisa disso -- não duplicado
// por layout. Reseta os dois tipos de contêiner de scroll que o app usa:
// window (páginas públicas, que rolam o body normalmente) e o <main
// overflow-auto> interno dos painéis logados (cliente/booster/admin ficam
// h-screen overflow-hidden, então o body nunca rola).
function useScrollToTopOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [pathname])
}

export function SuspensePage({ children }: { children: React.ReactNode }) {
  useScrollToTopOnNavigate()
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// Sessao ativa mas o perfil nao carregou (5xx/RLS transiente): retry ou sair, nunca loader eterno (H-6).
export function ProfileLoadError() {
  return (
    <div className="flex flex-col items-center">
      <EmptyState
        title="Não foi possível carregar sua conta"
        description="Houve uma falha de conexão ao carregar seu perfil. Tente novamente ou saia e entre de novo."
        action={{ label: 'Tentar de novo', onClick: () => window.location.reload() }}
      />
      <Button variant="ghost" onClick={() => { void signOut() }}>Sair</Button>
    </div>
  )
}

export function RequireAuth({ role }: { role?: 'customer' | 'booster' | 'admin' }) {
  const { isAuthenticated, profile, profileError, isLoading, isInitialized } = useAuthStore()
  const location = useLocation()

  if (!isInitialized || isLoading) return <PageLoader />
  if (!isAuthenticated()) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  if (!profile) return profileError ? <ProfileLoadError /> : <PageLoader />

  if (!hasAcceptedLegal(profile) && location.pathname !== '/login') {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  if (role && profile.role !== role) {
    const state = { accessDeniedReason: 'Você não tem acesso a essa área. Redirecionado para sua página.' }
    if (profile.role === 'admin') return <Navigate to="/admin" state={state} replace />
    if (profile.role === 'booster') return <Navigate to="/booster" state={state} replace />
    if (profile.role === 'customer') return <Navigate to="/dashboard" state={state} replace />
    return <Navigate to="/login" replace />
  }

  return (
    <>
      {/* Area autenticada nunca deve ser indexada (alem do Disallow do robots.txt). */}
      <Helmet><meta name="robots" content="noindex, nofollow" /></Helmet>
      <Outlet />
    </>
  )
}
