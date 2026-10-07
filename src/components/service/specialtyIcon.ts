import {
  ArrowLeftRight, Backpack, Brain, Compass, Crosshair, Eye, Flag, Flame, Gem, Lightbulb, Map, MousePointerClick,
  Rocket, Route, Shield, Sparkles, Star, Swords, Target, Users, Waves, Zap, type LucideIcon,
} from 'lucide-react'

const SPECIALTY_ICON: Record<string, LucideIcon> = {
  macro: Map,
  micro: MousePointerClick,
  wave_control: Waves,
  invades: Swords,
  vision: Eye,
  trades: ArrowLeftRight,
  teamfighting: Users,
  laning_phase: Route,
  objectives: Flag,
  itemization: Backpack,
  matchups: Crosshair,
  mindset: Brain,
}

// Especialidades próprias (texto livre) não têm ícone fixo: sorteia um do
// pool, mas derivado do texto, pra ser o mesmo a cada render e em todas as telas.
const CUSTOM_ICON_POOL: LucideIcon[] = [Sparkles, Zap, Shield, Flame, Target, Lightbulb, Gem, Rocket, Compass, Star]

export function specialtyIcon(key: string): LucideIcon {
  const known = SPECIALTY_ICON[key]
  if (known) return known
  const hash = [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return CUSTOM_ICON_POOL[hash % CUSTOM_ICON_POOL.length]
}
