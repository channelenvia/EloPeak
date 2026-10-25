import { useEffect, useRef, useState } from 'react'
import { adminGetDuoAccountCredentials } from '@/api/duoAccounts'

export type RevealState = { login: string; password: string } | 'loading' | 'error'
const REVEAL_TIMEOUT_MS = 15_000

export function useDuoCredentialReveal() {
  const [revealed, setRevealed] = useState<Record<string, RevealState>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  function hide(accountId: string) {
    clearTimeout(timers.current[accountId])
    delete timers.current[accountId]
    setRevealed((r) => { const next = { ...r }; delete next[accountId]; return next })
  }

  async function toggle(accountId: string) {
    if (revealed[accountId] && revealed[accountId] !== 'error') {
      hide(accountId)
      return
    }
    setRevealed((r) => ({ ...r, [accountId]: 'loading' }))
    const res = await adminGetDuoAccountCredentials(accountId).catch(() => null)
    if (!res?.success || !res.login) {
      setRevealed((r) => ({ ...r, [accountId]: 'error' }))
      return
    }
    setRevealed((r) => ({ ...r, [accountId]: { login: res.login!, password: res.password! } }))
    timers.current[accountId] = setTimeout(() => hide(accountId), REVEAL_TIMEOUT_MS)
  }

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  return { revealed, toggle }
}
