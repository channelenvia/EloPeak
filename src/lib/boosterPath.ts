const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isBoosterProfileId(ref: string): boolean {
  return UUID_PATTERN.test(ref)
}

// URL publica do perfil = nome de exibicao do booster (unico, sem diferenciar maiusculas): /boosters/<nome>.
// Endereco por id continua resolvendo em getPublicBooster, so como compatibilidade.
export function boosterProfilePath(booster: { display_name: string }): string {
  return `/boosters/${encodeURIComponent(booster.display_name)}`
}

// ilike trata % _ \ como curingas: escapa para casar o nome literal (a unicidade do nome e case-insensitive).
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}
