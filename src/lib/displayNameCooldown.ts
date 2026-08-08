// Espelha booster_display_name_cooldown_days_remaining (migration 159) --
// só pra feedback imediato de UI (mostrar a contagem antes mesmo de tentar
// salvar); o RPC update_my_display_name sempre reforça isso de verdade no
// servidor, calculado a partir do mesmo display_name_changed_at.
export const DISPLAY_NAME_COOLDOWN_DAYS = 30

export function displayNameCooldownDaysRemaining(displayNameChangedAt: string | null, now: Date): number {
  if (!displayNameChangedAt) return 0
  const unlockAt = new Date(displayNameChangedAt).getTime() + DISPLAY_NAME_COOLDOWN_DAYS * 86_400_000
  const msRemaining = unlockAt - now.getTime()
  return msRemaining <= 0 ? 0 : Math.ceil(msRemaining / 86_400_000)
}
