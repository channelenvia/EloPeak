// Vocabulário fixo de lanes e especialidades de coach — fonte única, usado
// tanto no perfil profissional do booster quanto nos pacotes de coach
// (booster_services.lanes/specialties), pra manter os mesmos valores em
// todo lugar (picker, badges públicos, check constraints no banco).

import type { RankTier } from '@/types'

export const LANES = [
  { key: 'top',     label: 'Topo'     },
  { key: 'jungle',  label: 'Selva'    },
  { key: 'mid',     label: 'Meio'     },
  { key: 'bot',     label: 'Atirador' },
  { key: 'support', label: 'Suporte'  },
] as const

export const LANE_LABEL: Record<string, string> = Object.fromEntries(LANES.map(l => [l.key, l.label]))

const LOL_POSITION_ASSET_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg'

// Ícones oficiais usados pelo cliente do LoL, servidos pelo espelho de assets
// do CommunityDragon. As chaves internas do produto são traduzidas para os
// nomes usados pelo cliente: bot -> bottom e support -> utility.
export const LANE_ICON_URL: Record<string, string> = {
  top: `${LOL_POSITION_ASSET_BASE}/position-top.svg`,
  jungle: `${LOL_POSITION_ASSET_BASE}/position-jungle.svg`,
  mid: `${LOL_POSITION_ASSET_BASE}/position-middle.svg`,
  bot: `${LOL_POSITION_ASSET_BASE}/position-bottom.svg`,
  support: `${LOL_POSITION_ASSET_BASE}/position-utility.svg`,
}

export const COACH_SPECIALTIES = [
  { key: 'macro',         label: 'Macro'             },
  { key: 'micro',         label: 'Micro'             },
  { key: 'wave_control',  label: 'Controle de Wave'  },
  { key: 'invades',       label: 'Invades'           },
  { key: 'vision',        label: 'Visão de Mapa'     },
  { key: 'trades',        label: 'Trocas (Trades)'   },
  { key: 'teamfighting',  label: 'Teamfight'         },
  { key: 'laning_phase',  label: 'Fase de Rotas'     },
  { key: 'objectives',    label: 'Objetivos'         },
  { key: 'itemization',   label: 'Itemização'        },
  { key: 'matchups',      label: 'Matchups'          },
  { key: 'mindset',       label: 'Mentalidade'       },
] as const

export const SPECIALTY_LABEL: Record<string, string> = Object.fromEntries(COACH_SPECIALTIES.map(s => [s.key, s.label]))

export const TEMPO_OPTIONS = [
  '30 minutos',
  '1 hora',
  '1 hora e 30 minutos',
  '2 horas',
  '2 horas e 30 minutos',
  '3 horas',
  '3 horas+',
] as const

// Agrupamento de ranks em 3 faixas — mesma semântica de
// rank_bucket_of() no banco (supabase/migrations/054_booster_performance_segments.sql):
// tiers de Clash entram na mesma faixa que qualquer outro serviço, já que o
// agrupamento é só por rank_bucket, sem olhar service_type/queue_type. Fonte
// única usada tanto no dashboard do booster quanto no perfil público — antes
// duplicada localmente em cada um.
export type RankPerformanceGroupKey = 'gold_minus' | 'plat_diamond' | 'master_plus'

export const RANK_PERFORMANCE_GROUPS: { key: RankPerformanceGroupKey; label: string; sublabel: string; tiers: RankTier[] }[] = [
  { key: 'gold_minus',   label: 'Ouro-',       sublabel: 'Ferro · Bronze · Prata · Ouro',      tiers: ['iron', 'bronze', 'silver', 'gold'] },
  { key: 'plat_diamond', label: 'Platina - Diamante',  sublabel: 'Platina · Esmeralda · Diamante',     tiers: ['platinum', 'emerald', 'diamond'] },
  { key: 'master_plus',  label: 'Mestre+',            sublabel: 'Mestre · Grão-mestre · Desafiante', tiers: ['master', 'grandmaster', 'challenger'] },
]
