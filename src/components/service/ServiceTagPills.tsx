import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LANE_LABEL, LANE_ICON_URL, SPECIALTY_LABEL } from '@/lib/lolTaxonomy'
import { useDdragonVersion, useDdragonChampionIds, championIconUrl } from '@/lib/ddragon'

interface ServiceTagPillsProps {
  lanes?: string[] | null
  champions?: string[] | null
  specialties?: string[] | null
  /** Pills menores, sem borda -- pro grid denso de pacotes do CoachPackagePicker. */
  compact?: boolean
  /** Cada tipo (Rotas/Campeões/Especialidades) em sua própria linha rotulada, em vez de tudo misturado num flex-wrap só -- usado no modal "Visualizar serviço", que tem espaço de sobra. */
  labeled?: boolean
  className?: string
}

// Reaproveitado nos 5 lugares que exibem lanes/campeões/especialidades de um
// serviço (card do booster, perfil público, modal de visualizar, picker de
// coaching do cliente e revisão/detalhe do pedido) -- fonte única de ícone +
// estilo, pra não divergir entre telas.
export function ServiceTagPills({ lanes, champions, specialties, compact, labeled, className }: ServiceTagPillsProps) {
  const ddragonVersion = useDdragonVersion()
  const championIds = useDdragonChampionIds(ddragonVersion)
  if (!lanes?.length && !champions?.length && !specialties?.length) return null

  const pillCls = cn(
    'font-bold flex items-center gap-1.5',
    labeled
      ? 'text-sm px-3 py-1.5 rounded-full'
      : compact
        ? 'text-[11px] px-2 py-1 rounded-md'
        : 'text-xs px-2.5 py-1 rounded-full',
  )

  const laneNodes = lanes?.map(l => {
    const iconUrl = LANE_ICON_URL[l]
    return (
      <span key={l} className={cn(pillCls, 'bg-brand/10 text-brand', !compact && 'border border-brand/20')}>
        {iconUrl && (
          <img
            src={iconUrl}
            alt=""
            className={cn('shrink-0', labeled ? 'h-4 w-4' : 'h-3.5 w-3.5')}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        {LANE_LABEL[l] ?? l}
      </span>
    )
  })

  const championNodes = champions?.map(c => {
    // Aguarda o catálogo para não tentar primeiro uma URL inválida baseada no
    // texto livre e esconder a imagem antes da resolução do id canônico.
    const iconUrl = championIds ? championIconUrl(c, ddragonVersion, championIds) : null
    return (
      <span key={c} className={cn(pillCls, 'font-medium bg-accent/10 text-accent', !compact && 'border border-accent/20')}>
        {iconUrl && (
          <img
            src={iconUrl}
            alt=""
            className={cn('rounded-full object-cover shrink-0', labeled ? 'h-4 w-4' : 'h-3.5 w-3.5')}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        {c}
      </span>
    )
  })

  const specialtyNodes = specialties?.map(s => (
    <span key={s} className={cn(pillCls, 'font-medium bg-bg-elevated', compact ? 'text-ink-muted' : 'text-ink-secondary')}>
      <Sparkles className={cn('shrink-0', labeled ? 'h-4 w-4' : 'h-3.5 w-3.5')} />{SPECIALTY_LABEL[s] ?? s}
    </span>
  ))

  if (!labeled) {
    return (
      <div className={cn('flex flex-wrap gap-1.5', compact && 'gap-1', className)}>
        {laneNodes}{championNodes}{specialtyNodes}
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {!!lanes?.length && (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Rotas</p>
          <div className="flex flex-wrap gap-1.5">{laneNodes}</div>
        </div>
      )}
      {!!champions?.length && (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Campeões</p>
          <div className="flex flex-wrap gap-1.5">{championNodes}</div>
        </div>
      )}
      {!!specialties?.length && (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Especialidades</p>
          <div className="flex flex-wrap gap-1.5">{specialtyNodes}</div>
        </div>
      )}
    </div>
  )
}
