// Lógica pura de filtragem dos pacotes de coach (usada em CoachPackagePicker).
// Isolada do componente pra ser testável sem React/Supabase e pra manter a
// semântica de multi-seleção num único lugar.
//
// Semântica: OU dentro de cada grupo (marcar Meio + Topo mostra coaches de
// QUALQUER uma das duas rotas), E entre grupos e a busca (precisa passar em
// rotas E em especialidades E na busca).

export interface CoachPackageLike {
  title: string
  description: string | null
  lanes: string[] | null
  specialties: string[] | null
}

export interface CoachPackageFilters {
  search: string
  lanes: ReadonlySet<string>
  specialties: ReadonlySet<string>
}

export function matchesCoachPackageFilters(
  pkg: CoachPackageLike,
  boosterName: string,
  { search, lanes, specialties }: CoachPackageFilters,
): boolean {
  const q = search.trim().toLowerCase()
  if (q) {
    const hit = pkg.title.toLowerCase().includes(q)
      || (pkg.description ?? '').toLowerCase().includes(q)
      || boosterName.toLowerCase().includes(q)
    if (!hit) return false
  }
  if (lanes.size > 0 && !pkg.lanes?.some((l) => lanes.has(l))) return false
  if (specialties.size > 0 && !pkg.specialties?.some((s) => specialties.has(s))) return false
  return true
}

// Nº de marcações ativas (rotas + especialidades) — a busca por texto não
// entra nessa contagem, é mostrada no próprio campo.
export function activeFilterCount(filters: Pick<CoachPackageFilters, 'lanes' | 'specialties'>): number {
  return filters.lanes.size + filters.specialties.size
}
