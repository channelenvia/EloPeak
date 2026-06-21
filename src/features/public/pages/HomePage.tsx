import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Shield, Zap, Clock, Users, ChevronRight,
  TrendingUp, MessageCircle, Award, CheckCircle2,
  ArrowRight, Lock, Eye, Radio,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { cn, RANK_TIER_ORDER, RANK_TIER_LABEL, RANK_TIER_COLOR } from '@/lib/utils'
import type { RankTier } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'

// ─── Price engine ──────────────────────────────────────────────────────────────

import { calcEloPrice } from '@/lib/pricing'

const DIVISIONS = ['IV', 'III', 'II', 'I'] as const
type Division = (typeof DIVISIONS)[number]

function calcPrice(fTier: RankTier, fDiv: Division, tTier: RankTier, tDiv: Division): number {
  return calcEloPrice(fTier, fDiv, tTier, tDiv).price
}

function estHours(fTier: RankTier, fDiv: Division, tTier: RankTier, tDiv: Division): string {
  const { hours } = calcEloPrice(fTier, fDiv, tTier, tDiv)
  if (hours === 0) return '—'
  const lo = Math.max(1, Math.round(hours * 0.6))
  const hi = Math.round(hours * 1.4)
  return `${lo}–${hi}h`
}

// ─── Rank Configurator ────────────────────────────────────────────────────────

