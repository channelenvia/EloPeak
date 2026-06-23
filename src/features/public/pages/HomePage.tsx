import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Shield, Zap, Clock, Users, ChevronRight,
  TrendingUp, MessageCircle, CheckCircle2,
  ArrowRight, Lock, Trophy, Star,
} from 'lucide-react'
import { Button, RankBadge } from '@/components/ui'
import { RANK_TIER_ORDER } from '@/lib/utils'

// ─── Main page ────────────────────────────────────────────────────────────────

export function HomePage() {
  const { t } = useTranslation()

  const STATS = [
    { value: '48.200+', label: t('home.stats.ordersCompleted') },
    { value: '4,94★',   label: t('home.stats.avgRating')       },
    { value: '88%',     label: t('home.stats.winRate')          },
    { value: '340+',    label: t('home.stats.activeBoosters')   },
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
      icon: Trophy,
      title: t('home.services.placementsTitle'),
      href: '/orders/new?service=placement_matches',
      badge: null,
      color: 'text-rank-grandmaster bg-rank-grandmaster/10',
      desc: t('home.services.placementsDesc'),
    },
  ]

  const TRUST_FEATURES = [
    { icon: Lock,          label: t('home.extras.vpnLabel'),       desc: t('home.extras.vpnDesc')       },
    { icon: MessageCircle, label: t('home.extras.chatLabel'),      desc: t('home.extras.chatDesc')      },
    { icon: Star,          label: t('home.extras.guaranteeLabel'), desc: t('home.extras.guaranteeDesc') },
    { icon: Clock,         label: 'Início rápido',                 desc: 'Seu pedido é atribuído em até 30 minutos após o pagamento.' },
  ]

  const INCLUDED = [
    'Boosters Grão-mestre ou acima',
    'VPN ativado em cada partida',
    'Conta offline durante todo o serviço',
    'Chat em PT-BR com o booster',
    'Início garantido em até 30 minutos',
    'Garantia 100% de conclusão',
  ]

  return (
    <div>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[92vh] flex items-center bg-bg-base overflow-hidden">
        <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
        <div className="absolute inset-0 bg-grid pointer-events-none opacity-60" />
        <div className="absolute -top-60 right-0 w-[700px] h-[700px] rounded-full bg-brand/6 blur-[140px] pointer-events-none" />

        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 w-full py-20">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">

            {/* Left — copy */}
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

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mb-10">
                {STATS.map(({ value, label }) => (
                  <div key={label}>
                    <p className="text-2xl font-extrabold text-ink">{value}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/orders/new">
                    Começar Agora <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link to="/apply">Seja Booster</Link>
                </Button>
              </div>
            </motion.div>

            {/* Right — features card */}
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="card p-7 space-y-6 border-brand/15 shadow-glow"
            >
              {/* Live indicator */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  <span className="text-xs font-bold text-success">340+ boosters disponíveis</span>
                </div>
                <span className="text-[10px] font-semibold text-ink-muted bg-bg-elevated px-2 py-1 rounded-lg">
                  League of Legends
                </span>
              </div>

              {/* Included features */}
              <div>
                <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-4">
                  Incluso em todo pedido
                </p>
                <div className="space-y-3">
                  {INCLUDED.map(item => (
                    <div key={item} className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      <span className="text-sm text-ink-secondary">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rank strip */}
              <div className="border-t border-bg-elevated pt-5">
                <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">
                  Atendemos todos os ranks
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {RANK_TIER_ORDER.map(tier => (
                    <RankBadge key={tier} tier={tier} size="xs" showDivision={false} showLabel={false} />
                  ))}
                </div>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ── SERVICES ─────────────────────────────────────────────────────── */}
      <section id="services" className="py-28 bg-bg-surface scroll-mt-20">
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
      <section className="py-28 bg-bg-base relative overflow-hidden">
        <div className="absolute inset-0 bg-grid pointer-events-none opacity-40" />
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-16"
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

          <motion.div
            initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.4 }}
            className="mt-14 text-center"
          >
            <Button asChild size="lg">
              <Link to="/orders/new">
                Começar agora <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ── TRUST & SECURITY ─────────────────────────────────────────────── */}
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
              <Button asChild size="lg" variant="secondary">
                <Link to="/security">{t('home.trust.policy')}</Link>
              </Button>
            </motion.div>

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
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="py-28 bg-bg-surface relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-glow opacity-60 pointer-events-none" />
        <div className="absolute inset-0 bg-grid opacity-40 pointer-events-none" />
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
