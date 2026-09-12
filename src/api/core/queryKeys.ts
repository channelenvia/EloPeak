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
    customerTabCounts: (customerId: string) => ['orders', 'customer-tab-counts', customerId] as const,
    boosterTabCounts: (boosterId: string) => ['orders', 'booster-tab-counts', boosterId] as const,
    adminTabCounts: () => ['orders', 'admin-tab-counts'] as const,
    detail: (orderId: string) => ['orders', 'detail', orderId] as const,
    state: (orderId: string) => ['orders', 'state', orderId] as const,
    duoPartnerRiotId: (orderId: string) => ['orders', 'duo-partner-riot-id', orderId] as const,
    duoAccountHistory: (orderId: string) => ['orders', 'duo-account-history', orderId] as const,
    customerNickname: (orderId: string) => ['orders', 'customer-nickname', orderId] as const,
    paidAmount: (orderId: string) => ['orders', 'paid-amount', orderId] as const,
    availableJobs: () => ['orders', 'available-jobs'] as const,
    boosterActive: (boosterId: string) => ['orders', 'booster-active', boosterId] as const,
    boosterCompletedSince: (boosterId: string, sinceIso: string) => ['orders', 'booster-completed-since', boosterId, sinceIso] as const,
    chat: (orderId: string) => ['orders', 'chat', orderId] as const,
    chatMentionTargets: (orderId: string) => ['orders', 'chat-mention-targets', orderId] as const,
    matches: (orderId: string) => ['orders', 'matches', orderId] as const,
    boosterDuoMatches: (orderId: string) => ['orders', 'booster-duo-matches', orderId] as const,
    topics: (orderId: string) => ['orders', 'topics', orderId] as const,
    latestRankVerification: (orderId: string) => ['orders', 'detail', orderId, 'rank-verifications', 'latest'] as const,
    history: (orderId: string) => ['orders', 'detail', orderId, 'history'] as const,
    dropRequest: (orderId: string) => ['orders', 'detail', orderId, 'drop-request'] as const,
  },
  boosters: {
    all: ['boosters'] as const,
    profile: (userId: string) => ['boosters', 'profile', userId] as const,
    publicProfile: (boosterId: string) => ['boosters', 'public-profile', boosterId] as const,
    publicList: (filters?: Record<string, unknown>) => ['boosters', 'public-list', filters ?? {}] as const,
    top: (limit?: number) => (limit != null ? ['boosters', 'top', limit] as const : ['boosters', 'top'] as const),
    status: (userId: string) => ['boosters', 'status', userId] as const,
    services: (boosterId: string) => ['boosters', 'services', boosterId] as const,
    adminList: (filters?: Record<string, unknown>) => ['boosters', 'admin-list', filters ?? {}] as const,
    adminDetail: (boosterId: string) => ['boosters', 'admin-detail', boosterId] as const,
    assignedProfile: (boosterUserId: string) => ['boosters', 'assigned-profile', boosterUserId] as const,
    ownDisplayName: (userId: string) => ['boosters', 'own-display-name', userId] as const,
    ownTop3Status: (userId: string) => ['boosters', 'own-top3-status', userId] as const,
    performance: (boosterUserIds: string[]) => ['boosters', 'performance', [...boosterUserIds].sort()] as const,
    performanceByRank: (boosterUserId: string) => ['boosters', 'performance-by-rank', boosterUserId] as const,
    names: (boosterUserIds: string[]) => ['boosters', 'names', [...boosterUserIds].sort()] as const,
    slotEligibility: (userId: string) => ['boosters', 'slot-eligibility', userId] as const,
    ownFullProfile: (userId: string) => ['boosters', 'own-full-profile', userId] as const,
    adminNotes: () => ['boosters', 'admin-notes'] as const,
    // Consolida a disponibilidade de slot num único namespace -- antes,
    // useBoosterSlotInfo (um booster) e useBoostersWithSlots (lista) viviam
    // em chaves ad hoc incompatíveis (['booster-slots', id] e
    // ['boosters','with-slots']), então toda mutation que muda uso de slot
    // (aceitar pedido, reatribuir, atribuir-durante-revisão) tinha que
    // lembrar de invalidar as duas na mão. Uma mutation nova invalidando só
    // `slots()` (sem argumento) agora cobre as duas por prefixo.
    slots: (boosterId?: string) => (boosterId ? ['boosters', 'slots', boosterId] as const : ['boosters', 'slots'] as const),
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
    reservationHistory: (accountId: string) => ['duo-accounts', 'reservation-history', accountId] as const,
  },
  coaching: {
    packages: (filters?: Record<string, unknown>) => ['coaching', 'packages', filters ?? {}] as const,
    boosterService: (id: string) => ['coaching', 'booster-service', id] as const,
    boosterServicesByIds: (ids: string[]) => ['coaching', 'booster-services', [...ids].sort()] as const,
    boosterInfo: (boosterIds: string[]) => ['coaching', 'booster-info', [...boosterIds].sort()] as const,
  },
  notifications: {
    list: (userId: string) => ['notifications', 'list', userId] as const,
    unreadCount: (userId: string) => ['notifications', 'unread-count', userId] as const,
  },
  customers: {
    profile: (userId: string) => ['customers', 'profile', userId] as const,
    adminList: (filters?: Record<string, unknown>) => ['customers', 'admin-list', filters ?? {}] as const,
    adminDetail: (customerId: string) => ['customers', 'admin-detail', customerId] as const,
    dashboardStats: (customerId: string) => ['customers', 'profile', customerId, 'dashboard-stats'] as const,
    adminOrders: (customerId: string) => ['customers', 'admin-detail', customerId, 'orders'] as const,
    adminReviews: (customerId: string) => ['customers', 'admin-detail', customerId, 'reviews'] as const,
  },
  admin: {
    dashboardStats: () => ['admin', 'dashboard-stats'] as const,
    refunds: (filters?: Record<string, unknown>) => ['admin', 'refunds', filters ?? {}] as const,
    drops: (filters?: Record<string, unknown>) => ['admin', 'drops', filters ?? {}] as const,
    payments: () => ['admin', 'payments'] as const,
    pendingReview: () => ['admin', 'pending-review'] as const,
    reviewCases: () => ['admin', 'review-cases'] as const,
    profileUsername: (profileId: string) => ['admin', 'profile-username', profileId] as const,
    profileUsernames: (ids: string[]) => ['admin', 'profile-usernames', [...ids].sort()] as const,
    orderParties: (customerId?: string, assignedBoosterId?: string | null, preferredBoosterId?: string | null) =>
      ['admin', 'order-parties', customerId, assignedBoosterId, preferredBoosterId] as const,
    auditLogs: () => ['admin', 'audit-logs'] as const,
  },
  catalog: {
    gameId: (slug: string) => ['catalog', 'game-id', slug] as const,
    serviceId: (gameId: string, serviceType: string) => ['catalog', 'service-id', gameId, serviceType] as const,
    masterPlusPrice: (currentTier: string, targetTier: string, queueType: string, boostMode: string, pdlFrom: number) =>
      ['catalog', 'master-plus-price', currentTier, targetTier, queueType, boostMode, pdlFrom] as const,
  },
  reviews: {
    public: (limit: number) => ['reviews', 'public', limit] as const,
    forBooster: (boosterId: string) => ['reviews', 'booster', boosterId] as const,
    own: (orderId: string) => ['reviews', 'own', orderId] as const,
  },
} as const
