import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FormField } from '@/components/ui/FormField'
import { InlineFieldSelect } from '@/components/ui'
import type { QueueType } from '@/types'

const QUEUE_TYPE_OPTIONS: readonly [QueueType, QueueType] = ['solo_duo', 'flex']
const queueTypeLabel = (q: QueueType) => (q === 'solo_duo' ? 'Solo/Duo' : 'Flex')

// Campo Riot ID compartilhado entre elo_boost e win_boost/md5 (mesma
// estrutura nos dois fluxos, só troca o handler de verificação e as
// mensagens de baixo) -- card com glow reagindo ao estado (neutro / erro /
// verificado) em vez de um input solto, consistente com os outros cards
// desta página.
export function RiotIdField({
  queueType, onQueueTypeChange,
  riotId, onRiotIdChange,
  onVerify, loading, verified, error,
  children,
}: {
  queueType: QueueType
  onQueueTypeChange: (queue: QueueType) => void
  riotId: string
  onRiotIdChange: (value: string) => void
  onVerify: () => void
  loading: boolean
  verified: boolean
  error?: string
  children?: React.ReactNode
}) {
  return (
    <FormField error={error}>
      <div
        className={cn(
          'rounded-2xl border p-4 transition-colors duration-200',
          error
            ? 'border-danger/40 bg-danger/5'
            : verified
              ? 'border-brand/40 bg-brand/5 shadow-brand'
              : 'border-border-subtle bg-bg-surface/60',
        )}
      >
        {/* Rótulo dentro do card, no mesmo padrão dos cabeçalhos de coluna
            de Rank/Vitórias mais abaixo (uppercase, micro, top-left) --
            antes vinha de fora via FormField, deslocado do conteúdo que
            rotula. */}
        <div className="flex items-center justify-between mb-3">
          <label htmlFor="order-riot-id-input" className="text-2xs font-bold uppercase tracking-widest text-ink-muted">
            Riot ID<span className="text-danger ml-0.5">*</span>
          </label>
          {verified && (
            <span className="inline-flex items-center gap-1 text-2xs font-bold uppercase tracking-widest text-success">
              <Check className="h-3 w-3" />
              Verificado
            </span>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              id="order-riot-id-input"
              type="text"
              value={riotId}
              onChange={e => onRiotIdChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onVerify()
                }
              }}
              placeholder="NomeDoInvocador#TAG"
              className="input-base w-full pr-[8.5rem]"
              maxLength={32}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <InlineFieldSelect
                value={queueType}
                options={QUEUE_TYPE_OPTIONS}
                label={queueTypeLabel}
                onChange={onQueueTypeChange}
                fieldLabel="tipo de fila"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onVerify}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-ink-inverse bg-gradient-brand transition-all hover:shadow-brand disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Search className="h-4 w-4" />
            {loading ? 'Consultando…' : 'Verificar elo'}
          </button>
        </div>
        {children}
      </div>
    </FormField>
  )
}
