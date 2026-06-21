import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { PageLoader } from '@/components/ui/Spinner'

// Layouts (eager — pequenos, reutilizados em toda a sessão)
import { PublicLayout } from '@/features/public/PublicLayout'
import { CustomerLayout } from '@/features/customer/CustomerLayout'
import { BoosterLayout } from '@/features/booster/BoosterLayout'
import { AdminLayout } from '@/features/admin/AdminLayout'

// Public pages
const HomePage         = lazy(() => import('@/features/public/pages/HomePage').then(m => ({ default: m.HomePage })))
const ServicesPage     = lazy(() => import('@/features/public/pages/ServicesPage').then(m => ({ default: m.ServicesPage })))
const PricingPage      = lazy(() => import('@/features/public/pages/PricingPage').then(m => ({ default: m.PricingPage })))
const SecurityPage     = lazy(() => import('@/features/public/pages/SecurityPage').then(m => ({ default: m.SecurityPage })))
const FAQPage          = lazy(() => import('@/features/public/pages/FAQPage').then(m => ({ default: m.FAQPage })))
const BoosterApplyPage = lazy(() => import('@/features/public/pages/BoosterApplyPage').then(m => ({ default: m.BoosterApplyPage })))

// Auth pages
const LoginPage          = lazy(() => import('@/features/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage  = lazy(() => import('@/features/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })))

// Customer pages
const CustomerDashboard = lazy(() => import('@/features/customer/pages/Dashboard').then(m => ({ default: m.CustomerDashboard })))
const OrderBuilderPage  = lazy(() => import('@/features/customer/pages/OrderBuilder').then(m => ({ default: m.OrderBuilderPage })))
const OrderDetailPage   = lazy(() => import('@/features/customer/pages/OrderDetail').then(m => ({ default: m.OrderDetailPage })))
const OrderHistoryPage  = lazy(() => import('@/features/customer/pages/OrderHistory').then(m => ({ default: m.OrderHistoryPage })))
const CustomerProfilePage = lazy(() => import('@/features/customer/pages/Profile').then(m => ({ default: m.CustomerProfilePage })))
const SupportPage       = lazy(() => import('@/features/customer/pages/Support').then(m => ({ default: m.SupportPage })))
const TicketDetailPage  = lazy(() => import('@/features/customer/pages/TicketDetail').then(m => ({ default: m.TicketDetailPage })))

// Booster pages
const BoosterDashboard    = lazy(() => import('@/features/booster/pages/Dashboard').then(m => ({ default: m.BoosterDashboard })))
const AvailableJobsPage   = lazy(() => import('@/features/booster/pages/AvailableJobs').then(m => ({ default: m.AvailableJobsPage })))
const JobDetailPage       = lazy(() => import('@/features/booster/pages/JobDetail').then(m => ({ default: m.JobDetailPage })))
const BoosterEarningsPage = lazy(() => import('@/features/booster/pages/Earnings').then(m => ({ default: m.BoosterEarningsPage })))
const BoosterProfilePage  = lazy(() => import('@/features/booster/pages/Profile').then(m => ({ default: m.BoosterProfilePage })))
const BoosterOnboardingPage = lazy(() => import('@/features/booster/pages/Onboarding').then(m => ({ default: m.BoosterOnboardingPage })))

// Admin pages
const AdminOverview       = lazy(() => import('@/features/admin/pages/Overview').then(m => ({ default: m.AdminOverview })))
const AdminOrdersPage     = lazy(() => import('@/features/admin/pages/Orders').then(m => ({ default: m.AdminOrdersPage })))
const AdminOrderDetailPage = lazy(() => import('@/features/admin/pages/OrderDetail').then(m => ({ default: m.AdminOrderDetailPage })))
const AdminBoostersPage   = lazy(() => import('@/features/admin/pages/Boosters').then(m => ({ default: m.AdminBoostersPage })))
const AdminBoosterDetailPage = lazy(() => import('@/features/admin/pages/BoosterDetail').then(m => ({ default: m.AdminBoosterDetailPage })))
const AdminCustomersPage  = lazy(() => import('@/features/admin/pages/Customers').then(m => ({ default: m.AdminCustomersPage })))
const AdminPaymentsPage   = lazy(() => import('@/features/admin/pages/Payments').then(m => ({ default: m.AdminPaymentsPage })))
const AdminRefundsPage    = lazy(() => import('@/features/admin/pages/Refunds').then(m => ({ default: m.AdminRefundsPage })))
const AdminTicketsPage    = lazy(() => import('@/features/admin/pages/Tickets').then(m => ({ default: m.AdminTicketsPage })))
const AdminAuditPage      = lazy(() => import('@/features/admin/pages/AuditLogs').then(m => ({ default: m.AdminAuditPage })))
const AdminServicesPage   = lazy(() => import('@/features/admin/pages/Services').then(m => ({ default: m.AdminServicesPage })))
const AdminReviewsPage    = lazy(() => import('@/features/admin/pages/Reviews').then(m => ({ default: m.AdminReviewsPage })))
const AdminDropsPage      = lazy(() => import('@/features/admin/pages/Drops').then(m => ({ default: m.AdminDropsPage })))
const ReviewsPage         = lazy(() => import('@/features/public/pages/ReviewsPage').then(m => ({ default: m.ReviewsPage })))

