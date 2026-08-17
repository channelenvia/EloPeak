import { useEffect, useMemo, useState } from 'react'
import { Search, Clock, DollarSign, CheckCircle2, Star, SlidersHorizontal, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { LANES, COACH_SPECIALTIES, TEMPO_OPTIONS } from '@/lib/lolTaxonomy'
import { matchesCoachPackageFilters, activeFilterCount } from '@/lib/coachFilters'
import type { BoosterService } from '@/types'
import { useAllCoachingPackages, useCoachBoosterInfo } from '@/api/coaching'
import { MultiSelectPopover, CurrencyMaskedInput } from '@/components/ui'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'

const PAGE_SIZE = 9 // grade 3x3

const TEMPO_FILTER_OPTIONS = TEMPO_OPTIONS.map(t => ({ key: t, label: t }))

export function CoachPackagePicker() {
  const currency = useCurrency()
  const { selectedCoachPackage, setSelectedCoachPackage, setPreferredBooster, setBasePrice, preferredBoosterId } = useOrderBuilderStore()
  const [search, setSearch] = useState('')
  const [laneFilters, setLaneFilters] = useState<Set<string>>(new Set())
  const [specialtyFilters, setSpecialtyFilters] = useState<Set<string>>(new Set())
  const [tempoFilters, setTempoFilters] = useState<Set<string>>(new Set())
  const [priceMinCents, setPriceMinCents] = useState(0)
  const [priceMaxCents, setPriceMaxCents] = useState(0)
  const [page, setPage] = useState(1)

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
    setTempoFilters(new Set())
    setPriceMinCents(0)
    setPriceMaxCents(0)
  }

  // "0" nos campos de preço significa "sem filtro" nesse ponto -- ninguém
  // define um teto de R$0,00 de propósito, e um piso de R$0,00 equivale a
  // não ter piso mesmo.
  const priceMin = priceMinCents > 0 ? priceMinCents / 100 : null
  const priceMax = priceMaxCents > 0 ? priceMaxCents / 100 : null

  const activeCount = activeFilterCount({ lanes: laneFilters, specialties: specialtyFilters, tempo: tempoFilters, priceMin, priceMax })
  const hasAnyFilter = activeCount > 0 || search.trim().length > 0

  const { data: allPackages = [], isLoading } = useAllCoachingPackages()

  // A grade sempre mostra os pacotes de TODOS os coaches -- filtrar só pelos
  // campos da caixa de Filtros abaixo (busca/rotas/especialidades/duração/
  // preço). Escolher um pacote ainda vincula o pedido ao booster dono dele
  // (selectPackage chama setPreferredBooster, pro pedido ser criado certo),
  // mas isso não deve estreitar a lista visível -- antes, selecionar
  // qualquer pacote fazia a grade "sumir" com todos os outros boosters no
  // clique seguinte, o que não é o que o cliente pediu ao navegar aqui.
  const packages = allPackages

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
      { search, lanes: laneFilters, specialties: specialtyFilters, tempo: tempoFilters, priceMin, priceMax },
    ),
  )

  // Qualquer mudança de filtro/busca volta pra primeira página -- manter a
  // página atual faria o usuário "sumir" numa página vazia depois de refinar.
  useEffect(() => {
    setPage(1)
  }, [search, laneFilters, specialtyFilters, tempoFilters, priceMin, priceMax, preferredBoosterId])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function selectPackage(p: BoosterService) {
    const boosterName = boosterMap[p.booster_id]?.display_name ?? 'Booster'
    setSelectedCoachPackage({
      id: p.id, title: p.title, price: p.price, tempo: p.tempo,
      description: p.description, requirements: p.requirements,
      lanes: p.lanes, specialties: p.specialties, champions: p.champions,
    })
    setPreferredBooster(p.booster_id, boosterName)
    setBasePrice(p.price)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink mb-1">Escolha um Pacote de Coach</h2>
        <p className="text-sm text-ink-secondary">
          Busque e filtre entre os pacotes de todos os coaches disponíveis.
        </p>
      </div>

      {/* Caixa de filtros */}
      <div className="rounded-2xl border border-border-subtle bg-bg-card/40 p-4 space-y-3.5">
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

        {/* Busca por nome — filtro principal, texto livre (cobre título,
            descrição, nome do coach e champions) */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome do coach, título, descrição ou champion..."
            className="input-base pl-9 w-full text-sm"
          />
        </div>

        {/* Rotas, Especialidades e Duração — popovers de multi-seleção (OU
            dentro de cada um), filtram automaticamente a cada marcação, sem
            botão de aplicar. Espelham exatamente os campos do formulário de
            cadastro de serviço do booster (ServiceFormData). */}
        <div className="flex flex-wrap gap-2">
          <MultiSelectPopover label="Rotas" options={LANES} selected={laneFilters} onToggle={(key) => toggleIn(setLaneFilters, key)} />
          <MultiSelectPopover label="Especialidades" options={COACH_SPECIALTIES} selected={specialtyFilters} onToggle={(key) => toggleIn(setSpecialtyFilters, key)} />
          <MultiSelectPopover label="Duração" options={TEMPO_FILTER_OPTIONS} selected={tempoFilters} onToggle={(key) => toggleIn(setTempoFilters, key)} />
        </div>

        {/* Faixa de preço */}
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-ink-muted shrink-0" />
          <span className="text-xs font-medium text-ink-secondary shrink-0">Preço:</span>
          <CurrencyMaskedInput valueCents={priceMinCents} onChangeCents={setPriceMinCents} className="text-sm" aria-label="Preço mínimo" />
          <span className="text-xs text-ink-muted shrink-0">até</span>
          <CurrencyMaskedInput valueCents={priceMaxCents} onChangeCents={setPriceMaxCents} className="text-sm" aria-label="Preço máximo" />
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <p className="text-sm text-ink-muted py-6 text-center">Carregando pacotes...</p>
      ) : !filtered.length ? (
        <p className="text-sm text-ink-muted py-6 text-center">Nenhum pacote encontrado com esses filtros.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pageItems.map(p => {
              const booster = boosterMap[p.booster_id]
              const selected = selectedCoachPackage?.id === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPackage(p)}
                  className={cn(
                    'rounded-2xl border-2 overflow-hidden flex flex-col transition-all',
                    selected
                      ? 'border-brand bg-brand/10'
                      : 'border-border-subtle bg-bg-card hover:border-brand/30',
                  )}
                >
                  <div className="h-1 bg-success shrink-0" />
                  <div className="text-left p-4 flex flex-col gap-2 flex-1">
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
                          <span className="text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2 py-0.5 uppercase tracking-wide">Top 3</span>
                        )}
                      </div>
                    )}
                    {p.description && (
                      <p className="text-xs text-ink-secondary leading-relaxed line-clamp-2">{p.description}</p>
                    )}
                    <ServiceTagPills lanes={p.lanes} champions={p.champions} specialties={p.specialties} compact />
                    <div className="flex items-center gap-3 mt-auto pt-2 border-t border-border-subtle">
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
                  </div>
                </button>
              )
            })}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-4 pt-1">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Página anterior"
                className="p-1.5 rounded-lg text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-medium text-ink-secondary">Página {page} de {pageCount}</span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                aria-label="Próxima página"
                className="p-1.5 rounded-lg text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
