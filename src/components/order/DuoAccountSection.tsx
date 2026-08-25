import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, KeyRound, RefreshCcw } from 'lucide-react'
import { Button, ErrorAlert, RankBadge } from '@/components/ui'
import {
    lookupDuoAccountRiotRank,
    useBoosterDuoAccounts,
    useClearDuoOwnRiotId,
    useGetDuoAccountAccessToken, useReleaseDuoAccountReservation,
    useReserveDuoAccount,
    useSetDuoOwnRiotId,
} from '@/api/duoAccounts'
import type { BoosterVisibleDuoAccount } from '@/api/duoAccounts'
import { rankStep } from '@/lib/pricing'
import { RANK_TIER_LABEL } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { Order } from '@/types'

// Janela de proximidade de elo pra filtrar contas Duo disponíveis
// automaticamente: até Esmeralda I, aceita ±1 divisão inteira (4 degraus de
// rankStep); a partir de Diamante, a janela fecha pra ±2 subdivisões só --
// matchmaking fica mais sensível a diferença de elo nesse patamar.
const DUO_RANK_WINDOW_EMERALD_I_STEP = rankStep('emerald', 'I')

function withinDuoRankWindow(clientStep: number, accountStep: number): boolean {
  const windowSize = clientStep <= DUO_RANK_WINDOW_EMERALD_I_STEP ? 4 : 2
  return Math.abs(accountStep - clientStep) <= windowSize
}