function SuspensePage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// Route guards
function RequireAuth({ role }: { role?: 'customer' | 'booster' | 'admin' | 'support' }) {
  const { isAuthenticated, profile, isLoading, isInitialized } = useAuthStore()
  const location = useLocation()

  if (!isInitialized || isLoading) return <PageLoader />
  if (!isAuthenticated()) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  if (!profile) return <PageLoader />

  if (role && profile.role !== role) {
    if (profile.role === 'admin' || profile.role === 'support') return <Navigate to="/admin" replace />
    if (profile.role === 'booster') return <Navigate to="/booster" replace />
    if (profile.role === 'customer') return <Navigate to="/dashboard" replace />
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function RequireGuest() {
  const { isAuthenticated, profile, isLoading, isInitialized } = useAuthStore()

  if (!isInitialized || isLoading) return <PageLoader />
  if (isAuthenticated()) {
    if (profile?.role === 'admin' || profile?.role === 'support') return <Navigate to="/admin" replace />
    if (profile?.role === 'booster') return <Navigate to="/booster" replace />
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

export const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicLayout />,
    children: [
      { path: '/',         element: <SuspensePage><HomePage /></SuspensePage> },
      { path: '/services', element: <SuspensePage><ServicesPage /></SuspensePage> },
      { path: '/pricing',  element: <SuspensePage><PricingPage /></SuspensePage> },
      { path: '/security', element: <SuspensePage><SecurityPage /></SuspensePage> },
      { path: '/faq',      element: <SuspensePage><FAQPage /></SuspensePage> },
      { path: '/apply',    element: <SuspensePage><BoosterApplyPage /></SuspensePage> },
      { path: '/reviews',  element: <SuspensePage><ReviewsPage /></SuspensePage> },
    ],
  },

  // Auth routes (guest only)
  {
    element: <RequireGuest />,
    children: [
      { path: '/login',           element: <SuspensePage><LoginPage /></SuspensePage> },
      { path: '/register',        element: <Navigate to="/login" replace /> },
      { path: '/forgot-password', element: <SuspensePage><ForgotPasswordPage /></SuspensePage> },
      { path: '/reset-password',  element: <SuspensePage><ResetPasswordPage /></SuspensePage> },
    ],
  },

  // Customer routes
  {
    element: <RequireAuth role="customer" />,
    children: [
      {
        element: <CustomerLayout />,
        children: [
          { path: '/dashboard',    element: <SuspensePage><CustomerDashboard /></SuspensePage> },
          { path: '/orders/new',   element: <SuspensePage><OrderBuilderPage /></SuspensePage> },
          { path: '/orders/:id',   element: <SuspensePage><OrderDetailPage /></SuspensePage> },
          { path: '/orders',       element: <SuspensePage><OrderHistoryPage /></SuspensePage> },
          { path: '/support',      element: <SuspensePage><SupportPage /></SuspensePage> },
          { path: '/support/:id',  element: <SuspensePage><TicketDetailPage /></SuspensePage> },
          { path: '/profile',      element: <SuspensePage><CustomerProfilePage /></SuspensePage> },
        ],
      },
    ],
  },

  // Booster routes
  {
    element: <RequireAuth role="booster" />,
    children: [
      {
        element: <BoosterLayout />,
        children: [
          { path: '/booster',             element: <SuspensePage><BoosterDashboard /></SuspensePage> },
          { path: '/booster/jobs',        element: <SuspensePage><AvailableJobsPage /></SuspensePage> },
          { path: '/booster/jobs/:id',    element: <SuspensePage><JobDetailPage /></SuspensePage> },
          { path: '/booster/earnings',    element: <SuspensePage><BoosterEarningsPage /></SuspensePage> },
          { path: '/booster/profile',     element: <SuspensePage><BoosterProfilePage /></SuspensePage> },
          { path: '/booster/onboarding',  element: <SuspensePage><BoosterOnboardingPage /></SuspensePage> },
        ],
      },
    ],
  },

  // Admin routes
  {
    element: <RequireAuth role="admin" />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/admin',              element: <SuspensePage><AdminOverview /></SuspensePage> },
          { path: '/admin/orders',       element: <SuspensePage><AdminOrdersPage /></SuspensePage> },
          { path: '/admin/orders/:id',   element: <SuspensePage><AdminOrderDetailPage /></SuspensePage> },
          { path: '/admin/boosters',     element: <SuspensePage><AdminBoostersPage /></SuspensePage> },
          { path: '/admin/boosters/:id', element: <SuspensePage><AdminBoosterDetailPage /></SuspensePage> },
          { path: '/admin/customers',    element: <SuspensePage><AdminCustomersPage /></SuspensePage> },
          { path: '/admin/payments',     element: <SuspensePage><AdminPaymentsPage /></SuspensePage> },
          { path: '/admin/refunds',      element: <SuspensePage><AdminRefundsPage /></SuspensePage> },
          { path: '/admin/tickets',      element: <SuspensePage><AdminTicketsPage /></SuspensePage> },
          { path: '/admin/audit',        element: <SuspensePage><AdminAuditPage /></SuspensePage> },
          { path: '/admin/services',     element: <SuspensePage><AdminServicesPage /></SuspensePage> },
          { path: '/admin/reviews',      element: <SuspensePage><AdminReviewsPage /></SuspensePage> },
          { path: '/admin/drops',        element: <SuspensePage><AdminDropsPage /></SuspensePage> },
        ],
      },
    ],
  },

  // Fallback
  { path: '*', element: <Navigate to="/" replace /> },
])
