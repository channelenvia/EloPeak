import { Link } from 'react-router-dom'
import { TrendingUp, Zap, Users, Award, CheckCircle2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui'

const SERVICES = [
  {
    icon: TrendingUp,
    slug: 'elo_boost',
    title: 'Elo Boost',
    tagline: 'Rank up to your desired division.',
    description:
      'Our boosters play on your account (or duo with you) and climb from your current rank to your desired division. You choose the queue type, champion preferences, and extras.',
    highlights: [
      'Solo or duo boosting',
      'Any rank — Iron to Challenger',
      'All servers supported',
      'Appearance offline available',
      'VPN protection on every game',
    ],
    color: 'text-brand',
    bgColor: 'bg-brand-muted',
    cta: '/orders/new?service=elo_boost',
  },
  {
    icon: Zap,
    slug: 'win_boost',
    title: 'Win Boost',
    tagline: 'Buy a set number of wins fast.',
    description:
      'Perfect for earning LP fast, completing missions, or climbing before a ranked reset. Choose how many wins you need and we handle the rest.',
    highlights: [
      'Choose 1 to 50 wins',
      'Solo queue or flex',
      'Starts within 30 minutes',
      'Best value per LP gain',
    ],
    color: 'text-accent',
    bgColor: 'bg-accent/10',
    cta: '/orders/new?service=win_boost',
  },
  {
    icon: Users,
    slug: 'coaching',
    title: 'Coaching',
    tagline: 'Learn from the best, improve permanently.',
    description:
      'Live 1-on-1 sessions with high-ELO coaches. VOD review, live gameplay coaching, champion fundamentals, macro strategy, and mental game — all covered.',
    highlights: [
      '1h / 2h session options',
      'VOD review included',
      'Coach matched to your main role',
      'Custom improvement roadmap',
    ],
    color: 'text-success',
    bgColor: 'bg-success/10',
    cta: '/orders/new?service=coaching',
  },
  {
    icon: Award,
    slug: 'placement_matches',
    title: 'Placement Matches',
    tagline: 'Start your season at the top.',
    description:
      'Let our professionals handle your placement matches to ensure you start the season in the highest possible rank. Includes MMR optimization.',
    highlights: [
      'Full placements handled',
      'MMR pre-boost available',
      'Season start specialists',
      'Champion pool discussion',
    ],
    color: 'text-rank-grandmaster',
    bgColor: 'bg-rank-grandmaster/10',
    cta: '/orders/new?service=placement_matches',
  },
]

const EXTRAS = [
  { name: 'Priority Queue', desc: 'Your order goes to the front of the queue and is assigned to a top-rated booster.' },
  { name: 'Solo Only', desc: 'Booster plays only in SoloQ, never in flex or duo lobbies.' },
  { name: 'Mono Champion', desc: 'Request a specific champion for every game.' },
  { name: 'Live Stream', desc: 'Watch your booster play in real-time via a private stream link.' },
  { name: 'Live Monitoring', desc: 'Dedicated staff monitors your order and provides updates every few hours.' },
  { name: 'Appearance Offline', desc: 'Booster sets your account to appear offline throughout the service.' },
]

export function ServicesPage() {
  return (
    <div className="py-16">
      <div className="container-app space-y-20">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="section-label mb-3">League of Legends</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">All Services</h1>
          <p className="text-lg text-ink-secondary">
            Every service uses verified boosters, full account security, and a completion guarantee.
          </p>
        </div>

        {/* Services grid */}
        <div className="space-y-8">
          {SERVICES.map(({ icon: Icon, title, tagline, description, highlights, color, bgColor, cta }) => (
            <div key={title} className="card p-8 flex flex-col md:flex-row gap-8">
              <div className="md:w-2/5 space-y-4">
                <div className={`h-12 w-12 rounded-2xl ${bgColor} flex items-center justify-center`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-ink">{title}</h2>
                  <p className={`text-sm font-semibold mt-1 ${color}`}>{tagline}</p>
                </div>
                <p className="text-ink-secondary leading-relaxed">{description}</p>
                <Button asChild>
                  <Link to={cta}>
                    Order {title} <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="md:w-3/5">
                <p className="section-label mb-3">What's included</p>
                <ul className="space-y-2.5">
                  {highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2.5">
                      <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                      <span className="text-sm text-ink-secondary">{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Premium extras */}
        <div>
          <div className="text-center mb-8">
            <p className="section-label mb-2">Upgrades</p>
            <h2 className="text-2xl font-bold text-ink">Premium Add-ons</h2>
            <p className="text-ink-secondary mt-2">Add to any order during checkout.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXTRAS.map(({ name, desc }) => (
              <div key={name} className="card p-4 space-y-2">
                <p className="text-sm font-semibold text-ink">{name}</p>
                <p className="text-xs text-ink-secondary leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
