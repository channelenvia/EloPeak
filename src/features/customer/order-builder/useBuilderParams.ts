import { useSearchParams } from 'react-router-dom'

export function useBuilderParams() {
  const [searchParams, setSearchParams] = useSearchParams()
  const serviceParam = searchParams.get('service')
  const boosterParam = searchParams.get('booster')
  const coachPackageParam = searchParams.get('coach_package')
  return {
    searchParams,
    setSearchParams,
    pendingOrderId: searchParams.get('order'),
    explicitlyStartingNewOrder: searchParams.get('new') === '1',
    serviceParam,
    boosterParam,
    coachPackageParam,
    hasCatalogEntryIntent: Boolean(serviceParam || boosterParam || coachPackageParam),
  }
}

export type BuilderParams = ReturnType<typeof useBuilderParams>
