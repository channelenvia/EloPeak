import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { RealtimePostgresChangesFilter } from '@supabase/supabase-js'

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface RealtimeInvalidateOptions {
  /** Nome do canal -- precisa ser único por assinatura ativa na página. */
  channel: string
  table: string
  event?: ChangeEvent
  /** ex.: `order_id=eq.${orderId}` -- mesma sintaxe do Supabase Realtime. */
  filter?: string
  /** Quais query keys invalidar quando o evento chega. Sempre re-busca via
   * query normal (respeitando RLS) em vez de confiar no payload do evento --
   * mesmo padrão já usado em useNewOrderSound/booster_order_events. */
  queryKeys: QueryKey[]
  /** false para desmontar a assinatura sem desinscrever (ex.: aguardando um id). */
  enabled?: boolean
}

// Generaliza o padrão de assinatura Realtime + invalidação que já existia
// (duplicado) em useNewOrderSound e useDuoAccountAutoRefresh -- um único
// lugar cuida de subscribe/cleanup/dedupe de canal.
export function useRealtimeInvalidate({
  channel, table, event = '*', filter, queryKeys, enabled = true,
}: RealtimeInvalidateOptions) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let subscription: ReturnType<typeof supabase.channel> | null = null

    async function setup() {
      // React StrictMode roda effect -> cleanup -> effect de novo em dev.
      // removeChannel() é assíncrono (espera unsubscribe() antes de tirar o
      // canal do registro do client) -- sem esperar essa remoção aqui, a
      // segunda montagem pega de volta o MESMO objeto de canal da primeira
      // (supabase.channel() reaproveita por nome de tópico) já com
      // subscribe() chamado, e o .on() seguinte lança "cannot add
      // postgres_changes callbacks ... after subscribe()".
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channel}`)
      if (stale) await supabase.removeChannel(stale)
      if (cancelled) return

      const config: RealtimePostgresChangesFilter<typeof event> = filter
        ? { event, schema: 'public', table, filter }
        : { event, schema: 'public', table }

      subscription = supabase
        .channel(channel)
        .on('postgres_changes', config, () => {
          for (const key of queryKeys) void queryClient.invalidateQueries({ queryKey: key })
        })
        .subscribe()
    }

    void setup()

    return () => {
      cancelled = true
      if (subscription) void supabase.removeChannel(subscription)
    }
    // queryKeys é recriado a cada render por design (chaves derivadas de
    // ids/filtros) -- serializar pra string evita reassinar o canal à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, table, event, filter, enabled, queryClient, JSON.stringify(queryKeys)])
}
