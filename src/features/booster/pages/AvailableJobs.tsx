import { useEffect, useMemo, useState } from 'react'
import { OrderCardHeader } from '@/components/order/OrderCardHeader'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { LiveDot } from '@/components/ui/Badge'
import { Badge } from '@/components/ui/Badge'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Lock, Sparkles } from 'lucide-react'
import { Button, Card, EmptyState, Pagination, SearchInput, Skeleton } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { timeAgo, boosterEarningsShare, getOrderServiceName, getOrderModeType } from '@/lib/utils'
import type { Order } from '@/types'
import { useCurrency } from '@/hooks/useCurrency'
import { useAvailableJobs, useBoosterSlotInfo, useAcceptBoostOrder } from '@/api/orders'
import { useBoosterServicesByIds } from '@/api/coaching'
import { useOwnBoosterSlotEligibility } from '@/api/boosters'
import { OrderSoundSettings } from '@/features/booster/components/OrderSoundSettings'
import { SlotIndicator, type SlotInfo } from '@/features/booster/components/SlotIndicator'
import { exclusiveBadge, exclusiveTimeLeft, isReassignedToMe, reassignedBadge } from '@/features/booster/utils/exclusiveJobBadges'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { CaptchaChallenge } from '@/components/captcha/CaptchaChallenge'

