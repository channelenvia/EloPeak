import '@/lib/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

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
  const { setSession, setProfile, setLoading, setInitialized } = useAuthStore()

  useEffect(() => {
    let initialized = false

    // Resolve session immediately from cache — no network needed for logged-out users
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (initialized) return
      setSession(session)
      if (session?.user) {
        const displayName = (session.user.user_metadata?.name ?? session.user.user_metadata?.full_name) as string | undefined
        fetchProfile(session.user.id, displayName)
      } else {
        setProfile(null)
        setLoading(false)
        setInitialized(true)
        initialized = true
      }
    })

    // Subscribe to future auth state changes (sign in / sign out / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') return // Handled by getSession() above
        setSession(session)
        if (session?.user) {
          if (event === 'SIGNED_IN' && session.provider_token) {
            const provider = (session.user.app_metadata as Record<string, string>).provider
            if (provider === 'discord') joinDiscordServer(session.provider_token)
          }
          const displayName = (session.user.user_metadata?.name ?? session.user.user_metadata?.full_name) as string | undefined
          await fetchProfile(session.user.id, displayName)
        } else {
          setProfile(null)
          setLoading(false)
          setInitialized(true)
          initialized = true
        }
      }
    )

    // Safety net: unblock UI if Supabase never responds within 3s
    const timeout = setTimeout(() => {
      setLoading(false)
      setInitialized(true)
      initialized = true
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProfile(userId: string, displayName?: string) {
    setLoading(true)
    let { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!data) {
      // Profile missing (Discord OAuth trigger may have failed) — create via RPC
      await supabase.rpc('ensure_profile_exists', { p_display_name: displayName ?? null })
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      data = result.data
    }

    if (data) setProfile(data)
    setLoading(false)
    setInitialized(true)
  }

  function joinDiscordServer(providerToken: string) {
    supabase.functions.invoke('discord-join-server', {
      body: { discord_access_token: providerToken },
    }).catch(() => { /* non-fatal — user still logs in */ })
  }

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
      </AuthProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
