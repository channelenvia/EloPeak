import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile, UserRole } from '@/types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isInitialized: boolean

  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  setInitialized: (initialized: boolean) => void
  reset: () => void

  // Derived
  isAuthenticated: () => boolean
  role: () => UserRole | null
  isAdmin: () => boolean
  isBooster: () => boolean
  isCustomer: () => boolean
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: false,
  isInitialized: false,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setProfile: (profile) => set({ profile }),

  setLoading: (isLoading) => set({ isLoading }),

  setInitialized: (isInitialized) => set({ isInitialized }),

  reset: () =>
    set({ session: null, user: null, profile: null, isLoading: false }),

  isAuthenticated: () => !!get().session,
  role: () => get().profile?.role ?? null,
  isAdmin: () => get().profile?.role === 'admin' || get().profile?.role === 'support',
  isBooster: () => get().profile?.role === 'booster',
  isCustomer: () => get().profile?.role === 'customer',
}))
