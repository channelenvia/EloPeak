import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { useAuthStore } from '@/stores/authStore'
import { getCustomerOrderState } from '@/api/orders'
import { useCatalogGameId, useCatalogServiceId } from '@/api/catalog'
import { queryKeys } from '@/api/core/queryKeys'
import { getAssignedBoosterProfile } from '@/api/boosters'
import { getActiveCoachingPackage } from '@/api/coaching'
import type { ServiceType } from '@/types'
import { consumeIsReloadMount, shouldAutoResumePendingOrder } from './resumeDecision'
import type { BuilderParams } from './useBuilderParams'

const VALID_SERVICES: ServiceType[] = ['elo_boost', 'win_boost', 'clash', 'coaching']

type ResumeParams = Pick<BuilderParams, 'pendingOrderId' | 'explicitlyStartingNewOrder' | 'hasCatalogEntryIntent' | 'setSearchParams'>

// A cobrança é persistida no banco antes de o QR ser exibido. Ao voltar
// para /orders/new, restaura a revisão do pedido pendente sem abrir o PIX:
// gerar/exibir a cobrança sempre exige um novo clique explícito.
// `?new=1` é a escolha explícita do usuário de configurar outro pedido.
export function useResumeDraft(params: ResumeParams) {
  const { pendingOrderId, explicitlyStartingNewOrder, hasCatalogEntryIntent, setSearchParams } = params
  const profileId = useAuthStore((s) => s.profile?.id)
  const { dismissedOrderId, serviceType, setStep } = useOrderBuilderStore()

  const { data: resumableOrder } = useQuery({
    queryKey: queryKeys.resumableOrder.forProfile(profileId),
    queryFn: async () => {
      const state = await getCustomerOrderState()
      return state.order_id ? { id: state.order_id } : null
    },
    enabled: !!profileId && !pendingOrderId && !explicitlyStartingNewOrder && !hasCatalogEntryIntent,
    staleTime: 0,
  })

  useEffect(() => {
    // Pedido dispensado via "Sair e reiniciar"/"Voltar" não reabre sozinho, e sem
    // rascunho local (aba nova) a Revisão nasceria vazia (H-8).
    if (!resumableOrder?.id || !shouldAutoResumePendingOrder({
      resumableOrderId: resumableOrder.id, pendingOrderId, explicitlyStartingNewOrder, hasCatalogEntryIntent,
      dismissedOrderId, hasLocalDraft: !!serviceType,
    })) return
    // Mantém a revisão visível, mas não abre o popup automaticamente.
    setStep('review')
    setSearchParams({ order: resumableOrder.id }, { replace: true })
  }, [
    resumableOrder?.id, pendingOrderId, explicitlyStartingNewOrder, hasCatalogEntryIntent, dismissedOrderId,
    serviceType, setStep, setSearchParams,
  ])

  return resumableOrder
}

// gameSlug/serviceType no store guardam o slug/tipo, nunca os uuids reais.
// Resolvemos os uuids aqui, antes que StepPayment precise deles.
export function useResolvedCatalogIds() {
  const { gameSlug, gameId, serviceType, serviceId, setGame, setServiceId } = useOrderBuilderStore()
  const { data: resolvedGameId } = useCatalogGameId(gameSlug)
  useEffect(() => {
    if (resolvedGameId && resolvedGameId !== gameId) setGame(gameSlug!, resolvedGameId)
  }, [resolvedGameId, gameId, gameSlug, setGame])

  const catalogServiceType = serviceType === 'md5' ? 'win_boost' : serviceType
  const { data: resolvedServiceId } = useCatalogServiceId(resolvedGameId, catalogServiceType)
  useEffect(() => {
    // Só sobe o uuid resolvido — NÃO reaplica setService (que resetaria
    // winsPurchased/MD5 e apagaria as partidas restantes recém-detectadas).
    if (resolvedServiceId && resolvedServiceId !== serviceId) setServiceId(resolvedServiceId)
  }, [resolvedServiceId, serviceId, setServiceId])
}

// ?new=1 sozinho descarta a config em memória e volta ao passo 1. Roda só no
// mount: os valores iniciais ficam congelados em ref e `reset`/`setStep` são
// ações estáveis do store.
export function useResetOnNewOrder(params: Pick<BuilderParams, 'explicitlyStartingNewOrder' | 'hasCatalogEntryIntent'>) {
  const { reset, setStep } = useOrderBuilderStore()
  const initialRef = useRef(params)
  useEffect(() => {
    const { explicitlyStartingNewOrder, hasCatalogEntryIntent } = initialRef.current
    if (explicitlyStartingNewOrder && !hasCatalogEntryIntent && !consumeIsReloadMount()) {
      reset()
      setStep('service')
    }
  }, [reset, setStep])
}

