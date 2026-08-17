export const LEGAL_VERSION = '2026-08-14'

export function hasAcceptedLegal(profile: {
  terms_accepted_at?: string | null
  privacy_accepted_at?: string | null
  legal_version?: string | null
}) {
  return Boolean(
    profile.terms_accepted_at
    && profile.privacy_accepted_at
    && profile.legal_version === LEGAL_VERSION,
  )
}
