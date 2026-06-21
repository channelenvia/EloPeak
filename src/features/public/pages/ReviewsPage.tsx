import { Star } from 'lucide-react'

const REVIEWS = [
  { name: 'Alex M.', rank: 'Gold → Platinum', rating: 5, comment: 'Incredibly smooth experience. My booster hit Platinum in just 2 days and kept me updated the whole time.' },
  { name: 'TurboKai', rank: 'Silver → Diamond', rating: 5, comment: 'Went from Silver to Diamond in one week. Used the coaching add-on too — completely changed how I play.' },
  { name: 'Sarah V.', rank: 'Iron → Gold', rating: 5, comment: 'Was skeptical at first but the service was legit. Fast, safe, and great communication throughout.' },
  { name: 'NightFury99', rank: 'Bronze → Platinum', rating: 5, comment: 'Used the live stream feature and watched every game. My booster was absolutely cracked. 10/10.' },
  { name: 'CosmicPlayer', rank: 'Platinum → Diamond', rating: 5, comment: 'Second time using this service. They just keep getting better. Booster was responsive and fast.' },
  { name: 'JaxMain', rank: 'Gold → Emerald', rating: 4, comment: 'Took a bit longer than expected but the booster communicated great. Happy with the result.' },
  { name: 'CryptoADC', rank: 'Silver → Gold', rating: 5, comment: 'Ordered late at night and the booster had already started by morning. Insane speed.' },
  { name: 'VoidWalker_', rank: 'Diamond → Master', rating: 5, comment: 'The high-elo service is no joke. Challenger-level booster, impeccable winrate. Very impressed.' },
  { name: 'MidOrFeed22', rank: 'Bronze → Gold', rating: 5, comment: 'Not just boosted my account but learned a lot watching my booster via the stream feature.' },
]

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i < rating ? 'fill-accent text-accent' : 'text-ink-muted'}`} />
      ))}
    </div>
  )
}

export function ReviewsPage() {
  const avg = (REVIEWS.reduce((sum, r) => sum + r.rating, 0) / REVIEWS.length).toFixed(1)

  return (
    <div className="py-16">
      <div className="container-app max-w-5xl space-y-12">
        <div className="text-center">
          <p className="section-label mb-3">Verified customers</p>
          <h1 className="text-4xl font-extrabold text-ink mb-2">Customer Reviews</h1>
          <div className="flex items-center justify-center gap-3 mt-4">
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-5 w-5 fill-accent text-accent" />
              ))}
            </div>
            <span className="text-2xl font-bold text-ink">{avg}</span>
            <span className="text-ink-secondary">/ 5 from {REVIEWS.length} reviews</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {REVIEWS.map(({ name, rank, rating, comment }) => (
            <div key={name} className="card p-5 space-y-4">
              <StarRating rating={rating} />
              <p className="text-sm text-ink-secondary leading-relaxed">"{comment}"</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{name}</p>
                <span className="text-xs text-brand font-medium bg-brand-muted px-2 py-0.5 rounded-full">{rank}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
