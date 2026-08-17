// Lógica pura de filtragem dos pacotes de coach (usada em CoachPackagePicker).
// Isolada do componente pra ser testável sem React/Supabase e pra manter a
// semântica de multi-seleção num único lugar.
//
// Semântica: OU dentro de cada grupo (marcar Meio + Topo mostra coaches de
// QUALQUER uma das duas rotas), E entre grupos, faixa de preço e a busca
// (precisa passar em rotas E em especialidades E em duração E na faixa de
// preço E na busca). Campos do filtro espelham exatamente os campos do
// formulário de cadastro de serviço do booster (ServiceFormData) — a busca
// por texto cobre "champions" porque é um campo livre (até 3 itens), não
// caberia como um popover de multi-seleção como rotas/especialidades.

export interface CoachPackageLike {
  title: string
  description: string | null
  lanes: string[] | null
  specialties: string[] | null
  champions: string[] | null
  tempo: string | null
  price: number
}

export interface CoachPackageFilters {
  search: string
  lanes: ReadonlySet<string>
  specialties: ReadonlySet<string>
  tempo: ReadonlySet<string>
  priceMin: number | null
  priceMax: number | null
}

export function matchesCoachPackageFilters(
  pkg: CoachPackageLike,
  boosterName: string,
  { search, lanes, specialties, tempo, priceMin, priceMax }: CoachPackageFilters,
): boolean {
  const q = search.trim().toLowerCase()
  if (q) {
    const hit = pkg.title.toLowerCase().includes(q)
      || (pkg.description ?? '').toLowerCase().includes(q)
      || boosterName.toLowerCase().includes(q)
      || (pkg.champions ?? []).some((c) => c.toLowerCase().includes(q))
    if (!hit) return false
  }
  if (lanes.size > 0 && !pkg.lanes?.some((l) => lanes.has(l))) return false
  if (specialties.size > 0 && !pkg.specialties?.some((s) => specialties.has(s))) return false
  if (tempo.size > 0 && !(pkg.tempo && tempo.has(pkg.tempo))) return false
  if (priceMin != null && pkg.price < priceMin) return false
  if (priceMax != null && pkg.price > priceMax) return false
  return true
}

// Nº de marcações ativas (rotas + especialidades + duração + faixa de
// preço) — a busca por texto não entra nessa contagem, é mostrada no
// próprio campo.
export function activeFilterCount(
  filters: Pick<CoachPackageFilters, 'lanes' | 'specialties' | 'tempo' | 'priceMin' | 'priceMax'>,
): number {
  return filters.lanes.size + filters.specialties.size + filters.tempo.size
    + (filters.priceMin != null || filters.priceMax != null ? 1 : 0)
}
