import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { SuspensePage, RequireAuth } from './routeGuards'

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
const BoostersPage               = lazy(() => import('@/features/public/pages/BoostersPage').then(m => ({ default: m.BoostersPage })))
const BoosterPublicProfilePage   = lazy(() => import('@/features/public/pages/BoosterPublicProfilePage').then(m => ({ default: m.BoosterPublicProfilePage })))
const TermsPage                   = lazy(() => import('@/features/public/pages/LegalPages').then(m => ({ default: m.TermsPage })))
const PrivacyPage                 = lazy(() => import('@/features/public/pages/LegalPages').then(m => ({ default: m.PrivacyPage })))

// Auth pages
const LoginPage          = lazy(() => import('@/features/auth/LoginPage').then(m => ({ default: m.LoginPage })))

// Customer pages
const CustomerDashboard = lazy(() => import('@/features/customer/pages/Dashboard').then(m => ({ default: m.CustomerDashboard })))
const OrderBuilderPage  = lazy(() => import('@/features/customer/pages/OrderBuilder').then(m => ({ default: m.OrderBuilderPage })))
const OrderDetailPage   = lazy(() => import('@/features/customer/pages/OrderDetail').then(m => ({ default: m.OrderDetailPage })))
const OrderHistoryPage  = lazy(() => import('@/features/customer/pages/OrderHistory').then(m => ({ default: m.OrderHistoryPage })))

// Booster pages
const BoosterDashboard    = lazy(() => import('@/features/booster/pages/Dashboard').then(m => ({ default: m.BoosterDashboard })))
const AvailableJobsPage   = lazy(() => import('@/features/booster/pages/AvailableJobs').then(m => ({ default: m.AvailableJobsPage })))
const JobDetailPage       = lazy(() => import('@/features/booster/pages/JobDetail').then(m => ({ default: m.JobDetailPage })))
const BoosterOrdersPage   = lazy(() => import('@/features/booster/pages/Orders').then(m => ({ default: m.BoosterOrdersPage })))
const BoosterAccountsPage = lazy(() => import('@/features/booster/pages/Accounts').then(m => ({ default: m.BoosterAccountsPage })))
const BoosterPaymentsPage = lazy(() => import('@/features/booster/pages/Payments').then(m => ({ default: m.BoosterPaymentsPage })))
const BoosterServicesPage = lazy(() => import('@/features/booster/pages/Services').then(m => ({ default: m.BoosterServicesPage })))

// Admin pages
const AdminOverview       = lazy(() => import('@/features/admin/pages/Overview').then(m => ({ default: m.AdminOverview })))
const AdminOrdersPage     = lazy(() => import('@/features/admin/pages/Orders').then(m => ({ default: m.AdminOrdersPage })))
const AdminOrderDetailPage = lazy(() => import('@/features/admin/pages/OrderDetail').then(m => ({ default: m.AdminOrderDetailPage })))
const AdminBoostersPage   = lazy(() => import('@/features/admin/pages/Boosters').then(m => ({ default: m.AdminBoostersPage })))
const AdminBoosterDetailPage = lazy(() => import('@/features/admin/pages/BoosterDetail').then(m => ({ default: m.AdminBoosterDetailPage })))
const AdminCustomersPage  = lazy(() => import('@/features/admin/pages/Customers').then(m => ({ default: m.AdminCustomersPage })))
const AdminCustomerDetailPage = lazy(() => import('@/features/admin/pages/CustomerDetail').then(m => ({ default: m.AdminCustomerDetailPage })))
const AdminPaymentsPage   = lazy(() => import('@/features/admin/pages/Payments').then(m => ({ default: m.AdminPaymentsPage })))
const AdminPayoutsPage    = lazy(() => import('@/features/admin/pages/Payouts').then(m => ({ default: m.AdminPayoutsPage })))
const AdminRefundsPage    = lazy(() => import('@/features/admin/pages/Refunds').then(m => ({ default: m.AdminRefundsPage })))
const AdminDropsPage      = lazy(() => import('@/features/admin/pages/Drops').then(m => ({ default: m.AdminDropsPage })))
const AdminDuoAccountsPage = lazy(() => import('@/features/admin/pages/DuoAccounts').then(m => ({ default: m.AdminDuoAccountsPage })))

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
      { path: '/terms',    element: <SuspensePage><TermsPage /></SuspensePage> },
      { path: '/privacy',  element: <SuspensePage><PrivacyPage /></SuspensePage> },
      { path: '/boosters',     element: <SuspensePage><BoostersPage /></SuspensePage> },
      { path: '/boosters/:displayName', element: <SuspensePage><BoosterPublicProfilePage /></SuspensePage> },
    ],
  },

  // Booster signup transition — any authenticated user, no layout
  {
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
  { path: '/login',    element: <SuspensePage><LoginPage /></SuspensePage> },
  { path: '/register', element: <Navigate to="/login" replace /> },

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
    element: <RequireAuth role="booster" />,
    children: [
      {
        element: <BoosterLayout />,
        children: [
          { path: '/booster',             element: <SuspensePage><BoosterDashboard /></SuspensePage> },
          { path: '/booster/jobs',        element: <SuspensePage><AvailableJobsPage /></SuspensePage> },
          { path: '/booster/jobs/:id',    element: <SuspensePage><JobDetailPage /></SuspensePage> },
          { path: '/booster/orders',      element: <SuspensePage><BoosterOrdersPage /></SuspensePage> },
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
          { path: '/admin/reviews',      element: <Navigate to="/admin" replace /> },
          { path: '/admin/audit',        element: <Navigate to="/admin" replace /> },
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
  { path: '*', element: <Navigate to="/" replace /> },
])