function RankPicker({
  label, value, div, onTier, onDiv, excludeBelow,
}: {
  label: string
  value: RankTier
  div: Division
  onTier: (t: RankTier) => void
  onDiv: (d: Division) => void
  excludeBelow?: RankTier
}) {
  const minIdx = excludeBelow ? RANK_TIER_ORDER.indexOf(excludeBelow) + 1 : 0
  const tiers = RANK_TIER_ORDER.slice(minIdx)

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-ink-secondary uppercase tracking-widest">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {tiers.map(tier => (
          <button
            key={tier}
            type="button"
            onClick={() => onTier(tier)}
            className={cn(
              'px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all',
              value === tier
                ? `border-current bg-bg-elevated ${RANK_TIER_COLOR[tier]}`
                : 'border-bg-elevated text-ink-muted hover:border-bg-overlay hover:text-ink-secondary'
            )}
          >
            {RANK_TIER_LABEL[tier]}
          </button>
        ))}
      </div>
      {!(['master', 'grandmaster', 'challenger'] as RankTier[]).includes(value) && (
        <div className="flex gap-1.5">
          {DIVISIONS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => onDiv(d)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all',
                div === d
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-bg-elevated text-ink-muted hover:border-bg-overlay'
              )}
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BoostConfigurator() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()
  const { t } = useTranslation()
  const currency = useCurrency()
  const [fromTier, setFromTier] = useState<RankTier>('silver')
  const [fromDiv, setFromDiv] = useState<Division>('IV')
  const [toTier, setToTier] = useState<RankTier>('gold')
  const [toDiv, setToDiv] = useState<Division>('IV')

  function handleFromTier(tier: RankTier) {
    setFromTier(tier)
    const fIdx = RANK_TIER_ORDER.indexOf(tier)
    const tIdx = RANK_TIER_ORDER.indexOf(toTier)
    if (tIdx <= fIdx) setToTier(RANK_TIER_ORDER[Math.min(fIdx + 1, RANK_TIER_ORDER.length - 1)])
  }

  const price = calcPrice(fromTier, fromDiv, toTier, toDiv)
  const hours = estHours(fromTier, fromDiv, toTier, toDiv)

  function handleStart() {
    const params = new URLSearchParams({
      service: 'elo_boost',
      from_tier: fromTier, from_div: fromDiv,
      to_tier: toTier, to_div: toDiv,
      queue: 'solo_duo', server: 'BR',
    })
    if (isAuthenticated()) navigate(`/orders/new?${params}`)
    else navigate(`/login?redirect=/orders/new?${params}`)
  }

  return (
    <div className="card p-6 space-y-5 shadow-glow border-brand/20">
      <div className="flex items-center gap-2 border-b border-bg-elevated pb-4">
        <div className="h-8 w-8 rounded-lg bg-brand/15 flex items-center justify-center">
          <Zap className="h-4 w-4 text-brand" />
        </div>
        <div>
          <p className="text-sm font-bold text-ink">{t('home.configurator.title')}</p>
          <p className="text-xs text-ink-muted">{t('home.configurator.subtitle')}</p>
        </div>
      </div>

      <RankPicker
        label={t('home.configurator.currentRank')}
        value={fromTier} div={fromDiv}
        onTier={handleFromTier} onDiv={setFromDiv}
      />

      <RankPicker
        label={t('home.configurator.targetRank')}
        value={toTier} div={toDiv}
        onTier={setToTier} onDiv={setToDiv}
        excludeBelow={fromTier}
      />

      <div className="rounded-xl bg-bg-elevated/60 border border-bg-overlay p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-ink-muted font-medium">{t('home.configurator.estTime')}</p>
          <p className="text-sm font-bold text-ink">{hours}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-muted font-medium">{t('home.configurator.totalPrice')}</p>
          {price > 0
            ? <p className="text-2xl font-extrabold text-ink">{currency(price)}</p>
            : <p className="text-sm text-ink-muted italic">{t('home.configurator.selectRanks')}</p>
          }
        </div>
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={price === 0}
        onClick={handleStart}
      >
        {t('home.configurator.startBoost', { price: price > 0 ? currency(price) : currency(0) })}
        <ArrowRight className="h-5 w-5" />
      </Button>

      <div className="flex items-center justify-center gap-4 text-[11px] text-ink-muted font-medium">
        <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> {t('home.configurator.securePayment')}</span>
        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {t('home.configurator.guarantee')}</span>
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {t('home.configurator.support')}</span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function HomePage() {
  const { t } = useTranslation()

  const STATS = [
    { value: '48,200+', label: t('home.stats.ordersCompleted') },
    { value: '4.94★',   label: t('home.stats.avgRating')       },
    { value: '88%',     label: t('home.stats.winRate')          },
    { value: '340+',    label: t('home.stats.activeBoosters')   },
  ]

  const SERVICES = [
    { icon: TrendingUp, title: t('home.services.eloBoostTitle'),    href: '/orders/new?service=elo_boost',        badge: t('home.services.mostPopular'), color: 'text-brand bg-brand/10',   desc: t('home.services.eloBoostDesc') },
    { icon: Zap,        title: t('home.services.winBoostTitle'),    href: '/orders/new?service=win_boost',         badge: t('home.services.fast'),        color: 'text-accent bg-accent/10',  desc: t('home.services.winBoostDesc') },
    { icon: Users,      title: t('home.services.coachingTitle'),    href: '/orders/new?service=coaching',          badge: t('home.services.pro'),         color: 'text-success bg-success/10', desc: t('home.services.coachingDesc') },
    { icon: Award,      title: t('home.services.placementsTitle'),  href: '/orders/new?service=placement_matches', badge: null,                           color: 'text-info bg-info/10',       desc: t('home.services.placementsDesc') },
  ]

  const EXTRAS = [
    { icon: Eye,          label: t('home.extras.offlineLabel'),  desc: t('home.extras.offlineDesc')  },
    { icon: Lock,         label: t('home.extras.vpnLabel'),      desc: t('home.extras.vpnDesc')      },
    { icon: MessageCircle,label: t('home.extras.chatLabel'),     desc: t('home.extras.chatDesc')     },
    { icon: Radio,        label: t('home.extras.streamLabel'),   desc: t('home.extras.streamDesc')   },
    { icon: Shield,       label: t('home.extras.soloLabel'),     desc: t('home.extras.soloDesc')     },
    { icon: CheckCircle2, label: t('home.extras.guaranteeLabel'),desc: t('home.extras.guaranteeDesc')},
  ]

  return (
    <div>
      {/* ── HERO ── */}
      <section className="relative min-h-[92vh] flex items-center bg-bg-base overflow-hidden">
        <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
        <div className="absolute inset-0 bg-grid pointer-events-none opacity-60" />
        <div className="absolute -top-60 right-0 w-[600px] h-[600px] rounded-full bg-brand/8 blur-[120px] pointer-events-none" />

        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 w-full py-20">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -32 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.55 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/25 text-success text-xs font-bold mb-8">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {t('home.badge')}
              </div>

              <h1 className="text-5xl sm:text-6xl xl:text-7xl font-black tracking-tight text-ink leading-[1.0] mb-6">
                {t('home.heroTitle')}<br />
                <span className="text-gradient-brand">{t('home.heroTitleHighlight')}</span>
              </h1>

              <p className="text-xl text-ink-secondary leading-relaxed mb-10 max-w-lg">
                {t('home.heroDesc')}{' '}
                <span className="text-ink font-semibold">{t('home.heroDescBold')}</span>{t('home.heroDescPost')}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
                {STATS.map(({ value, label }) => (
                  <div key={label}>
                    <p className="text-2xl font-extrabold text-ink">{value}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-ink-secondary">
                <span className="flex items-center gap-1.5"><Shield className="h-4 w-4 text-success" /> {t('home.trustBadge1')}</span>
                <span className="flex items-center gap-1.5"><Eye className="h-4 w-4 text-success" /> {t('home.trustBadge2')}</span>
                <span className="flex items-center gap-1.5"><Lock className="h-4 w-4 text-success" /> {t('home.trustBadge3')}</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
            >
              <BoostConfigurator />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section className="py-28 bg-bg-surface">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <p className="section-label mb-3">{t('home.services.sectionLabel')}</p>
            <h2 className="text-4xl md:text-5xl font-black text-ink">{t('home.services.title')}</h2>
            <p className="mt-4 text-ink-secondary text-lg max-w-xl mx-auto">{t('home.services.desc')}</p>
          </motion.div>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5">
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
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-28 bg-bg-base relative overflow-hidden">
        <div className="absolute inset-0 bg-grid pointer-events-none opacity-40" />
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 relative">
          <div className="text-center mb-16">
            <p className="section-label mb-3">{t('home.howItWorks.sectionLabel')}</p>
            <h2 className="text-4xl md:text-5xl font-black text-ink">{t('home.howItWorks.title')}</h2>
          </div>
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

      {/* ── SECURITY / EXTRAS ── */}
      <section className="py-28 bg-bg-surface">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <motion.div
              initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.5 }}
            >
              <p className="section-label mb-4">{t('home.trust.sectionLabel')}</p>
              <h2 className="text-4xl md:text-5xl font-black text-ink mb-6 leading-tight">
                {t('home.trust.title')}
              </h2>
              <p className="text-ink-secondary text-lg mb-8 leading-relaxed">
                {t('home.trust.desc')}
              </p>
              <div className="space-y-3 mb-8">
                {[
                  t('home.trust.point1'),
                  t('home.trust.point2'),
                  t('home.trust.point3'),
                  t('home.trust.point4'),
                ].map(item => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    <span className="text-ink-secondary">{item}</span>
                  </div>
                ))}
              </div>
              <Button asChild size="lg">
                <Link to="/security">{t('home.trust.policy')}</Link>
              </Button>
            </motion.div>

            <div className="grid grid-cols-2 gap-4">
              {EXTRAS.map(({ icon: Icon, label, desc }, i) => (
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
      </section>

      {/* ── BOOSTER RECRUITMENT ── */}
      <section className="py-28 bg-bg-surface">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.5 }}
            >
              <p className="section-label mb-4">{t('home.boosterRecruit.sectionLabel')}</p>
              <h2 className="text-4xl md:text-5xl font-black text-ink mb-6 leading-tight">
                {t('home.boosterRecruit.title')}
              </h2>
              <p className="text-ink-secondary text-lg mb-8 leading-relaxed">
                {t('home.boosterRecruit.desc')}
              </p>
              <div className="grid grid-cols-2 gap-4 mb-8">
                {[
                  { stat: 'R$15–R$80', label: t('home.boosterRecruit.perOrder')      },
                  { stat: '72h',     label: t('home.boosterRecruit.avgPayment')     },
                  { stat: '80+',     label: t('home.boosterRecruit.activeBoosters') },
                  { stat: '4.9★',   label: t('home.boosterRecruit.avgRating')      },
                ].map(({ stat, label }) => (
                  <div key={label} className="card p-4">
                    <p className="text-2xl font-extrabold text-brand">{stat}</p>
                    <p className="text-xs text-ink-muted mt-1">{label}</p>
                  </div>
                ))}
              </div>
              <Button asChild size="lg" variant="secondary">
                <Link to="/apply">{t('home.boosterRecruit.apply')} <ArrowRight className="h-5 w-5" /></Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }}
              className="card p-8 space-y-6"
            >
              <h3 className="text-lg font-bold text-ink">{t('home.boosterRecruit.requirements')}</h3>
              {[
                { icon: '🏆', title: t('home.boosterRecruit.req1Title'), sub: t('home.boosterRecruit.req1Sub') },
                { icon: '🎮', title: t('home.boosterRecruit.req2Title'), sub: t('home.boosterRecruit.req2Sub') },
                { icon: '⏰', title: t('home.boosterRecruit.req3Title'), sub: t('home.boosterRecruit.req3Sub') },
                { icon: '💬', title: t('home.boosterRecruit.req4Title'), sub: t('home.boosterRecruit.req4Sub') },
              ].map(({ icon, title, sub }) => (
                <div key={title} className="flex gap-4">
                  <span className="text-2xl shrink-0">{icon}</span>
                  <div>
                    <p className="font-semibold text-ink text-sm">{title}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{sub}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-28 bg-bg-base relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-glow opacity-80 pointer-events-none" />
        <div className="absolute inset-0 bg-grid opacity-50 pointer-events-none" />
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.55 }}
          >
            <h2 className="text-4xl md:text-6xl font-black text-ink mb-6 leading-tight">
              {t('home.cta.title')}
            </h2>
            <p className="text-ink-secondary text-xl mb-10">
              {t('home.cta.desc')}
            </p>
            <Button asChild size="xl">
              <Link to="/orders/new">
                {t('home.cta.button')} <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
