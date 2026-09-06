import { Sparkles, Swords, Users } from 'lucide-react'

export interface SlotInfo {
  solo_count: number
  duo_count: number
  total_count: number
  max_total: number
  is_top3: boolean
  exclusive_slot_used: boolean
  max_exclusive: number
}

export function SlotIndicator({ slots }: { slots: SlotInfo }) {
  const { solo_count, duo_count, total_count, max_total, is_top3, exclusive_slot_used } = slots
  const remaining = max_total - total_count
  const color = remaining === 0 ? 'text-danger' : remaining === 1 ? 'text-warning' : 'text-success'

  return (
    <div className="flex items-center gap-3 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl px-4 py-2.5">
      {is_top3 && (
        <span className="text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2 py-0.5 uppercase tracking-wide">
          TOP 3
        </span>
      )}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-ink-muted">Slots:</span>
        <span className={`font-bold ${color}`}>{total_count}/{max_total}</span>
      </div>
      <div className="h-3 w-px bg-bg-raised" />
      <div className="flex items-center gap-2 text-[11px] text-ink-secondary">
        <span className="flex items-center gap-1">
          <Swords className="h-3 w-3" />
          Solo: {solo_count}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          Duo: {duo_count}
        </span>
      </div>
      <div className="h-3 w-px bg-bg-raised" />
      <span className={`flex items-center gap-1 text-[11px] font-medium ${exclusive_slot_used ? 'text-ink-muted' : 'text-accent'}`}>
        <Sparkles className="h-3 w-3" />
        Exclusivo: {exclusive_slot_used ? 1 : 0}/1
      </span>
    </div>
  )
}
