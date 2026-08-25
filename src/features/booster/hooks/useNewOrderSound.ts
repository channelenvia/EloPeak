import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/api/core/queryKeys'
import { useBoosterSoundStore } from '@/stores/boosterSoundStore'
import { useUnlockedAudioContext } from '@/hooks/useUnlockedAudioContext'
import { playOrderSound } from './orderSoundLibrary'

const FALLBACK_POLL_INTERVAL_MS = 15_000

/**
 * Avisa boosters aprovados quando um pedido passa a estar disponível para eles.
 * A view do backend é consultada antes do aviso para respeitar credenciais e
 * exclusividade. O polling cobre quedas temporárias da conexão Realtime.
 */
export function useNewOrderSound() {
  const queryClient = useQueryClient()
  const getAudioContext = useUnlockedAudioContext()
  const knownOrderIdsRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const syncingRef = useRef(false)

  // Preferência de som lida via ref (não como dep do useCallback) pra trocar
  // volume/som/mute sem recriar playNotification -- o que recriaria
  // syncVisibleOrders e resubscreveria o canal Realtime/interval abaixo.
  const soundId = useBoosterSoundStore((s) => s.soundId)
  const volume = useBoosterSoundStore((s) => s.volume)
  const muted = useBoosterSoundStore((s) => s.muted)
  const settingsRef = useRef({ soundId, volume, muted })
  useEffect(() => {
    settingsRef.current = { soundId, volume, muted }
  }, [soundId, volume, muted])

  const playNotification = useCallback(() => {
    const context = getAudioContext()
    if (!context) return
    const { soundId: id, volume: vol, muted: isMuted } = settingsRef.current
    if (isMuted) return
    // Chrome/Safari auto-suspendem o AudioContext depois de um tempo sem
    // produzir som (ou com a aba em segundo plano) -- sem isso, o primeiro
    // clique/tecla desbloqueava o áudio uma vez (unlockAudio abaixo), mas
    // depois que o browser suspendia de novo por conta própria o alerta
    // ficava mudo pro resto da sessão (playOrderSound não toca nada com
    // state !== 'running', sem erro nenhum). resume() após o desbloqueio
    // inicial não exige um novo gesto do usuário.
    if (context.state === 'suspended') {
      void context.resume().then(() => playOrderSound(context, id, vol))
      return
    }
    playOrderSound(context, id, vol)
  }, [getAudioContext])

  const syncVisibleOrders = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true

    try {
      const { data, error } = await supabase
        .from('available_boost_orders')
        .select('id')

      if (error) return

      const nextIds = new Set(
        (data ?? [])
          .map(({ id }) => id)
          .filter((id): id is string => typeof id === 'string'),
      )
      if (!initializedRef.current) {
        knownOrderIdsRef.current = nextIds
        initializedRef.current = true
        return
      }

      const hasNewOrder = [...nextIds].some((id) => !knownOrderIdsRef.current.has(id))
      knownOrderIdsRef.current = nextIds

      if (hasNewOrder) {
        playNotification()
        void queryClient.invalidateQueries({ queryKey: queryKeys.orders.availableJobs() })
      }
    } finally {
      syncingRef.current = false
    }
  }, [playNotification, queryClient])

  useEffect(() => {
    void syncVisibleOrders()

    const channel = supabase
      .channel('booster-new-order-sound')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'booster_order_events' },
        () => void syncVisibleOrders(),
      )
      .subscribe()

    const interval = window.setInterval(() => void syncVisibleOrders(), FALLBACK_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [syncVisibleOrders])
}
