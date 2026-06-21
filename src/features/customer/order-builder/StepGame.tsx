import { useQuery } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { cn } from '@/lib/utils'
import type { GameSlug } from '@/types'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Skeleton } from '@/components/ui'

const EMOJI_MAP: Record<string, string> = {
  lol: '⚔️',
  valorant: '🔫',
  tft: '♟️',
}

export function StepGame() {
  const { gameSlug, setGame } = useOrderBuilderStore()

  const { data: games = [], isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('games')
        .select('id, slug, name, is_active, sort_order')
        .order('sort_order')
      if (error) throw error
      return data as { id: string; slug: GameSlug; name: string; is_active: boolean; sort_order: number }[]
    },
    staleTime: 1000 * 60 * 10,
  })

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Selecionar Jogo</h2>
      <p className="text-sm text-ink-secondary mb-6">
        Escolha o jogo que você quer contratar.
      </p>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {games.map(({ id, slug, name, is_active }) => (
            <button
              key={slug}
              onClick={() => is_active && setGame(slug, id)}
              disabled={!is_active}
              className={cn(
                'relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 text-left transition-all duration-150',
                gameSlug === slug
                  ? 'border-brand bg-brand-muted shadow-brand'
                  : is_active
                    ? 'border-bg-elevated bg-bg-card hover:border-brand/40 hover:bg-bg-elevated cursor-pointer'
                    : 'border-bg-elevated bg-bg-card opacity-50 cursor-not-allowed'
              )}
            >
              {gameSlug === slug && (
                <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-brand" />
              )}
              <span className="text-4xl">{EMOJI_MAP[slug] ?? '🎮'}</span>
              <div className="text-center">
                <p className={cn('text-sm font-semibold', gameSlug === slug ? 'text-brand' : 'text-ink')}>{name}</p>
                {!is_active && <p className="text-xs text-ink-muted mt-0.5">Em breve</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
