// Aceite dos termos checado no servidor (H-19): o front (hasAcceptedLegal) sozinho nao protege a API.
// deno-lint-ignore no-explicit-any
type DbClient = any

export async function hasAcceptedCurrentLegal(client: DbClient, userId: string): Promise<boolean> {
  const [profileRes, versionRes] = await Promise.all([
    client.from('profiles').select('terms_accepted_at, privacy_accepted_at, legal_version').eq('id', userId).maybeSingle(),
    client.rpc('current_legal_version'),
  ])
  const profile = profileRes.data as { terms_accepted_at: string | null; privacy_accepted_at: string | null; legal_version: string | null } | null
  const currentVersion = versionRes.data as string | null
  if (profileRes.error || versionRes.error || !profile || !currentVersion) return false
  return Boolean(profile.terms_accepted_at && profile.privacy_accepted_at && profile.legal_version === currentVersion)
}
