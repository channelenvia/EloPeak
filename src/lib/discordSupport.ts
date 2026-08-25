// Rotacionável via env sem deploy de código -- não fica hardcoded no bundle.
export const DISCORD_SUPPORT_URL = import.meta.env.VITE_DISCORD_TICKET_URL as string | undefined
