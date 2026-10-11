import { HelmetProvider } from 'react-helmet-async'
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useRef } from 'react'
// Bootstrap de sessão (getSession/onAuthStateChange) fica no provider raiz de
// propósito, não é uma query cacheável de src/api/*.
// eslint-disable-next-line no-restricted-imports
import { supabase } from '@/lib/supabase'
import { EdgeFunctionError, invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { useAuthStore } from '@/stores/authStore'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,       // 2 min
      gcTime: 1000 * 60 * 10,         // 10 min
      retry: (failureCount, error) => {
        // Don't retry on 4xx
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status
          if (status >= 400 && status < 500) return false
        }
        return failureCount < 2
      },
    },
  },
})

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setSession, setProfile, setProfileError, setLoading, setInitialized } = useAuthStore()
  const discordJoinInFlight = useRef(false)

  useEffect(() => {
    // Evento de auth mais novo que o getSession() inicial: aí o getSession tardio é que fica obsoleto (H-6).
    let authEventSeen = false

    // Resolve session immediately from cache — no network needed for logged-out users
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (authEventSeen) return
      setSession(session)
      if (session?.user) {
        const displayName = (session.user.user_metadata?.name ?? session.user.user_metadata?.full_name) as string | undefined
        fetchProfile(session.user.id, displayName)
      } else {
        // Reuse the store's own reset() instead of re-deriving the "logged
        // out" shape by hand here — keeps the empty-state definition in one
        // place (authStore.ts).
        useAuthStore.getState().reset()
        setInitialized(true)
      }
    })

    // Subscribe to future auth state changes (sign in / sign out / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') return // Handled by getSession() above
        const previousUserId = useAuthStore.getState().session?.user.id
        setSession(session)
        // Renovacao de token nao muda quem esta logado: nada de PageLoader nem refetch do perfil
        // (antes isso desmontava checkout, chat e modais a cada refresh de token).
        if (event === 'TOKEN_REFRESHED') return
        // So eventos com tratamento proprio de perfil tornam o getSession() inicial obsoleto (TOKEN_REFRESHED nao).
        authEventSeen = true
        // Outra aba entrou com OUTRA conta (sem SIGNED_OUT): nada da conta anterior pode sobrar no cache nem no rascunho (M-24).
        if (session?.user && previousUserId && previousUserId !== session.user.id) {
          useAuthStore.getState().setProfile(null)
          queryClient.clear()
          useOrderBuilderStore.getState().reset()
        }
        if (session?.user) {
          if (event === 'SIGNED_IN') {
            const provider = (session.user.app_metadata as Record<string, string>).provider
            if (provider === 'discord') joinDiscordServer(session.user.id, session.provider_token)
          }
          const displayName = (session.user.user_metadata?.name ?? session.user.user_metadata?.full_name) as string | undefined
          // Sem await dentro do callback: chamar o supabase aqui dentro pode travar o proprio cliente de auth.
          const userId = session.user.id
          setTimeout(() => { void fetchProfile(userId, displayName) }, 0)
        } else {
          // Signed out (or session otherwise cleared) — wipe auth state and
          // every other piece of per-user client state so nothing from this
          // account can leak into the next session in the same browser.
          useAuthStore.getState().reset()
          setInitialized(true)
          queryClient.clear()
          useOrderBuilderStore.getState().reset()
        }
      }
    )

    // Safety net: unblock UI if Supabase never responds within 3s
    const timeout = setTimeout(() => {
      setLoading(false)
      setInitialized(true)
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProfile(userId: string, displayName?: string) {
    // So mostra o loader quando ainda nao ha perfil deste usuario (SIGNED_IN repetido nao desmonta a arvore).
    if (useAuthStore.getState().profile?.id !== userId) setLoading(true)
    const { data: initialData, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    let data = initialData
    // Resposta tardia de quem ja saiu/trocou de conta nao pode escrever perfil nem erro no store.
    const isStale = () => useAuthStore.getState().session?.user.id !== userId
    if (isStale()) return

    if (error) {
      if (import.meta.env.DEV) console.error('fetchProfile: failed to load profile', error)
      setProfile(null)
      setProfileError(true)
      setLoading(false)
      setInitialized(true)
      return
    }

    if (!data) {
      // Profile missing (Discord OAuth trigger may have failed) — create via RPC
      await supabase.rpc('ensure_profile_exists', { p_display_name: displayName ?? undefined })
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (isStale()) return
      if (result.error) {
        if (import.meta.env.DEV) console.error('fetchProfile: failed to load profile after ensure_profile_exists', result.error)
        setProfile(null)
        setProfileError(true)
        setLoading(false)
        setInitialized(true)
        return
      }
      data = result.data
    }

    if (data) {
      setProfile(data)
    }
    setLoading(false)
    setInitialized(true)
  }

  // Entrada no servidor do Discord é 100% automática e silenciosa em segundo
  // plano -- nenhuma mensagem é mostrada ao usuário, nem de sucesso nem de
  // falha. Falhas só são logadas em dev; o usuário nunca precisa agir (o
  // storageKey evita reprocessar a cada sessão, sucesso ou não).
  async function joinDiscordServer(userId: string, providerToken?: string | null) {
    const storageKey = `discord-join-server:${userId}:completed`
    if (sessionStorage.getItem(storageKey) === 'true' || discordJoinInFlight.current) return

    if (!providerToken) {
      if (import.meta.env.DEV) console.warn('joinDiscordServer: sem provider_token, pulando silenciosamente')
      return
    }

    discordJoinInFlight.current = true
    try {
      await invokeEdgeFunction('discord-join-server', {
        body: { discord_access_token: providerToken },
        timeoutMs: 15_000,
      })
      sessionStorage.setItem(storageKey, 'true')
    } catch (err) {
      if (err instanceof EdgeFunctionError && err.status === 429) {
        const retryAfterMs = Math.max(1, err.retryAfter ?? 5) * 1000
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
        try {
          await invokeEdgeFunction('discord-join-server', {
            body: { discord_access_token: providerToken },
            timeoutMs: 15_000,
          })
        } catch (retryErr) {
          if (import.meta.env.DEV) console.error('joinDiscordServer: retry failed', retryErr)
        } finally {
          sessionStorage.setItem(storageKey, 'true')
        }
        return
      }

      sessionStorage.setItem(storageKey, 'true')
      if (import.meta.env.DEV) console.error('joinDiscordServer: failed', err)
    } finally {
      discordJoinInFlight.current = false
    }
  }

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HelmetProvider>
      {/* reducedMotion="user" -- toda animação framer-motion do app (não só
          as guardadas manualmente com useReducedMotion()) respeita
          prefers-reduced-motion automaticamente daqui pra frente. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              {children}
            </AuthProvider>
            {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
          </QueryClientProvider>
        </LazyMotion>
      </MotionConfig>
    </HelmetProvider>
  )
}
