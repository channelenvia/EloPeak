import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Shield, Zap, Clock, Users, ChevronRight,
  TrendingUp, MessageCircle, Swords,
  ArrowRight, Lock, Star,
} from 'lucide-react'
import { Avatar, Button, RankBadge } from '@/components/ui'
import { formatRank } from '@/lib/utils'
import type { RankTier } from '@/types'
import { TestimonialsCarousel } from '../components/TestimonialsCarousel'
import { SectionTint } from '../components/SectionTint'
import { useTopBoosters } from '@/api/boosters'

// ─── Main page ────────────────────────────────────────────────────────────────

export function HomePage() {
  const { t } = useTranslation()

  // Mesma seleção sistemática do Top 3 da página /boosters (ver
  // get_top_boosters) — só pede 1 posição a mais para preencher o teaser de
  // 4 colunas da home; não é uma lista fixa/manual.
  const { data: topBoosters } = useTopBoosters(4)
  const featuredBoosters = (topBoosters ?? []).map((b) => ({
    id: b.booster_profile_id,
    display_name: b.display_name,
    avatar_url: b.avatar_url,
    current_rank: b.current_rank,
    rating: b.average_rating ?? 0,
    rating_count: b.review_count,
    win_rate_pct: b.win_rate_pct,
    total_matches: b.total_matches,
  }))

  const STATS = [
    { value: '1.800+', label: t('home.stats.ordersCompleted') },
    { value: '4,9/5',  label: t('home.stats.avgRating')       },
    { value: '88%',    label: t('home.stats.winRate')          },
    { value: '20+',    label: t('home.stats.activeBoosters')   },
  ]

  const SERVICES = [
    {
      icon: TrendingUp,
      title: t('home.services.eloBoostTitle'),
      href: '/orders/new?service=elo_boost',
      badge: t('home.services.mostPopular'),
      color: 'text-brand bg-brand/10',
      desc: t('home.services.eloBoostDesc'),
    },
    {
      icon: Zap,
      title: t('home.services.winBoostTitle'),
      href: '/orders/new?service=win_boost',
      badge: t('home.services.fast'),
      color: 'text-accent bg-accent/10',
      desc: t('home.services.winBoostDesc'),
    },
    {
      icon: Users,
      title: t('home.services.coachingTitle'),
      href: '/orders/new?service=coaching',
      badge: t('home.services.pro'),
      color: 'text-success bg-success/10',
      desc: t('home.services.coachingDesc'),
    },
    {
      icon: Swords,
      title: t('home.services.clashTitle'),
      href: '/orders/new?service=clash',
      badge: t('home.services.weekend'),
      color: 'text-warning bg-warning/10',
      desc: t('home.services.clashDesc'),
    },
  ]

  const TRUST_FEATURES = [
    { icon: Lock,          label: t('home.extras.vpnLabel'),       desc: t('home.extras.vpnDesc')       },
    { icon: MessageCircle, label: t('home.extras.chatLabel'),      desc: t('home.extras.chatDesc')      },
    { icon: Star,          label: t('home.extras.guaranteeLabel'), desc: t('home.extras.guaranteeDesc') },
    { icon: Clock,         label: 'Início rápido',                 desc: 'Seu pedido é atribuído em até 30 minutos após o pagamento.' },
  ]

  return (
    <div>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
        <div className="absolute -top-60 right-0 w-[700px] h-[700px] rounded-full bg-brand/6 blur-[140px] pointer-events-none" />

        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 py-20 lg:py-24 relative">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="max-w-4xl mx-auto text-center"
          >
            <h1 className="text-5xl sm:text-6xl xl:text-7xl font-black tracking-tight text-ink leading-[1.02]">
              {t('home.heroTitle')}{' '}
              <span className="text-gradient-brand">{t('home.heroTitleHighlight')}</span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-ink-secondary leading-relaxed max-w-2xl mx-auto">
              {t('home.heroDesc')}{' '}
              <span className="text-ink font-semibold">{t('home.heroDescBold')}</span>{t('home.heroDescPost')}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
              <Button asChild size="lg">
                <Link to="/orders/new">
                  Começar Agora <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/apply?booster=1">Seja Booster</Link>
              </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 mt-12 overflow-hidden rounded-2xl border border-bg-elevated bg-bg-elevated/70 gap-px shadow-card">
              {STATS.map(({ value, label }) => (
                <div key={label} className="bg-bg-card/90 px-4 py-5 sm:px-6">
                  <p className="text-2xl font-extrabold text-ink">{value}</p>
                  <p className="text-xs text-ink-muted mt-1">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── SERVICES ─────────────────────────────────────────────────────── */}
      <section id="services" className="relative py-16 lg:py-20 scroll-mt-20">
        <SectionTint />
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            <p className="section-label mb-3">{t('home.services.sectionLabel')}</p>
            <h2 className="text-4xl md:text-5xl font-black text-ink">{t('home.services.title')}</h2>
            <p className="mt-4 text-ink-secondary text-lg max-w-xl mx-auto">{t('home.services.desc')}</p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {SERVICES.map(({ icon: Icon, title, href, badge, color, desc }, i) => (
              <motion.div key={title}
                initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.1 }}
              >
                <Link to={href}
                  className="card p-6 flex flex-col gap-5 h-full group hover:shadow-card-hover hover:-translate-y-1 hover:border-brand/25 transition-all duration-200"
                >
                  {badge && (
                    <span className="self-start text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-brand/15 text-brand border border-brand/25">
                      {badge}
                    </span>
                  )}
                  <div className={`h-12 w-12 rounded-2xl flex items-center justify-center ${color} group-hover:scale-110 transition-transform`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-ink mb-2">{title}</h3>
                    <p className="text-sm text-ink-secondary leading-relaxed">{desc}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-brand text-sm font-bold mt-auto">
                    {t('home.services.orderNow')} <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Ver todos os serviços */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.35 }}
            className="mt-8 text-center"
          >
            <Button asChild variant="ghost">
              <Link to="/services">
                Ver todos os serviços em detalhe <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="py-16 lg:py-20 relative overflow-hidden">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            <p className="section-label mb-3">{t('home.howItWorks.sectionLabel')}</p>
            <h2 className="text-4xl md:text-5xl font-black text-ink">{t('home.howItWorks.title')}</h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { n: '01', title: t('home.howItWorks.step1Title'), body: t('home.howItWorks.step1Desc') },
              { n: '02', title: t('home.howItWorks.step2Title'), body: t('home.howItWorks.step2Desc') },
              { n: '03', title: t('home.howItWorks.step3Title'), body: t('home.howItWorks.step3Desc') },
            ].map(({ n, title, body }, idx) => (
              <motion.div key={n}
                initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.45, delay: idx * 0.12 }}
                className="relative flex flex-col items-center text-center gap-4"
              >
                <div className="h-16 w-16 rounded-2xl bg-gradient-brand flex items-center justify-center text-white text-xl font-black shadow-brand">
                  {n}
                </div>
                <h3 className="text-xl font-bold text-ink">{title}</h3>
                <p className="text-ink-secondary leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>

        </div>
      </section>

      {/* ── TRUST & SECURITY ─────────────────────────────────────────────── */}
      <section className="relative py-16 lg:py-20">
        <SectionTint />
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">

            <motion.div
              initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.5 }}
            >
              <p className="section-label mb-4">{t('home.trust.sectionLabel')}</p>
              <h2 className="text-4xl md:text-5xl font-black text-ink mb-6 leading-tight">
                {t('home.trust.title')}
              </h2>
              <p className="text-ink-secondary text-lg mb-7 leading-relaxed">
                {t('home.trust.desc')}
              </p>
              <Button asChild size="lg" variant="secondary">
                <Link to="/security">{t('home.trust.policy')}</Link>
              </Button>
            </motion.div>

            <div>
              <div className="grid grid-cols-2 gap-4">
                {TRUST_FEATURES.map(({ icon: Icon, label, desc }, i) => (
                  <motion.div key={label}
                    initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.08 }}
                    className="card p-5 space-y-3 hover:border-success/25 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <h4 className="font-bold text-ink text-sm">{label}</h4>
                      <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── BOOSTERS ─────────────────────────────────────────────────────── */}
      {featuredBoosters.length > 0 && (
        <section className="py-16 lg:py-20">
          <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.5 }}
              className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10"
            >
              <div>
                <p className="section-label mb-3">Boosters</p>
                <h2 className="text-4xl md:text-5xl font-black text-ink">Perfis em destaque</h2>
                <p className="mt-4 text-ink-secondary text-lg max-w-xl">
                  Boosters aprovados manualmente, com dados carregados direto do catálogo público.
                </p>
              </div>
              <Button asChild variant="ghost">
                <Link to="/boosters">
                  Ver todos <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {featuredBoosters.map((booster, index) => (
                <motion.div
                  key={booster.id}
                  initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }} transition={{ duration: 0.4, delay: index * 0.08 }}
                >
                  <Link
                    to={`/boosters/${encodeURIComponent(booster.display_name)}`}
                    className="card p-5 flex flex-col gap-4 h-full hover:shadow-card-hover hover:-translate-y-1 hover:border-brand/25 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar src={booster.avatar_url} name={booster.display_name} size="md" />
                      <div className="min-w-0">
                        <p className="font-bold text-ink truncate">{booster.display_name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Star className="h-3 w-3 text-warning fill-warning" />
                          <span className="text-xs font-semibold text-ink-secondary">
                            {booster.rating_count > 0 ? booster.rating.toFixed(1) : 'Novo'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {booster.current_rank && (
                      <div className="flex items-center gap-2">
                        <RankBadge tier={booster.current_rank.tier as RankTier} division={booster.current_rank.division} size="sm" showLabel={false} />
                        <span className="text-xs font-semibold text-ink-secondary">
                          {formatRank(booster.current_rank.tier as RankTier, booster.current_rank.division)}
                        </span>
                      </div>
                    )}

                    <div className="mt-auto grid grid-cols-2 gap-3 pt-3 border-t border-bg-elevated">
                      <div>
                        <p className="text-[10px] text-ink-muted">Winrate</p>
                        <p className="text-sm font-extrabold text-brand">{booster.win_rate_pct > 0 ? `${booster.win_rate_pct}%` : 'Sem partidas'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-ink-muted">Partidas</p>
                        <p className="text-sm font-extrabold text-ink">{booster.total_matches}</p>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── CUSTOMER REVIEWS ─────────────────────────────────────────────── */}
      {/* Sempre com o mesmo tratamento visual, independente de existir ou não
          a seção de Boosters acima -- antes o tint dependia de
          featuredBoosters.length, o que deixava a alternância de peso visual
          inconsistente conforme os dados (fonte da quebra perceptível). */}
      <section className="relative py-16 lg:py-20 overflow-hidden">
        <SectionTint />
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            <p className="section-label mb-3">{t('home.reviewsSection.sectionLabel')}</p>
            <h2 className="text-4xl md:text-5xl font-black text-ink">{t('home.reviewsSection.title')}</h2>
          </motion.div>
        </div>

        <TestimonialsCarousel />
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      {/* Sempre com o glow próprio (igual ao Hero), nunca o tint plano --
          antes alternava com base em featuredBoosters.length, mesma
          inconsistência de dados corrigida na seção de Reviews acima. */}
      <section className="py-16 lg:py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-glow opacity-60 pointer-events-none" />
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.55 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 text-success text-xs font-bold mb-8">
              <Shield className="h-3.5 w-3.5" />
              Garantia 100% de conclusão
            </div>

            <h2 className="text-4xl md:text-6xl font-black text-ink mb-6 leading-tight">
              {t('home.cta.title')}
            </h2>
            <p className="text-ink-secondary text-xl mb-10">
              {t('home.cta.desc')}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button asChild size="xl">
                <Link to="/orders/new">
                  {t('home.cta.button')} <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link to="/faq">Dúvidas frequentes</Link>
              </Button>
            </div>

            <p className="mt-8 text-xs text-ink-muted">
              Pagamento seguro · Sem compromisso · Suporte 24/7
            </p>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
