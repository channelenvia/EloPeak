import { lazy, type ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RouteError } from '@/components/RouteError'
import { useAuthStore } from '@/stores/authStore'
import { SuspensePage, RequireAuth } from './routeGuards'

// Páginas lazy agrupadas por papel: depois do login (ou no idle, pra visitante)
// os chunks do papel são baixados em segundo plano, então trocar de aba no
// painel não espera download nem mostra o PageLoader.
type Group = 'pub' | 'cus' | 'boo' | 'adm'
type Loader = () => Promise<{ default: ComponentType }>
const loaders: Record<Group, Loader[]> = { pub: [], cus: [], boo: [], adm: [] }
const grouped = (group: Group) => (loader: Loader) => {
  loaders[group].push(loader)
  return lazy(loader)
}
const pub = grouped('pub')
const cus = grouped('cus')
const boo = grouped('boo')
const adm = grouped('adm')

function preloadGroup(group: Group) {
  const run = () => { for (const load of loaders[group]) void load().catch(() => {}) }
  if ('requestIdleCallback' in window) window.requestIdleCallback(run)
  else setTimeout(run, 1500)
}

let preloadedRole: string | undefined
function preloadForRole(role: string | undefined) {
  if (role === preloadedRole) return
  preloadedRole = role
  preloadGroup(role === 'customer' ? 'cus' : role === 'booster' ? 'boo' : role === 'admin' ? 'adm' : 'pub')
}

// Layouts (eager — pequenos, reutilizados em toda a sessão)
import { PublicLayout } from '@/features/public/PublicLayout'
import { CustomerLayout } from '@/features/customer/CustomerLayout'
import { BoosterLayout } from '@/features/booster/BoosterLayout'
import { AdminLayout } from '@/features/admin/AdminLayout'

