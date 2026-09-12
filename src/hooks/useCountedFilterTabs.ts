import { useState } from 'react'

// Padrão repetido em toda tela com FilterTabs de status (Refunds, DuoAccounts,
// Payouts admin, Payments do booster): estado do filtro ativo + contagem por
// aba (sempre sobre a lista inteira, não a já filtrada) + lista filtrada pelo
// valor atual. Extraído pra não reimplementar o mesmo trio 4x.
export function useCountedFilterTabs<T, F extends string>(
  items: T[] | undefined,
  initial: F,
  matches: (item: T, filter: F) => boolean,
) {
  const [value, setValue] = useState<F>(initial)
  const countFor = (f: F) => (items ?? []).filter((item) => matches(item, f)).length
  const filtered = (items ?? []).filter((item) => matches(item, value))
  return { value, onChange: setValue, countFor, filtered }
}
