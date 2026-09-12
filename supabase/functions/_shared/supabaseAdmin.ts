import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1'

export function supabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin env not configured')
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
  )
}