export function DuoAccountSection({ order, onLinked }: { order: Order; onLinked?: () => void }) {
  const { profile } = useAuthStore()
  const [accountSource, setAccountSource] = useState<'platform' | 'own'>(order.duo_own_riot_id ? 'own' : 'platform')
  const [ownRiotId, setOwnRiotId] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [switching, setSwitching] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [search, setSearch] = useState('')

  const { data: accounts, isLoading } = useBoosterDuoAccounts()
  const reserve = useReserveDuoAccount()
  const getToken = useGetDuoAccountAccessToken()
  const release = useReleaseDuoAccountReservation()
  const setOwnAccount = useSetDuoOwnRiotId()
  const clearOwnAccount = useClearDuoOwnRiotId()

  const reserved = (accounts as BoosterVisibleDuoAccount[] | undefined)?.find(a => a.reserved_by === profile?.id && a.reserved_order_id === order.id)

  const clientStep = order.current_rank ? rankStep(order.current_rank.tier, order.current_rank.division) : null

  const available = ((accounts as BoosterVisibleDuoAccount[] | undefined)?.filter(a => a.reserved_by === null) ?? []).filter((a) => {
    if (search.trim() && !(a.riot_id ?? a.label).toLowerCase().includes(search.trim().toLowerCase())) return false
    if (clientStep != null) {
      if (!a.current_rank) return false
      if (!withinDuoRankWindow(clientStep, rankStep(a.current_rank.tier, a.current_rank.division))) return false
    }
    return true
  })

  // set_duo_own_riot_id (RPC) só valida o FORMATO "Nome#TAG" -- nunca
  // confere se a conta existe de verdade na Riot. Sem essa checagem aqui, um
  // Riot ID digitado errado só falharia silenciosamente no próximo sync
  // (best-effort: booster_duo_matches nunca reflete a estatística do
  // booster, sem nenhum aviso). Mesma consulta usada pelo admin ao cadastrar
  // conta do pool (DuoAccounts.tsx) -- só confere existência, não precisa
  // do rank aqui (não filtra/lista a conta própria em lugar nenhum).
  const saveOwnAccount = useMutation({
    mutationFn: async () => {
      const trimmed = ownRiotId.trim()
      const lookup = await lookupDuoAccountRiotRank(trimmed)
      if (!lookup.found) throw new Error('Conta Riot não encontrada. Confira o Riot ID digitado.')
      await setOwnAccount.mutateAsync({ orderId: order.id, riotId: trimmed })
    },
    onSuccess: () => { setOwnRiotId(''); onLinked?.() },
  })

  function doClearOwnAccount() {
    clearOwnAccount.mutate(order.id)
  }

  function doReserve() {
    reserve.mutate({ orderId: order.id, accountId: selectedAccountId }, {
      onSuccess: () => { setSwitching(false); setAccessToken(null); onLinked?.() },
    })
  }

  function doRelease() {
    release.mutate(order.id, { onSuccess: () => { setSwitching(false); setAccessToken(null) } })
  }

  function doGetToken() {
    if (!reserved) return
    getToken.mutate(reserved.id, {
      onSuccess: (result) => setAccessToken(result.access_token ?? null),
    })
  }

  async function copyToken() {
    if (!accessToken) return
    await navigator.clipboard.writeText(accessToken)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 1500)
  }

  const reserveErrorMessage = (msg: string) =>
    msg === 'account_unavailable' ? 'Essa conta acabou de ser reservada por outro booster. Escolha outra.' : msg

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-bg-elevated p-1">
        <button
          type="button"
          onClick={() => setAccountSource('platform')}
          className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${accountSource === 'platform' ? 'bg-bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
        >
          Conta da plataforma
        </button>
        <button
          type="button"
          onClick={() => setAccountSource('own')}
          className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${accountSource === 'own' ? 'bg-bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
        >
          Conta própria
        </button>
      </div>

      {accountSource === 'own' ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-secondary">
            Use sua própria conta pra jogar com o cliente — só o Riot ID, sem token (você já tem acesso).
          </p>
          {order.duo_own_riot_id ? (
            <div className="flex items-center justify-between bg-bg-elevated rounded-xl px-3 py-2.5">
              <p className="text-sm font-semibold text-ink truncate">{order.duo_own_riot_id}</p>
              <Button size="sm" variant="danger-ghost" loading={clearOwnAccount.isPending} onClick={doClearOwnAccount}>
                Remover
              </Button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={ownRiotId}
                onChange={(e) => setOwnRiotId(e.target.value)}
                placeholder="Nome#TAG"
                className="input-base flex-1 text-sm"
              />
              <Button size="sm" disabled={!ownRiotId.trim()} loading={saveOwnAccount.isPending} onClick={() => saveOwnAccount.mutate()}>
                Salvar
              </Button>
            </div>
          )}
          {(saveOwnAccount.isError || clearOwnAccount.isError) && (
            <ErrorAlert
              message={
                (saveOwnAccount.error instanceof Error && saveOwnAccount.error.message) ||
                (clearOwnAccount.error instanceof Error && clearOwnAccount.error.message) ||
                'Erro ao salvar conta'
              }
            />
          )}
        </div>
      ) : isLoading ? (
        <p className="text-xs text-ink-muted">Carregando contas...</p>
      ) : reserved && !switching ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-bg-elevated rounded-xl px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold text-ink">{reserved.riot_id ?? reserved.label}</p>
              {reserved.current_rank && (
                <p className="text-xs text-ink-muted">
                  {RANK_TIER_LABEL[reserved.current_rank.tier]} {reserved.current_rank.division}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" leftIcon={<RefreshCcw className="h-3.5 w-3.5" />} onClick={() => setSwitching(true)}>
                Trocar
              </Button>
              <Button size="sm" variant="danger-ghost" loading={release.isPending} onClick={doRelease}>
                Liberar
              </Button>
            </div>
          </div>

          {accessToken ? (
            <div className="space-y-2">
              <textarea readOnly value={accessToken} className="input-base w-full min-h-[80px] text-[11px] font-mono resize-none" spellCheck={false} />
              <Button size="sm" className="w-full" variant={tokenCopied ? 'success' : 'secondary'} leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyToken()}>
                {tokenCopied ? 'Copiado' : 'Copiar token'}
              </Button>
              <p className="text-[10px] text-ink-muted">Use este token apenas no aplicativo autorizado — login e senha não são exibidos.</p>
            </div>
          ) : (
            <Button size="sm" className="w-full" leftIcon={<KeyRound className="h-3.5 w-3.5" />} loading={getToken.isPending} onClick={doGetToken}>
              Obter token de acesso
            </Button>
          )}
          {getToken.isError && (
            <ErrorAlert message={getToken.error instanceof Error ? getToken.error.message : 'Erro ao obter token'} />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nick..." className="input-base w-full text-xs" />
          <p className="text-[10px] text-ink-muted">
            {clientStep != null
              ? `Contas filtradas automaticamente pelo elo do cliente (${clientStep <= DUO_RANK_WINDOW_EMERALD_I_STEP ? '±1 divisão' : '±2 subdivisões'}).`
              : 'Sem elo atual do cliente pra filtrar — mostrando todas as contas disponíveis.'}
          </p>

          {available.length === 0 ? (
            <p className="text-xs text-ink-muted py-2">Nenhuma conta Duo disponível nessa faixa de elo.</p>
          ) : (
            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
              {available.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedAccountId(a.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    selectedAccountId === a.id ? 'border-brand bg-brand/10' : 'border-border-subtle hover:bg-bg-elevated/60'
                  }`}
                >
                  {a.current_rank && <RankBadge tier={a.current_rank.tier} division={a.current_rank.division} size="xs" showLabel={false} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{a.riot_id ?? a.label}</p>
                    {a.current_rank && <p className="text-[10px] text-ink-muted">{RANK_TIER_LABEL[a.current_rank.tier]} {a.current_rank.division}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          <Button size="sm" className="w-full" disabled={!selectedAccountId} loading={reserve.isPending} onClick={doReserve}>
            Reservar esta conta
          </Button>
          {switching && (
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setSwitching(false)}>Cancelar</Button>
          )}
          {reserve.isError && (
            <ErrorAlert message={reserve.error instanceof Error ? reserveErrorMessage(reserve.error.message) : 'Erro ao reservar conta'} />
          )}
        </div>
      )}
    </div>
  )
}