// Public pages
const NotFoundPage     = pub(() => import('@/features/public/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })))
const HomePage         = pub(() => import('@/features/public/pages/HomePage').then(m => ({ default: m.HomePage })))
const ServicesPage     = pub(() => import('@/features/public/pages/ServicesPage').then(m => ({ default: m.ServicesPage })))
const PricingPage      = pub(() => import('@/features/public/pages/PricingPage').then(m => ({ default: m.PricingPage })))
const SecurityPage     = pub(() => import('@/features/public/pages/SecurityPage').then(m => ({ default: m.SecurityPage })))
const FAQPage          = pub(() => import('@/features/public/pages/FAQPage').then(m => ({ default: m.FAQPage })))
const BoosterApplyPage = pub(() => import('@/features/public/pages/BoosterApplyPage').then(m => ({ default: m.BoosterApplyPage })))
const BoostersPage               = pub(() => import('@/features/public/pages/BoostersPage').then(m => ({ default: m.BoostersPage })))
const BoosterPublicProfilePage   = pub(() => import('@/features/public/pages/BoosterPublicProfilePage').then(m => ({ default: m.BoosterPublicProfilePage })))
const TermsPage                   = pub(() => import('@/features/public/pages/LegalPages').then(m => ({ default: m.TermsPage })))
const PrivacyPage                 = pub(() => import('@/features/public/pages/LegalPages').then(m => ({ default: m.PrivacyPage })))

// Auth pages
const LoginPage          = pub(() => import('@/features/auth/LoginPage').then(m => ({ default: m.LoginPage })))

// Customer pages
const CustomerDashboard = cus(() => import('@/features/customer/pages/Dashboard').then(m => ({ default: m.CustomerDashboard })))
const OrderBuilderPage  = cus(() => import('@/features/customer/pages/OrderBuilder').then(m => ({ default: m.OrderBuilderPage })))
const OrderDetailPage   = cus(() => import('@/features/customer/pages/OrderDetail').then(m => ({ default: m.OrderDetailPage })))
const OrderHistoryPage  = cus(() => import('@/features/customer/pages/OrderHistory').then(m => ({ default: m.OrderHistoryPage })))

// Booster pages
const BoosterDashboard    = boo(() => import('@/features/booster/pages/Dashboard').then(m => ({ default: m.BoosterDashboard })))
const AvailableJobsPage   = boo(() => import('@/features/booster/pages/AvailableJobs').then(m => ({ default: m.AvailableJobsPage })))
const JobDetailPage       = boo(() => import('@/features/booster/pages/JobDetail').then(m => ({ default: m.JobDetailPage })))
const BoosterOrdersPage   = boo(() => import('@/features/booster/pages/Orders').then(m => ({ default: m.BoosterOrdersPage })))
const BoosterAccountsPage = boo(() => import('@/features/booster/pages/Accounts').then(m => ({ default: m.BoosterAccountsPage })))
const BoosterPaymentsPage = boo(() => import('@/features/booster/pages/Payments').then(m => ({ default: m.BoosterPaymentsPage })))
const BoosterServicesPage = boo(() => import('@/features/booster/pages/Services').then(m => ({ default: m.BoosterServicesPage })))

// Admin pages
const AdminOverview       = adm(() => import('@/features/admin/pages/Overview').then(m => ({ default: m.AdminOverview })))
const AdminOrdersPage     = adm(() => import('@/features/admin/pages/Orders').then(m => ({ default: m.AdminOrdersPage })))
const AdminOrderDetailPage = adm(() => import('@/features/admin/pages/OrderDetail').then(m => ({ default: m.AdminOrderDetailPage })))
const AdminBoostersPage   = adm(() => import('@/features/admin/pages/Boosters').then(m => ({ default: m.AdminBoostersPage })))
const AdminBoosterDetailPage = adm(() => import('@/features/admin/pages/BoosterDetail').then(m => ({ default: m.AdminBoosterDetailPage })))
const AdminCustomersPage  = adm(() => import('@/features/admin/pages/Customers').then(m => ({ default: m.AdminCustomersPage })))
const AdminCustomerDetailPage = adm(() => import('@/features/admin/pages/CustomerDetail').then(m => ({ default: m.AdminCustomerDetailPage })))
const AdminPaymentsPage   = adm(() => import('@/features/admin/pages/Payments').then(m => ({ default: m.AdminPaymentsPage })))
const AdminPayoutsPage    = adm(() => import('@/features/admin/pages/Payouts').then(m => ({ default: m.AdminPayoutsPage })))
const AdminRefundsPage    = adm(() => import('@/features/admin/pages/Refunds').then(m => ({ default: m.AdminRefundsPage })))
const AdminDropsPage      = adm(() => import('@/features/admin/pages/Drops').then(m => ({ default: m.AdminDropsPage })))
const AdminDuoAccountsPage = adm(() => import('@/features/admin/pages/DuoAccounts').then(m => ({ default: m.AdminDuoAccountsPage })))
const AdminReviewsPage    = adm(() => import('@/features/admin/pages/Reviews').then(m => ({ default: m.AdminReviewsPage })))
const AdminAuditLogPage   = adm(() => import('@/features/admin/pages/AuditLog').then(m => ({ default: m.AdminAuditLogPage })))

export const router = createBrowserRouter([
  // Public routes
  {
    errorElement: <RouteError />,
    element: <PublicLayout />,
    children: [
      { path: '/',         element: <SuspensePage><HomePage /></SuspensePage> },
      { path: '/services', element: <SuspensePage><ServicesPage /></SuspensePage> },
      { path: '/pricing',  element: <SuspensePage><PricingPage /></SuspensePage> },
      { path: '/security', element: <SuspensePage><SecurityPage /></SuspensePage> },
      { path: '/faq',      element: <SuspensePage><FAQPage /></SuspensePage> },
      { path: '/terms',    element: <SuspensePage><TermsPage /></SuspensePage> },
      { path: '/privacy',  element: <SuspensePage><PrivacyPage /></SuspensePage> },
      { path: '/boosters',     element: <SuspensePage><BoostersPage /></SuspensePage> },
      { path: '/boosters/:displayName', element: <SuspensePage><BoosterPublicProfilePage /></SuspensePage> },
    ],
  },

  // Booster signup transition — any authenticated user, no layout
  {
    errorElement: <RouteError />,
    element: <RequireAuth />,
    children: [
      { path: '/apply', element: <SuspensePage><BoosterApplyPage /></SuspensePage> },
    ],
  },

  // Login/criar conta/aceite de termos — uma tela só, para qualquer estado
  // de autenticação (login é exclusivamente via Discord OAuth, não existe
  // fluxo de senha). Nunca fica atrás de RequireGuest: a mesma tela precisa
  // continuar acessível logo após o retorno do OAuth, já autenticado, para
  // mostrar os checkboxes de termos e o botão de painel.
  { errorElement: <RouteError />, path: '/login',    element: <SuspensePage><LoginPage /></SuspensePage> },
  { errorElement: <RouteError />, path: '/register', element: <Navigate to="/login" replace /> },

  // Customer routes
  {
    errorElement: <RouteError />,
    element: <RequireAuth role="customer" />,
    children: [
      {
        element: <CustomerLayout />,
        children: [
          { path: '/dashboard',    element: <SuspensePage><CustomerDashboard /></SuspensePage> },
          { path: '/orders/new',   element: <SuspensePage><OrderBuilderPage /></SuspensePage> },
          { path: '/orders/:id',   element: <SuspensePage><OrderDetailPage /></SuspensePage> },
          { path: '/orders',       element: <SuspensePage><OrderHistoryPage /></SuspensePage> },
          // Rotas antigas — mantidas como redirect para não quebrar links/bookmarks existentes.
          // /payments foi removida: detalhes de pagamento agora vivem em /orders/:id (ver pedido).
          { path: '/payments',     element: <Navigate to="/orders" replace /> },
          { path: '/support',      element: <Navigate to="/dashboard" replace /> },
          { path: '/support/:id',  element: <Navigate to="/dashboard" replace /> },
          { path: '/profile',      element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },

  // Booster routes
  {
    errorElement: <RouteError />,
    element: <RequireAuth role="booster" />,
    children: [
      {
        element: <BoosterLayout />,
        children: [
          { path: '/booster',             element: <SuspensePage><BoosterDashboard /></SuspensePage> },
          { path: '/booster/jobs',        element: <SuspensePage><AvailableJobsPage /></SuspensePage> },
          { path: '/booster/orders',      element: <SuspensePage><BoosterOrdersPage /></SuspensePage> },
          // JobDetailPage é sempre "ver um pedido meu" (aceito/concluído) --
          // os cards do pool em /booster/jobs são aceitar/recusar inline, sem
          // link pra detalhe. Fica sob /booster/orders/:id de propósito, pra
          // a sidebar (que ativa por prefixo de rota) marcar "Pedidos", não
          // "Jobs", quando o booster clica num pedido vindo dessa aba.
          { path: '/booster/orders/:id',  element: <SuspensePage><JobDetailPage /></SuspensePage> },
          { path: '/booster/accounts',    element: <SuspensePage><BoosterAccountsPage /></SuspensePage> },
          { path: '/booster/services',    element: <SuspensePage><BoosterServicesPage /></SuspensePage> },
          { path: '/booster/payments',    element: <SuspensePage><BoosterPaymentsPage /></SuspensePage> },
          // Rotas antigas — mantidas como redirect para não quebrar links/bookmarks existentes.
          { path: '/booster/completed',   element: <Navigate to="/booster/orders" replace /> },
          { path: '/booster/earnings',    element: <Navigate to="/booster/payments" replace /> },
          { path: '/booster/profile',     element: <Navigate to="/booster/services" replace /> },
          { path: '/booster/onboarding',  element: <Navigate to="/apply?booster=1" replace /> },
        ],
      },
    ],
  },

  // Admin routes
  {
    errorElement: <RouteError />,
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
          { path: '/admin/customers/:id', element: <SuspensePage><AdminCustomerDetailPage /></SuspensePage> },
          { path: '/admin/payments',     element: <SuspensePage><AdminPaymentsPage /></SuspensePage> },
          { path: '/admin/payouts',      element: <SuspensePage><AdminPayoutsPage /></SuspensePage> },
          { path: '/admin/refunds',      element: <SuspensePage><AdminRefundsPage /></SuspensePage> },
          { path: '/admin/audit',        element: <SuspensePage><AdminAuditLogPage /></SuspensePage> },
          { path: '/admin/reviews',      element: <SuspensePage><AdminReviewsPage /></SuspensePage> },
          // Catálogo de serviços/preços passou a ser gerido só pelo sistema (fórmulas
          // em shared/pricing.ts + migrations) — sem UI de admin dedicada.
          { path: '/admin/services',     element: <Navigate to="/admin" replace /> },
          { path: '/admin/boost-config', element: <Navigate to="/admin" replace /> },
          { path: '/admin/drops',        element: <SuspensePage><AdminDropsPage /></SuspensePage> },
          { path: '/admin/duo-accounts', element: <SuspensePage><AdminDuoAccountsPage /></SuspensePage> },
          // Rota antiga — mantida como redirect para não quebrar links/bookmarks existentes.
          { path: '/admin/profile',      element: <Navigate to="/admin" replace /> },
        ],
      },
    ],
  },

  // Fallback
  { path: '*', element: <SuspensePage><NotFoundPage /></SuspensePage> },
])

useAuthStore.subscribe((s) => { if (s.isInitialized && !s.isLoading) preloadForRole(s.profile?.role) })