import { useEffect, useMemo, useState } from 'react'
import { InlineEmpty } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DollarSign, SlidersHorizontal, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { LANES, COACH_SPECIALTIES, TEMPO_OPTIONS } from '@/lib/lolTaxonomy'
import { matchesCoachPackageFilters, activeFilterCount } from '@/lib/coachFilters'
import type { BoosterService } from '@/types'
import { useAllCoachingPackages, useCoachBoosterInfo } from '@/api/coaching'
import { MultiSelectPopover, CurrencyMaskedInput, SearchInput } from '@/components/ui'
import { CoachProfileCard, CoachProfilePanel } from './CoachProfileCard'

const PAGE_SIZE = 9 // grade 3x3

const TEMPO_FILTER_OPTIONS = TEMPO_OPTIONS.map(t => ({ key: t, label: t }))

export function CoachPackagePicker() {
  const { selectedCoachPackage, setSelectedCoachPackage, setPreferredBooster, setBasePrice, preferredBoosterId, nextStep } = useOrderBuilderStore()
  const [openBoosterId, setOpenBoosterId] = useState<string | null>(null)
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

  const filtered = useMemo(
    () => packages.filter(p =>
      matchesCoachPackageFilters(
        p,
        boosterMap[p.booster_id]?.display_name ?? '',
        { search, lanes: laneFilters, specialties: specialtyFilters, tempo: tempoFilters, priceMin, priceMax },
      ),
    ),
    [packages, boosterMap, search, laneFilters, specialtyFilters, tempoFilters, priceMin, priceMax],
  )

  // Qualquer mudança de filtro/busca volta pra primeira página -- manter a
  // página atual faria o usuário "sumir" numa página vazia depois de refinar.
  useEffect(() => {
    setPage(1)
  }, [search, laneFilters, specialtyFilters, tempoFilters, priceMin, priceMax, preferredBoosterId])

  // Um card por coach, com só os pacotes que passaram nos filtros.
  const groups = useMemo(() => {
    const byBooster = new Map<string, BoosterService[]>()
    for (const p of filtered) byBooster.set(p.booster_id, [...(byBooster.get(p.booster_id) ?? []), p])
    return [...byBooster].map(([boosterId, pkgs]) => ({ boosterId, pkgs }))
  }, [filtered])

  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE))
  const openGroup = groups.find(g => g.boosterId === openBoosterId)
  const pageItems = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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

  function hirePackage(p: BoosterService) {
    selectPackage(p)
    setOpenBoosterId(null)
    nextStep()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink mb-1">Escolha um Pacote de Coach</h2>
        <p className="text-sm text-ink-secondary">
          Escolha um coach e veja os pacotes que ele oferece.
        </p>
      </div>

      {/* Caixa de filtros */}
      <div className="rounded-2xl border border-border-subtle bg-bg-surface/40 p-4 space-y-4">
        {/* Cabeçalho: título + contador + limpar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-brand" />
            <span className="text-sm font-bold text-ink">Filtros</span>
            {activeCount > 0 && (
              <Badge variant="brand">
                {activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}
              </Badge>
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
        <SearchInput
          size="md"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome do coach, título, descrição ou champion…"
          aria-label="Buscar pacotes de coach"
        />

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
        <p className="text-sm text-ink-muted py-6 text-center">Carregando pacotes…</p>
      ) : !filtered.length ? (
        <InlineEmpty>Nenhum pacote encontrado com esses filtros.</InlineEmpty>
      ) : (
        <>
          {openGroup && (
            <CoachProfilePanel
              key={openGroup.boosterId}
              booster={boosterMap[openGroup.boosterId]}
              packages={openGroup.pkgs}
              selectedPackageId={selectedCoachPackage?.id}
              onClose={() => setOpenBoosterId(null)}
              onHire={hirePackage}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pageItems.filter(g => g.boosterId !== openBoosterId).map(({ boosterId, pkgs }) => (
              <CoachProfileCard
                key={boosterId}
                booster={boosterMap[boosterId]}
                packages={pkgs}
                selectedPackageId={selectedCoachPackage?.id}
                onOpen={() => setOpenBoosterId(boosterId)}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-4 pt-1">
              <Button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Página anterior"
                variant="ghost" size="icon-sm" className="disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-ink-secondary">Página {page} de {pageCount}</span>
              <Button
                type="button"
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                aria-label="Próxima página"
                variant="ghost" size="icon-sm" className="disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
