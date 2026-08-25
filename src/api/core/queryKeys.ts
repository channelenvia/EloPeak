// Fábrica central de query keys. Antes desta camada cada página inventava
// sua própria chave inline (ex.: ['available-jobs'], sem escopo por usuário
// em vários casos) -- centralizar aqui torna invalidação previsível e evita
// duas telas usando chaves incompatíveis pro mesmo dado.
export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    customerList: (customerId: string, filters?: Record<string, unknown>) =>
      ['orders', 'customer', customerId, filters ?? {}] as const,
    boosterList: (boosterId: string, filters?: Record<string, unknown>) =>
      ['orders', 'booster', boosterId, filters ?? {}] as const,
    adminList: (filters?: Record<string, unknown>) =>
      ['orders', 'admin', filters ?? {}] as const,
    detail: (orderId: string) => ['orders', 'detail', orderId] as const,
    state: (orderId: string) => ['orders', 'state', orderId] as const,
    duoPartnerRiotId: (orderId: string) => ['orders', 'duo-partner-riot-id', orderId] as const,
    duoAccountHistory: (orderId: string) => ['orders', 'duo-account-history', orderId] as const,
    customerNickname: (orderId: string) => ['orders', 'customer-nickname', orderId] as const,
    availableJobs: () => ['orders', 'available-jobs'] as const,
    chat: (orderId: string) => ['orders', 'chat', orderId] as const,
    chatMentionTargets: (orderId: string) => ['orders', 'chat-mention-targets', orderId] as const,
    matches: (orderId: string) => ['orders', 'matches', orderId] as const,
    boosterDuoMatches: (orderId: string) => ['orders', 'booster-duo-matches', orderId] as const,
    topics: (orderId: string) => ['orders', 'topics', orderId] as const,
    latestRankVerification: (orderId: string) => ['orders', 'detail', orderId, 'rank-verifications', 'latest'] as const,
  },
  boosters: {
    profile: (userId: string) => ['boosters', 'profile', userId] as const,
    publicProfile: (boosterId: string) => ['boosters', 'public-profile', boosterId] as const,
    publicList: (filters?: Record<string, unknown>) => ['boosters', 'public-list', filters ?? {}] as const,
    top: () => ['boosters', 'top'] as const,
    status: (userId: string) => ['boosters', 'status', userId] as const,
    services: (boosterId: string) => ['boosters', 'services', boosterId] as const,
    adminList: (filters?: Record<string, unknown>) => ['boosters', 'admin-list', filters ?? {}] as const,
    adminDetail: (boosterId: string) => ['boosters', 'admin-detail', boosterId] as const,
  },
  payouts: {
    totals: (boosterId: string) => ['payouts', 'totals', boosterId] as const,
    requests: (boosterId: string) => ['payouts', 'requests', boosterId] as const,
    breakdown: (requestId: string) => ['payouts', 'breakdown', requestId] as const,
    adminList: (filters?: Record<string, unknown>) => ['payouts', 'admin-list', filters ?? {}] as const,
  },
  duoAccounts: {
    list: () => ['duo-accounts', 'list'] as const,
    adminList: () => ['duo-accounts', 'admin-list'] as const,
  },
  coaching: {
    packages: (filters?: Record<string, unknown>) => ['coaching', 'packages', filters ?? {}] as const,
    boosterService: (id: string) => ['coaching', 'booster-service', id] as const,
  },
  notifications: {
    list: (userId: string) => ['notifications', 'list', userId] as const,
    unreadCount: (userId: string) => ['notifications', 'unread-count', userId] as const,
  },
  customers: {
    profile: (userId: string) => ['customers', 'profile', userId] as const,
    adminList: (filters?: Record<string, unknown>) => ['customers', 'admin-list', filters ?? {}] as const,
    adminDetail: (customerId: string) => ['customers', 'admin-detail', customerId] as const,
  },
  admin: {
    dashboardStats: () => ['admin', 'dashboard-stats'] as const,
    refunds: (filters?: Record<string, unknown>) => ['admin', 'refunds', filters ?? {}] as const,
    drops: (filters?: Record<string, unknown>) => ['admin', 'drops', filters ?? {}] as const,
    payments: () => ['admin', 'payments'] as const,
  },
  reviews: {
    public: (limit: number) => ['reviews', 'public', limit] as const,
    forBooster: (boosterId: string) => ['reviews', 'booster', boosterId] as const,
    own: (orderId: string) => ['reviews', 'own', orderId] as const,
  },
} as const