export function AvailableJobsPage() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const currency = useCurrency()

  const { data: boosterProfile } = useOwnBoosterSlotEligibility(profile?.id)

  // Real-time slot counts via DB function
  const { data: slotInfoRaw } = useBoosterSlotInfo(profile?.id, boosterProfile?.status === 'approved')
  const slotInfo: SlotInfo | undefined = slotInfoRaw ? {
    solo_count: slotInfoRaw.solo_count ?? 0,
    duo_count: slotInfoRaw.duo_count ?? 0,
    total_count: slotInfoRaw.total_count ?? 0,
    max_total: slotInfoRaw.max_total ?? 3,
    is_top3: slotInfoRaw.is_top3 ?? false,
    exclusive_slot_used: slotInfoRaw.exclusive_slot_used ?? false,
    max_exclusive: slotInfoRaw.max_exclusive ?? 1,
  } : undefined

  const { data: jobs, isLoading } = useAvailableJobs()

  // Pacotes de coaching referenciados pelos jobs da página -- 1 query em lote
  // (não 1 por card) pra enriquecer o card com título/descrição/duração.
  const coachingServiceIds = useMemo(() => Array.from(new Set(
    (jobs ?? [])
      .filter((j) => j.service_type === 'coaching' && j.booster_service_id)
      .map((j) => j.booster_service_id as string)
  )), [jobs])
  const { data: coachingPackages } = useBoosterServicesByIds(coachingServiceIds)
  const coachingPackageById = useMemo(
    () => new Map((coachingPackages ?? []).map((p) => [p.id, p])),
    [coachingPackages],
  )

  // Mensagens de erro já vêm traduzidas de src/api/orders/mutations.ts (ACCEPT_ORDER_MESSAGES).
  const acceptJobMutation = useAcceptBoostOrder()
  const acceptJob = {
    isPending: acceptJobMutation.isPending,
    isError: acceptJobMutation.isError,
    error: acceptJobMutation.error,
    mutate: (orderId: string) => acceptJobMutation.mutate(
      { orderId, boosterId: profile!.id },
      { onSuccess: () => navigate(`/booster/orders/${orderId}`) },
    ),
  }

  // "Aceitar" não dispara a mutation direto -- abre o captcha primeiro, e só
  // ao completar com sucesso é que o pedido de fato é aceito.
  const [captchaJobId, setCaptchaJobId] = useState<string | null>(null)

  const canAcceptJob = (job: Order): boolean => {
    if (!slotInfo) return false
    // Reatribuído pelo admin: accept_boost_order ignora tanto o limite de 3
    // slots normais quanto o slot exclusivo bônus pra esse caso (não foi o
    // booster que escolheu, é uma entrega direta) -- sempre aceitável.
    if (isReassignedToMe(job, profile?.id)) return true
    // Pedido exclusivo pra mim, ainda dentro da janela: usa o slot bônus
    // (máx 1), independente dos 3 slots normais estarem cheios ou não.
    if (exclusiveTimeLeft(job, profile?.id)) return !slotInfo.exclusive_slot_used
    // Coaching não disputa os slots normais -- ilimitado pra qualquer booster
    // aprovado (normal ou Top3).
    if (job.service_type === 'coaching') return true
    if (slotInfo.total_count >= slotInfo.max_total) return false
    return true
  }

  const serviceFilters = useServiceFilters(jobs)
  const filtered = useMemo(
    () => serviceFilters.filtered.filter((j) => !search || j.id.toLowerCase().includes(search.toLowerCase())),
    [serviceFilters.filtered, search],
  )

  // Pedidos atribuídos a este booster (vínculo exclusivo, badge "Exclusivo")
  // aparecem primeiro -- sort é estável, então a ordem original (created_at)
  // se mantém dentro de cada grupo.
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const aMine = (exclusiveBadge(a, profile?.id) || reassignedBadge(a, profile?.id)) ? 1 : 0
    const bMine = (exclusiveBadge(b, profile?.id) || reassignedBadge(b, profile?.id)) ? 1 : 0
    return bMine - aMine
  }), [filtered, profile?.id])

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12
  const pageJobs = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNextPage = page * PAGE_SIZE < sorted.length
  const maxPage = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  useEffect(() => { if (page > maxPage) setPage(maxPage) }, [maxPage, page])

  if (boosterProfile && boosterProfile.status !== 'approved') {
    const statusMessages: Record<string, { title: string; desc: string }> = {
      pending:      { title: 'Candidatura em análise', desc: 'Nossa equipe está analisando seu perfil. Você será notificado quando aprovado.' },
      under_review: { title: 'Revisão final em andamento', desc: 'Quase lá! Seu perfil está na fase final de revisão.' },
      suspended:    { title: 'Conta suspensa', desc: 'Entre em contato com o suporte para mais informações.' },
    }
    const msg = statusMessages[boosterProfile.status] ?? { title: 'Perfil inativo', desc: 'Entre em contato com o suporte.' }
    return (
      <div>
        <EmptyState icon={Lock} title={msg.title} description={msg.desc} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Jobs Disponíveis" description={<>{filtered.length} job disponível</>} actions={<><div className="flex items-center gap-3 flex-wrap">
          {slotInfo && <SlotIndicator slots={slotInfo} />}
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <LiveDot />
            Ao vivo
          </div>
          <OrderSoundSettings />
        </div></>} />

      {/* Slots full warning */}
      {slotInfo && slotInfo.total_count >= slotInfo.max_total && (
        <div className="bg-warning/10 border border-warning/20 rounded-xl px-4 py-3 text-sm text-warning font-medium">
          Você atingiu o limite de {slotInfo.max_total} pedidos ativos. Conclua um pedido para liberar um slot.
          {!slotInfo.exclusive_slot_used && ' Você ainda pode aceitar 1 pedido exclusivo, se algum estiver vinculado a você.'}
          {' Pedidos de coaching não entram nesse limite -- pode aceitar quantos quiser.'}
        </div>
      )}

      {/* Filters -- busca à esquerda, categoria de serviço + subfiltros à direita (sem status aqui: todo job já é awaiting_assignment). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder="Buscar por código do pedido…"
          aria-label="Buscar por código do pedido"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ServiceFilterBar
          category={serviceFilters.category}
          onCategoryChange={serviceFilters.setCategory}
          counts={serviceFilters.counts}
          queue={serviceFilters.queue}
          onQueueChange={serviceFilters.setQueue}
          queueCounts={serviceFilters.queueCounts}
          mode={serviceFilters.mode}
          onModeChange={serviceFilters.setMode}
          modeCounts={serviceFilters.modeCounts}
          clashTier={serviceFilters.clashTier}
          onClashTierChange={serviceFilters.setClashTier}
          clashTierCounts={serviceFilters.clashTierCounts}
          clashDay={serviceFilters.clashDay}
          onClashDayChange={serviceFilters.setClashDay}
          clashDayCounts={serviceFilters.clashDayCounts}
        />
      </div>

      {/* Jobs */}
      {isLoading ? (
        <CardGrid >
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
        </CardGrid>
      ) : !filtered.length ? (
        <EmptyState icon={Briefcase} title="Sem jobs disponíveis" description="Volte em breve — jobs chegam frequentemente." />
      ) : (
        <>
        <CardGrid >
          {pageJobs.map((job) => {
            const isDuo = job.boost_mode === 'duo'
            const blocked = slotInfo && !canAcceptJob(job)
            const exclusiveLabel = exclusiveBadge(job, profile?.id)
            const reassignedLabel = reassignedBadge(job, profile?.id)
            const coachPackage = job.service_type === 'coaching' && job.booster_service_id
              ? coachingPackageById.get(job.booster_service_id)
              : undefined

            return (
              <Card
                key={job.id}
                variant={exclusiveLabel || reassignedLabel ? 'achievement' : 'standard'}
                // Mesmo hover "glamour" do Card variant="interactive" (ver
                // Card.tsx) -- borda + sombra + leve elevação -- só sem o wash
                // de fundo, pra não brigar com o wash do card exclusivo/
                // reatribuído. Sem cursor-pointer: o card em si não navega,
                // só o botão "Aceitar" lá dentro. Reatribuído usa o mesmo
                // tom de roxo do rank Mestre (rank-master) já existente no
                // design system, em vez do amarelo accent do exclusivo.
                className={`h-full flex flex-col gap-4 hover:border-brand/25 hover:shadow-card-hover hover:-translate-y-1 ease-out ${reassignedLabel ? 'bg-rank-master/[0.05] border-t-rank-master/40' : exclusiveLabel ? 'bg-accent/[0.03]' : ''}`}
              >
                <OrderCardHeader
                  order={job}
                  title={coachPackage?.title ?? getOrderServiceName(job)}
                  trailing={job.service_type !== 'coaching' && (
                    <Badge variant={isDuo ? 'brand' : 'neutral'} size="tag" className={isDuo ? 'border border-brand/20' : 'text-ink-muted'}>
                      {getOrderModeType(job)}
                    </Badge>
                  )}
                />

                {(exclusiveLabel || reassignedLabel || job.service_type === 'elo_boost' || job.service_type === 'win_boost' || job.service_type === 'md5') && (
                  <div className="flex flex-wrap gap-1.5">
                    {(job.service_type === 'elo_boost' || job.service_type === 'win_boost' || job.service_type === 'md5') && (
                      <Badge variant="neutral" size="tag">
                        {job.queue_type === 'solo_duo' ? 'Solo/Duo' : 'Flex'}
                      </Badge>
                    )}
                    {reassignedLabel ? (
                      <Badge size="tag" className="bg-rank-master/15 text-rank-master">
                        <Sparkles className="h-3 w-3" />
                        {reassignedLabel}
                      </Badge>
                    ) : exclusiveLabel && (
                      <Badge variant="accent" size="tag">
                        <Sparkles className="h-3 w-3" />
                        {exclusiveLabel}
                      </Badge>
                    )}
                  </div>
                )}

                {coachPackage && (
                  <div className="space-y-2">
                    {coachPackage.description && (
                      <p className="text-sm text-ink-secondary leading-relaxed line-clamp-2">{coachPackage.description}</p>
                    )}
                    <ServiceTagPills lanes={coachPackage.lanes} champions={coachPackage.champions} specialties={coachPackage.specialties} compact />
                    {coachPackage.tempo && (
                      <p className="text-2xs text-ink-muted">Duração por sessão: <span className="font-semibold text-ink">{coachPackage.tempo}</span></p>
                    )}
                  </div>
                )}

                <OrderCardDetails order={job} viewerRole="booster" />

                <div className="mt-auto flex items-center justify-between border-t border-border-subtle pt-4">
                  <div>
                    <p className="text-base font-bold text-success">{currency(job.total_price * boosterEarningsShare(slotInfo?.is_top3, job.service_type))}</p>
                    <p className="text-2xs text-ink-muted">Seu corte ({Math.round(boosterEarningsShare(slotInfo?.is_top3, job.service_type) * 100)}%)</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      size="sm"
                      onClick={() => setCaptchaJobId(job.id)}
                      loading={acceptJob.isPending}
                      disabled={!!blocked}
                      title={blocked ? 'Slots cheios' : undefined}
                    >
                      Aceitar
                    </Button>
                    {acceptJob.isError && (
                      <p className="text-2xs text-danger text-right max-w-[140px]">
                        {acceptJob.error instanceof Error ? acceptJob.error.message : 'Erro'}
                      </p>
                    )}
                  </div>
                </div>

                <p className="-mt-1 text-xs text-ink-muted">Publicado {timeAgo(job.created_at)}</p>
              </Card>
            )
          })}
        </CardGrid>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      )}

      <CaptchaChallenge
        open={captchaJobId !== null}
        onOpenChange={(next) => { if (!next) setCaptchaJobId(null) }}
        onSuccess={() => {
          if (captchaJobId) acceptJob.mutate(captchaJobId)
          setCaptchaJobId(null)
        }}
      />
    </div>
  )
}
