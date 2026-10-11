import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '@/types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isInitialized: boolean
  // Falha ao carregar o perfil (5xx/RLS transiente) com sessao ativa: a UI mostra retry/sair em vez de loader eterno (H-6).
  profileError: boolean

  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  setInitialized: (initialized: boolean) => void
  setProfileError: (hasError: boolean) => void
  reset: () => void

  // Derived
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: false,
  isInitialized: false,
  profileError: false,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setProfile: (profile) => set({ profile, profileError: profile ? false : get().profileError }),

  setProfileError: (profileError) => set({ profileError }),

  setLoading: (isLoading) => set({ isLoading }),

  setInitialized: (isInitialized) => set({ isInitialized }),

  reset: () =>
    set({ session: null, user: null, profile: null, profileError: false, isLoading: false }),

  isAuthenticated: () => !!get().session,
}))