// Vínculo com booster (persistido) só some sozinho quando é lixo de sessão
// anterior (`resumableOrder === null`, não `undefined`). staleBoosterCheckedRef
// roda o diagnóstico uma vez; initialPreferredBoosterIdRef congela o valor no
// MOUNT para não apagar uma escolha ao vivo feita durante o carregamento.
export function useStaleBoosterCleanup(
  resumableOrder: { id: string } | null | undefined,
  params: Pick<BuilderParams, 'pendingOrderId' | 'explicitlyStartingNewOrder' | 'hasCatalogEntryIntent'>,
) {
  const { pendingOrderId, explicitlyStartingNewOrder, hasCatalogEntryIntent } = params
  const { preferredBoosterId, reset } = useOrderBuilderStore()
  const initialPreferredBoosterIdRef = useRef(preferredBoosterId)
  const staleBoosterCheckedRef = useRef(false)
  useEffect(() => {
    if (staleBoosterCheckedRef.current) return
    if (resumableOrder === undefined) return
    staleBoosterCheckedRef.current = true
    if (resumableOrder !== null) return
    if (pendingOrderId || explicitlyStartingNewOrder || hasCatalogEntryIntent) return
    if (!initialPreferredBoosterIdRef.current) return
    reset()
  }, [resumableOrder, pendingOrderId, explicitlyStartingNewOrder, hasCatalogEntryIntent, reset])
}

type PreferredBoosterSetter = (userId: string, displayName: string) => void

// Revalida no cliente pra exibir o nome (a validação que importa é a
// server-side) — id inválido/não aprovado é ignorado, sem erro visível.
function linkPreferredBooster(boosterId: string, setPreferredBooster: PreferredBoosterSetter): void {
  getAssignedBoosterProfile(boosterId)
    .then((data) => {
      if (data?.user_id && data.display_name) setPreferredBooster(data.user_id, data.display_name)
    })
    .catch(() => {})
}

// Mesma lógica defensiva do ?booster= — id inválido/inativo é ignorado.
function loadCoachPackage(
  coachPackageId: string,
  boosterId: string | null,
  actions: {
    setSelectedCoachPackage: ReturnType<typeof useOrderBuilderStore.getState>['setSelectedCoachPackage']
    setBasePrice: (price: number) => void
    setPreferredBooster: PreferredBoosterSetter
  },
): void {
  getActiveCoachingPackage(coachPackageId)
    .then(async (pkg) => {
      if (!pkg) return
      actions.setSelectedCoachPackage({
        id: pkg.id, title: pkg.title, price: pkg.price, tempo: pkg.tempo,
        description: pkg.description, requirements: pkg.requirements,
        lanes: pkg.lanes, specialties: pkg.specialties, champions: pkg.champions,
      })
      actions.setBasePrice(pkg.price)
      if (!boosterId) {
        const boosterRow = await getAssignedBoosterProfile(pkg.booster_id)
        if (boosterRow?.user_id && boosterRow.display_name) actions.setPreferredBooster(boosterRow.user_id, boosterRow.display_name)
      }
    })
    .catch(() => {})
}

// Reage a MUDANÇAS em ?service=/?booster=/?coach_package=, não só ao mount.
// Ref evita reprocessar o mesmo parâmetro após consumido.
export function useCatalogIntent(params: Pick<BuilderParams, 'serviceParam' | 'boosterParam' | 'coachPackageParam' | 'setSearchParams'>) {
  const { serviceParam, boosterParam, coachPackageParam, setSearchParams } = params
  const {
    reset, setStep, setService, setPreferredBooster, setSelectedCoachPackage, setBasePrice,
  } = useOrderBuilderStore()
  const processedCatalogIntentRef = useRef<string | null>(null)
  useEffect(() => {
    const service = serviceParam as ServiceType | null
    if (!service && !boosterParam && !coachPackageParam) return

    const signature = `${service ?? ''}|${boosterParam ?? ''}|${coachPackageParam ?? ''}`
    if (processedCatalogIntentRef.current === signature) return
    processedCatalogIntentRef.current = signature

    if (service && VALID_SERVICES.includes(service)) {
      reset()
      setService(service, service)
      setStep('configure')
    }
    if (boosterParam) linkPreferredBooster(boosterParam, setPreferredBooster)
    if (coachPackageParam) {
      loadCoachPackage(coachPackageParam, boosterParam, { setSelectedCoachPackage, setBasePrice, setPreferredBooster })
    }

    // Marcador após consumir os parâmetros (e derruba um eventual ?order= de um
    // pedido pendente anterior) -- evita a query de retomada tirar o usuário
    // deste novo fluxo.
    setSearchParams({ new: '1' }, { replace: true })
  }, [
    serviceParam, boosterParam, coachPackageParam,
    reset, setStep, setService, setPreferredBooster, setSelectedCoachPackage, setBasePrice, setSearchParams,
  ])
}
