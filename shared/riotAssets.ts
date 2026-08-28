// shared/riotAssets.ts
// Base da CDN da Community Dragon pra emblemas de rank (ranked-mini-crests)
// -- MESMA constante usada pro SVG ao vivo no frontend (src/lib/riotAssets.ts,
// riotRankEmblemUrl) e pro PNG ao vivo nos embeds do Discord
// (supabase/functions/_shared/discordRankFormat.ts, rankIconUrl). Extraído
// pra cá pra não duplicar o literal entre os dois runtimes e divergir se a
// Riot mudar o path um dia.
//
// Roda nos dois runtimes (Vite/React e as Edge Functions Deno) -- não
// importe nada de `@/...` nem de APIs específicas de browser/Deno aqui.
export const CDRAGON_RANK_CREST_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests'
