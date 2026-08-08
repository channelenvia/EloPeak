import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env.local')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // localStorage persiste entre aberturas do navegador — usuário não
    // precisa vincular o Discord de novo a cada sessão. O logout continua
    // explícito (botão "Sair"), e a sessão só cai sozinha quando o refresh
    // token expira no próprio Supabase Auth. Fallback pra memória fora do
    // browser (SSR/testes).
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

export const signOut = () => supabase.auth.signOut()
