export const LEGAL_VERSION = '2026-06-26'

export function hasAcceptedLegal(profile: {
  terms_accepted_at?: string | null
  privacy_accepted_at?: string | null
}) {
  return Boolean(profile.terms_accepted_at && profile.privacy_accepted_at)
}
