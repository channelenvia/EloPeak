import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { PageLoader } from '@/components/ui/Spinner'
import { hasAcceptedLegal } from '@/lib/legal'

export function SuspensePage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

export function RequireAuth({ role }: { role?: 'customer' | 'booster' | 'admin' }) {
  const { isAuthenticated, profile, isLoading, isInitialized } = useAuthStore()
  const location = useLocation()

  if (!isInitialized || isLoading) return <PageLoader />
  if (!isAuthenticated()) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  if (!profile) return <PageLoader />

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

  return <Outlet />
}
