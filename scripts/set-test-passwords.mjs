// Uso local, UMA VEZ SÓ: define uma senha de teste fixa nas 3 contas de
// teste combinadas, via Admin API (service_role key). Depois de rodar isso
// uma vez, os scripts de console passam a funcionar pra sempre com
// signInWithPassword + anon key -- sem precisar de terminal, servidor local
// ou service_role key nunca mais.
//
// Rode com:
//   SUPABASE_SERVICE_ROLE_KEY=<sua key> node scripts/set-test-passwords.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yrynfqjxqblrbxxiobty.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_PASSWORD = 'EloPeakTeste_2026!'

const TEST_EMAILS = ['flashxd77@gmail.com', 'channelenvia88@gmail.com', 'rafaelxo2007@gmail.com']

if (!SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY no ambiente antes de rodar.')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (error) {
  console.error('Erro ao listar usuários:', error.message)
  process.exit(1)
}

for (const email of TEST_EMAILS) {
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) {
    console.error(`✗ ${email}: usuário não encontrado (precisa ter feito login via Discord pelo menos uma vez).`)
    continue
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: TEST_PASSWORD })
  if (updateError) {
    console.error(`✗ ${email}: ${updateError.message}`)
    continue
  }
  console.log(`✓ ${email}: senha de teste definida.`)
}
