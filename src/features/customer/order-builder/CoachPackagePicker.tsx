import { useMemo, useState } from 'react'
import { Search, Clock, DollarSign, CheckCircle2, Star, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { LANES, LANE_LABEL, COACH_SPECIALTIES, SPECIALTY_LABEL } from '@/lib/lolTaxonomy'
import { matchesCoachPackageFilters, activeFilterCount } from '@/lib/coachFilters'
import type { BoosterService } from '@/types'
import { useAllCoachingPackages, useCoachBoosterInfo } from '@/api/coaching'
import { MultiSelectPopover } from '@/components/ui'

export function CoachPackagePicker() {
  const currency = useCurrency()
  const { selectedCoachPackage, setSelectedCoachPackage, setPreferredBooster, setBasePrice, preferredBoosterId } = useOrderBuilderStore()
  const [search, setSearch] = useState('')
  const [laneFilters, setLaneFilters] = useState<Set<string>>(new Set())
  const [specialtyFilters, setSpecialtyFilters] = useState<Set<string>>(new Set())

  function toggleIn(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearFilters() {
    setSearch('')
    setLaneFilters(new Set())
    setSpecialtyFilters(new Set())
  }

  const activeCount = activeFilterCount({ lanes: laneFilters, specialties: specialtyFilters })
  const hasAnyFilter = activeCount > 0 || search.trim().length > 0

  const { data: allPackages = [], isLoading } = useAllCoachingPackages()

  // Pedido vinculado a um booster específico (link direto, perfil público ou
  // pacote escolhido antes de trocar pra este serviço) -- só os pacotes de
  // coaching desse booster aparecem. Desvincula pelo x do banner
  // (OrderBuilder.tsx clearPreferredBooster), nunca daqui.
  const packages = useMemo(
    () => preferredBoosterId ? allPackages.filter(p => p.booster_id === preferredBoosterId) : allPackages,
    [allPackages, preferredBoosterId],
  )

  const boosterIds = useMemo(() => [...new Set(packages.map(p => p.booster_id))], [packages])

  const { data: boosters = [] } = useCoachBoosterInfo(boosterIds)

  const boosterMap = useMemo(
    () => Object.fromEntries(boosters.map(b => [b.user_id, b])),
    [boosters],
  )

  const filtered = packages.filter(p =>
    matchesCoachPackageFilters(
      p,
      boosterMap[p.booster_id]?.display_name ?? '',
      { search, lanes: laneFilters, specialties: specialtyFilters },
    ),
  )

  function selectPackage(p: BoosterService) {
    const boosterName = boosterMap[p.booster_id]?.display_name ?? 'Booster'
    setSelectedCoachPackage({
      id: p.id, title: p.title, price: p.price, tempo: p.tempo,
      description: p.description, requirements: p.requirements,
    })
    setPreferredBooster(p.booster_id, boosterName)
    setBasePrice(p.price)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink mb-1">Escolha um Pacote de Coach</h2>
        <p className="text-sm text-ink-secondary">
          {preferredBoosterId
            ? 'Mostrando apenas os pacotes do booster vinculado a este pedido.'
            : 'Busque e filtre entre os pacotes de todos os coaches disponíveis.'}
        </p>
      </div>

      {/* Caixa de filtros */}
      <div className="rounded-2xl border border-bg-elevated bg-bg-card/40 p-4 space-y-3.5">
        {/* Cabeçalho: título + contador + limpar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-brand" />
            <span className="text-sm font-bold text-ink">Filtros</span>
            {activeCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand/15 text-brand">
                {activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}
              </span>
            )}
          </div>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-3 w-3" /> Limpar
            </button>
          )}
        </div>

        {/* Busca por nome — filtro principal, texto livre */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome do coach, título ou descrição..."
            className="input-base pl-9 w-full text-sm"
          />
        </div>

        {/* Rotas e Especialidades — popovers de multi-seleção (OU dentro de
            cada um), filtram automaticamente a cada marcação, sem botão de
            aplicar. */}
        <div className="flex flex-wrap gap-2">
          <MultiSelectPopover label="Rotas" options={LANES} selected={laneFilters} onToggle={(key) => toggleIn(setLaneFilters, key)} />
          <MultiSelectPopover label="Especialidades" options={COACH_SPECIALTIES} selected={specialtyFilters} onToggle={(key) => toggleIn(setSpecialtyFilters, key)} />
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <p className="text-sm text-ink-muted py-6 text-center">Carregando pacotes...</p>
      ) : !filtered.length ? (
        <p className="text-sm text-ink-muted py-6 text-center">Nenhum pacote encontrado com esses filtros.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map(p => {
            const booster = boosterMap[p.booster_id]
            const selected = selectedCoachPackage?.id === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPackage(p)}
                className={cn(
                  'text-left rounded-2xl border-2 p-4 flex flex-col gap-2 transition-all',
                  selected
                    ? 'border-brand bg-brand/10'
                    : 'border-bg-elevated bg-bg-card hover:border-brand/30',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-ink">{p.title}</p>
                  {selected && <CheckCircle2 className="h-4 w-4 text-brand shrink-0" />}
                </div>
                {booster && (
                  <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
                    <span>{booster.display_name}</span>
                    {booster.rating != null && (
                      <span className="flex items-center gap-0.5 text-ink-muted">
                        <Star className="h-3 w-3 fill-warning text-warning" />
                        {booster.rating.toFixed(1)}
                      </span>
                    )}
                    {booster.is_top3 && (
                      <span className="text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded px-1.5 py-0.5 uppercase">Top 3</span>
                    )}
                  </div>
                )}
                {p.description && (
                  <p className="text-xs text-ink-secondary leading-relaxed line-clamp-2">{p.description}</p>
                )}
                {(p.lanes?.length || p.specialties?.length) && (
                  <div className="flex flex-wrap gap-1">
                    {p.lanes?.map(l => (
                      <span key={l} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand">{LANE_LABEL[l] ?? l}</span>
                    ))}
                    {p.specialties?.map(s => (
                      <span key={s} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-elevated text-ink-muted">{SPECIALTY_LABEL[s] ?? s}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 mt-auto pt-2 border-t border-bg-elevated">
                  {p.tempo && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-ink-muted" />
                      <span className="text-[11px] text-ink-secondary">{p.tempo}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
                    <DollarSign className="h-3 w-3 text-brand" />
                    <span className="text-sm font-bold text-brand">{currency(p.price)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
