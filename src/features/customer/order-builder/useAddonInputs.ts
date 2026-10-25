import { useBoostAddons, EMPTY_ADDONS } from '@/hooks/useBoostAddons'
import { resolveFlow, type BoostFlow, type PaymentStore } from './paymentTypes'

interface AddonInputs {
  flow: BoostFlow
  addonCodes: string[]
  addonsReady: boolean
}

// Mesma queryKey usada em StepExtras/StepReview — já em cache. Precisamos
// do catálogo aqui só para traduzir os ids selecionados em códigos
// estáveis (addon_codes) — o payload nunca envia o id interno do banco.
export function useAddonInputs(store: PaymentStore): AddonInputs {
  const flow = resolveFlow(store)
  const { data: addonData } = useBoostAddons(flow)
  const addonCatalog = addonData ?? EMPTY_ADDONS
  const addonCodes = addonCatalog
    .filter(e => store.selectedExtraIds.has(e.id))
    .map(e => e.code)
    .filter((code): code is string => !!code)
  const addonsReady = store.selectedExtraIds.size === 0 || addonData !== undefined
  return { flow, addonCodes, addonsReady }
}
