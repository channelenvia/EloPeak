// Vocabulário fixo de lanes e especialidades de coach — fonte única, usado
// tanto no perfil profissional do booster quanto nos pacotes de coach
// (booster_services.lanes/specialties), pra manter os mesmos valores em
// todo lugar (picker, badges públicos, check constraints no banco).

export const LANES = [
  { key: 'top',     label: 'Topo'     },
  { key: 'jungle',  label: 'Selva'    },
  { key: 'mid',     label: 'Meio'     },
  { key: 'bot',     label: 'Atirador' },
  { key: 'support', label: 'Suporte'  },
] as const

export const LANE_LABEL: Record<string, string> = Object.fromEntries(LANES.map(l => [l.key, l.label]))

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
