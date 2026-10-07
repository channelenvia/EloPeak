import { specialtyIcon } from './specialtyIcon'
import { cn } from '@/lib/utils'
import { ALL_LANES_LABEL, LANES, LANE_LABEL, LANE_ICON_URL, SPECIALTY_LABEL, hasAllLanes } from '@/lib/lolTaxonomy'
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
  /** Texto mostrado no lugar de sumir o bloco quando não há nada pra exibir --
   * usado nas linhas de rota do pedido (customer_lanes agora é opcional, então
   * ausência de escolha é um estado válido, "---", não "nada aqui"). */
  emptyFallback?: string
  /** Texto da pill única quando as 5 rotas estão presentes (padrão: "Todas as rotas"). */
  allLabel?: string
}

// Reaproveitado nos 5 lugares que exibem lanes/campeões/especialidades de um
// serviço (card do booster, perfil público, modal de visualizar, picker de
// coaching do cliente e revisão/detalhe do pedido) -- fonte única de ícone +
// estilo, pra não divergir entre telas.
export function ServiceTagPills({ lanes, champions, specialties, compact, labeled, className, emptyFallback, allLabel = ALL_LANES_LABEL }: ServiceTagPillsProps) {
  const ddragonVersion = useDdragonVersion()
  const championIds = useDdragonChampionIds(ddragonVersion)
  if (!lanes?.length && !champions?.length && !specialties?.length) {
    return emptyFallback ? <span className={cn('text-ink-muted', className)}>{emptyFallback}</span> : null
  }

  const pillCls = cn(
    'font-bold flex items-center gap-1.5',
    labeled
      ? 'text-sm px-3 py-1.5 rounded-full'
      : compact
        ? 'text-xs px-2 py-1 rounded-md'
        : 'text-xs px-2.5 py-1 rounded-full',
  )

  const laneIconCls = cn('shrink-0', labeled ? 'h-4 w-4' : 'h-3.5 w-3.5')
  const laneIcon = (key: string) => LANE_ICON_URL[key] && (
    <img
      key={key}
      src={LANE_ICON_URL[key]}
      alt=""
      className={laneIconCls}
      loading="lazy"
      onError={(e) => { e.currentTarget.style.display = 'none' }}
    />
  )
  const lanePillCls = cn(pillCls, 'bg-success/10 text-success', !compact && 'border border-success/20')

  // As 5 rotas = "sem restrição": uma pill só, com os 5 ícones juntos e o
  // texto, em vez de 5 pills com o mesmo peso visual.
  const laneNodes = hasAllLanes(lanes)
    ? [
      <span key="all" className={lanePillCls}>
        <span className="flex items-center gap-1">{LANES.map((l) => laneIcon(l.key))}</span>
        {allLabel}
      </span>,
    ]
    : lanes?.map(l => (
      <span key={l} className={lanePillCls}>
        {laneIcon(l)}
        {LANE_LABEL[l] ?? l}
      </span>
    ))

  const championNodes = champions?.map(c => {
    // Aguarda o catálogo para não tentar primeiro uma URL inválida baseada no
    // texto livre e esconder a imagem antes da resolução do id canônico.
    const iconUrl = championIds ? championIconUrl(c, ddragonVersion, championIds) : null
    return (
      <span key={c} className={cn(pillCls, 'font-medium bg-warning/10 text-warning', !compact && 'border border-warning/20')}>
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

  const specialtyNodes = specialties?.map(s => {
    const Icon = specialtyIcon(s)
    return (
      <span key={s} className={cn(pillCls, 'font-medium bg-bg-raised', compact ? 'text-ink-muted' : 'text-ink-secondary')}>
        <Icon className={cn('shrink-0', labeled ? 'h-4 w-4' : 'h-3.5 w-3.5')} />{SPECIALTY_LABEL[s] ?? s}
      </span>
    )
  })

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
