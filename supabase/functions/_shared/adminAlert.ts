import { supabaseAdmin } from './supabaseAdmin.ts'

// Alerta duravel para todos os admins (aparece no sino do painel). Nunca lanca: um alerta que falha
// nao pode derrubar o fluxo que o disparou. `dedupeMinutes` evita enxurrada (ex.: chave da Riot expirada).
export async function alertAdmins(
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  dedupeMinutes = 0,
): Promise<void> {
  try {
    const db = supabaseAdmin()
    if (dedupeMinutes > 0) {
      const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString()
      const { count } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('type', type).gte('created_at', since)
      if ((count ?? 0) > 0) return
    }
    const { data: admins } = await db.from('profiles').select('id').eq('role', 'admin')
    if (!admins?.length) return
    await db.from('notifications').insert(admins.map((a) => ({ user_id: a.id, type, title, body, data })))
  } catch (err) {
    console.error('alertAdmins failed', err instanceof Error ? err.name : 'unknown')
  }
}
