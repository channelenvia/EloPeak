import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { BOOST_ADDON_CODES, sortAddonsBySortOrder } from '@/lib/boostDomain'
import type { BoostFlow, ServiceExtra } from '@/types'

// Referência estável pra quando a query está desabilitada (flow null) —
// `data` fica `undefined` nesse caso, e um fallback `data = []` inline no
// destructuring do chamador cria um array NOVO a cada render. Se esse array
// for dependência de um useEffect (StepExtras.tsx), isso causa loop
// infinito de render (o efeito nunca vê a "mesma" referência, dispara de
// novo, seta estado, re-renderiza, repete). Todo consumidor deve usar
// `data ?? EMPTY_ADDONS` em vez de um default inline.
export const EMPTY_ADDONS: ServiceExtra[] = []

// Catálogo de addons de um fluxo do configurador de boost (Solo/Duo padrão
// ou Master+), já ordenado por sort_order — Acesso Prioritário sempre por
// último. Usado por qualquer tela que precise listar/exibir os addons de um
// pedido (configurador, resumo, sidebar) para não duplicar a query nem
// arriscar uma ordenação diferente em cada lugar.
export function useBoostAddons(flow: BoostFlow | null) {
  return useQuery({
    queryKey: ['boost-addons', flow],
    queryFn: async () => {
      const addonCodes = [...BOOST_ADDON_CODES[flow!]]
      const { data, error } = await supabase
        .from('service_extras')
        .select('*')
        .eq('flow', flow as string)
        .eq('is_active', true)
        .in('code', addonCodes)
        .order('sort_order')
      if (error) throw error
      return sortAddonsBySortOrder(
        (data as ServiceExtra[]).filter((extra) =>
          extra.flow === flow &&
          typeof extra.code === 'string' &&
          BOOST_ADDON_CODES[flow!].includes(extra.code)
        )
      )
    },
    enabled: !!flow,
    staleTime: 1000 * 60 * 10,
  })
}
