import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1'

// Sem anotação explícita de retorno de propósito: `ReturnType<typeof
// createClient>` (createClient é overloaded) resolve pro generic default da
// ASSINATURA, não pro tipo real inferido da chamada abaixo (3 argumentos) --
// os dois tipos IGNORAM ser o "mesmo client", e todo `.from('orders')...`
// feito por quem consome esse client via um `client` tipado por essa
// anotação virava `never` (mesmo padrão que supabaseAdmin() já evita não
// anotando o retorno). Deixar o TS inferir aqui resolve a partir da
// chamada real, não do overload genérico.
export async function getAuthUser(authHeader: string | null) {
  if (!authHeader) return null

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase auth env not configured')
  }

  const client = createClient(
    supabaseUrl,
    anonKey,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return null

  return { user, client }
}
