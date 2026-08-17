import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Clock, CheckCircle2, Trophy, Package, MessageSquare, ExternalLink, Eye, DollarSign } from 'lucide-react'
import { Button, Card, Modal, RankBadge, Avatar, Skeleton, EmptyState } from '@/components/ui'
import { SEOHead } from '@/components/SEOHead'
import { RankPerformanceBreakdown } from '@/components/rank/RankPerformanceBreakdown'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { cn, formatRank, formatLastSeen, isBoosterOnline, getServiceLabel, safeOpggUrl } from '@/lib/utils'
import type { RankTier, BoosterService } from '@/types'
import { useCurrency } from '@/hooks/useCurrency'
import { usePublicBooster } from '@/api/boosters'
import { usePublicCoachingPackages } from '@/api/coaching'
import { useBoosterReviews } from '@/api/reviews'
import { TestimonialCard } from '../components/TestimonialCard'

// ── Page ──────────────────────────────────────────────────────────────────────

export function BoosterPublicProfilePage() {
  const { displayName } = useParams<{ displayName: string }>()
  const currency = useCurrency()
  const [viewingService, setViewingService] = useState<BoosterService | null>(null)

  const { data: booster, isLoading } = usePublicBooster(displayName)
  const { data: services = [] } = usePublicCoachingPackages(booster?.user_id)
  const { data: reviews = [] } = useBoosterReviews(booster?.user_id)

  if (isLoading) return (
    <div className="container-wide py-16">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64 lg:h-[450px] w-full rounded-2xl lg:col-span-1" />
        <Skeleton className="h-64 lg:h-[450px] w-full rounded-2xl lg:col-span-2" />
      </div>
    </div>
  )

  if (!booster) return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 text-center">
      <p className="text-ink-secondary">Booster não encontrado.</p>
      <Button asChild variant="ghost" className="mt-4">
        <Link to="/boosters"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
      </Button>
    </div>
  )

  // TestimonialCard (mesmo componente da home) sempre renderiza o comentário
  // -- igual TestimonialsCarousel, que só busca reviews com content != null.
  const reviewsWithContent = reviews.filter((r): r is typeof r & { content: string } => !!r.content)

  const statCells: {
    key: string
    label: string
    value: string
    color: string
    icon?: typeof CheckCircle2
    rankTier?: RankTier
    rankDivision?: string | null
  }[] = [
    { key: 'completed', icon: CheckCircle2, label: 'Concluídos', value: String(booster.total_completed), color: 'text-success' },
    {
      key: 'peakRank',
      label: 'Rank Máximo',
      value: booster.peak_rank ? formatRank(booster.peak_rank.tier as RankTier, (booster.peak_rank as { division?: string | null }).division ?? null) : '—',
      color: 'text-brand',
      rankTier: booster.peak_rank?.tier as RankTier | undefined,
      rankDivision: (booster.peak_rank as { division?: string | null })?.division ?? null,
    },
  ]

  return (
    <div className="container-wide py-16 space-y-10">
      <SEOHead
        title={booster.display_name}
        description={`Perfil de ${booster.display_name} no EloPeak: estatísticas de desempenho, elo atual e serviços de boosting disponíveis.`}
      />
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/boosters"><ArrowLeft className="h-4 w-4 mr-1" /> Todos os Boosters</Link>
      </Button>

      {/* ── Linha 1: mini-perfil + desempenho por elo, mesma altura fixa ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">

        {/* ── Mini-perfil ── */}
        <div className="lg:col-span-1">
          <Card padding="lg" className="h-full lg:h-[450px] overflow-y-auto text-center space-y-4">
            <Avatar src={booster.avatar_url} name={booster.display_name} size="xl" className="mx-auto" />

            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <h1 className="text-xl font-extrabold text-ink">{booster.display_name}</h1>
                {booster.is_top3 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 px-2 py-0.5 rounded-lg uppercase tracking-wide">
                    <Trophy className="h-3 w-3" /> Top 3
                  </span>
                )}
              </div>
              {isBoosterOnline(booster.last_active_at) ? (
                <p className="text-[10px] font-semibold text-success flex items-center justify-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  Online
                </p>
              ) : (
                <p className="text-[10px] font-medium text-ink-muted">
                  {formatLastSeen(booster.last_active_at)}
                </p>
              )}
            </div>

            {/* Concluídos + rank pico */}
            <div className="grid grid-cols-2 gap-2">
              {statCells.map(({ key, icon: Icon, label, value, color, rankTier, rankDivision }) => (
                <div key={key} className="rounded-xl bg-bg-elevated/50 p-2.5 flex flex-col items-center gap-1">
                  {rankTier ? (
                    <RankBadge tier={rankTier} division={rankDivision as never} size="xs" showLabel={false} />
                  ) : Icon ? (
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-bg-elevated border border-border-subtle">
                      <Icon className={`h-6 w-6 ${color}`} />
                    </span>
                  ) : null}
                  <p className="text-xs font-bold text-ink text-center leading-tight">{value}</p>
                  <p className="text-[10px] text-ink-muted uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {safeOpggUrl(booster.opgg_link) && (
              <a
                href={safeOpggUrl(booster.opgg_link)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Ver no OP.GG
              </a>
            )}

            {booster.bio && (
              <p className="text-sm text-ink-secondary leading-relaxed">{booster.bio}</p>
            )}

            {/* CTA — direto pro configurador de pedido */}
            <div className="rounded-xl bg-brand/10 border border-brand/20 p-4 space-y-2">
              <p className="text-sm font-bold text-ink">Quer boostar com {booster.display_name}?</p>
              <Button asChild size="sm" className="w-full">
                <Link to={`/orders/new?booster=${booster.user_id}`}>Fazer Pedido</Link>
              </Button>
            </div>
          </Card>
        </div>

        {/* ── Desempenho por Faixa de Elo ── */}
        <div className="lg:col-span-2">
          <RankPerformanceBreakdown boosterUserId={booster.user_id} className="h-full lg:h-[450px] overflow-y-auto" />
        </div>
      </div>

      {/* ── Linha 2: Serviços, largura total ── */}
      {services.length > 0 && (
        <Card padding="md">
          <div className="flex items-center gap-2 mb-4">
            <Package className="h-4 w-4 text-brand" />
            <h2 className="text-base font-bold text-ink">Serviços</h2>
          </div>
          <p className="text-xs text-ink-muted mb-4">
            Pacotes oferecidos diretamente por {booster.display_name} — cada um com escopo, tempo estimado e preço fechado.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map(s => (
              <div key={s.id} className="rounded-xl border border-border-subtle bg-bg-elevated/30 overflow-hidden flex flex-col">
                <div className="h-1 bg-success shrink-0" />
                <div className="p-5 flex flex-col gap-2.5 flex-1">
                <div>
                  <p className="text-sm font-bold text-ink">{s.title}</p>
                  {s.service_type && (
                    <p className="text-[10px] font-semibold text-brand uppercase tracking-wide mt-0.5">{getServiceLabel(s.service_type)}</p>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-ink-secondary leading-relaxed flex-1">{s.description}</p>
                )}
                <ServiceTagPills lanes={s.lanes} champions={s.champions} specialties={s.specialties} />
                <div className="flex items-center gap-3 mt-auto pt-2 border-t border-border-subtle">
                  {s.tempo && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-ink-muted" />
                      <span className="text-[11px] text-ink-secondary">{s.tempo}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-sm font-bold text-brand">{currency(s.price)}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-1" onClick={() => setViewingService(s)}>
                  <Eye className="h-3.5 w-3.5" /> Visualizar
                </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Linha 3: Avaliações — lista full-width no rodapé, sem grid ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="h-4 w-4 text-brand" />
          <h2 className="text-base font-bold text-ink">Avaliações</h2>
        </div>
        {!reviewsWithContent.length ? (
          <EmptyState icon={MessageSquare} title="Este booster ainda não recebeu avaliações." />
        ) : (
          // Mesmo card e mesmo mecanismo de esteira do TestimonialsCarousel da
          // home (src/features/public/components/TestimonialsCarousel.tsx) --
          // duplica a lista sempre (mesmo com poucas avaliações) pra fechar o
          // loop visual sem emenda, já que a animação desloca -50%.
          <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
            <div className="flex w-max gap-5 animate-marquee group-hover:[animation-play-state:paused]">
              {[...reviewsWithContent, ...reviewsWithContent].map((review, i) => (
                <TestimonialCard
                  key={`${review.id}-${i}`}
                  rating={review.rating}
                  content={review.content!}
                  booster_display_name={booster.display_name}
                  customer_name={review.customer_nickname}
                  service_label={getServiceLabel(review.service_type)}
                  showBoosterBadge={false}
                  className="w-80 shrink-0"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Detalhe do serviço (Visualizar) ── */}
      <Modal
        open={!!viewingService}
        onOpenChange={(open) => { if (!open) setViewingService(null) }}
        title={viewingService?.title ?? ''}
        maxWidth="lg"
      >
        {viewingService && (
          <div className="space-y-5">
            {viewingService.service_type && (
              <p className="text-[10px] font-semibold text-brand uppercase tracking-wide">{getServiceLabel(viewingService.service_type)}</p>
            )}
            {viewingService.description && (
              <p className="text-sm text-ink-secondary leading-relaxed">{viewingService.description}</p>
            )}
            <ServiceTagPills lanes={viewingService.lanes} champions={viewingService.champions} specialties={viewingService.specialties} labeled />
            <div className={cn('grid gap-3 pt-4 border-t border-border-subtle', viewingService.tempo ? 'grid-cols-2' : 'grid-cols-1')}>
              {viewingService.tempo && (
                <div className="rounded-xl bg-bg-elevated/50 p-3 flex items-center justify-center gap-2">
                  <Clock className="h-4 w-4 text-ink-muted" />
                  <span className="text-sm font-bold text-ink">{viewingService.tempo}</span>
                </div>
              )}
              <div className="rounded-xl bg-brand/10 p-3 flex items-center justify-center gap-2">
                <DollarSign className="h-4 w-4 text-brand" />
                <span className="text-lg font-bold text-brand">{currency(viewingService.price)}</span>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link to={
                viewingService.service_type === 'coaching'
                  ? `/orders/new?service=coaching&booster=${booster.user_id}&coach_package=${viewingService.id}`
                  : `/orders/new?booster=${booster.user_id}`
              }>Contratar</Link>
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
