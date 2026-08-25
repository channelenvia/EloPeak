import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { playMentionSound } from '@/lib/mentionSound'
import { useAuthStore } from '@/stores/authStore'
import { useUnlockedAudioContext } from '@/hooks/useUnlockedAudioContext'

const MENTION_SOUND_VOLUME = 0.5

/**
 * Toca um som quando o usuário logado é mencionado (@) em um chat de pedido,
 * desde que a aba esteja visível -- vale pra qualquer papel (cliente, booster
 * ou admin), então precisa ser montado uma vez em cada layout raiz, no mesmo
 * espírito de useNewOrderSound (booster-only).
 */
export function useChatMentionSound() {
  const userId = useAuthStore((s) => s.profile?.id)
  const getAudioContext = useUnlockedAudioContext()

  useEffect(() => {
    if (!userId) return
    const channelName = `chat-mention-sound-${userId}`
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function setup() {
      // Mesma cautela de useRealtimeInvalidate: StrictMode roda
      // effect -> cleanup -> effect em dev, e removeChannel() é assíncrono --
      // sem esperar a remoção antes de resubscrever, a segunda montagem pega
      // o mesmo canal (mesmo nome) já com subscribe() chamado e o .on()
      // seguinte lança erro.
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`)
      if (stale) await supabase.removeChannel(stale)
      if (cancelled) return

      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => {
            if ((payload.new as { type?: string } | null)?.type !== 'chat_mention') return
            if (document.visibilityState !== 'visible') return

            const context = getAudioContext()
            if (!context) return
            if (context.state === 'suspended') {
              void context.resume().then(() => playMentionSound(context, MENTION_SOUND_VOLUME))
              return
            }
            playMentionSound(context, MENTION_SOUND_VOLUME)
          },
        )
        .subscribe()
    }

    void setup()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [userId, getAudioContext])
}
