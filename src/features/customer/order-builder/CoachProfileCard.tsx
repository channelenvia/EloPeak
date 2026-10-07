import { useEffect, useRef, useState } from 'react'
import { Clock, CheckCircle2, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { LucideIcon } from 'lucide-react'
import { specialtyIcon } from '@/components/service/specialtyIcon'
import { LANE_ICON_URL, LANE_LABEL, SPECIALTY_LABEL } from '@/lib/lolTaxonomy'
import { championIconUrl, useDdragonChampionIds, useDdragonVersion } from '@/lib/ddragon'
import type { BoosterService } from '@/types'
import type { CoachBoosterInfo } from '@/api/coaching/types'
import { showDescription } from './showDescription'

const COLLAPSED_PACKAGE_LIMIT = 3

interface CoachProfileCardProps {
  booster: CoachBoosterInfo | undefined
  packages: BoosterService[]
  selectedPackageId: string | undefined
  onOpen: () => void
}

function BoosterStats({ booster, packageCount }: { booster: CoachBoosterInfo | undefined; packageCount: number }) {
  return (
    <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap">
      {booster?.rating != null && (
        <span className="flex items-center gap-0.5">
          <Star className="h-3 w-3 fill-warning text-warning" />
          {booster.rating.toFixed(1)}
          {booster.rating_count ? ` (${booster.rating_count})` : ''}
        </span>
      )}
      {booster?.total_completed ? <span>{booster.total_completed} pedidos concluídos</span> : null}
      <span>{packageCount} {packageCount === 1 ? 'pacote' : 'pacotes'}</span>
    </div>
  )
}

export function CoachProfileCard({ booster, packages, selectedPackageId, onOpen }: CoachProfileCardProps) {
  const currency = useCurrency()
  const name = booster?.display_name ?? 'Booster'
  const hasSelected = packages.some(p => p.id === selectedPackageId)
  const visible = packages.slice(0, COLLAPSED_PACKAGE_LIMIT)
  const hidden = packages.length - visible.length

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'text-left rounded-2xl border-2 overflow-hidden flex flex-col transition-all focus-ring',
        hasSelected ? 'border-brand bg-brand/10' : 'border-border-subtle bg-bg-surface hover:border-brand/30',
      )}
    >
      <div className="h-1 bg-success shrink-0 w-full" />
      <div className="p-4 flex items-center gap-3">
        <Avatar src={booster?.avatar_url} name={name} size="xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-ink truncate">{name}</p>
            {booster?.is_top3 && <Badge variant="warning" size="tag">Top 3</Badge>}
            {hasSelected && <CheckCircle2 className="h-4 w-4 text-brand shrink-0" />}
          </div>
          <BoosterStats booster={booster} packageCount={packages.length} />
        </div>
      </div>
      <div className="px-4 pb-4 flex flex-col gap-2 w-full">
        {visible.map(p => (
          <div
            key={p.id}
            className={cn(
              'rounded-xl border px-3 py-2',
              p.id === selectedPackageId ? 'border-brand bg-brand/10' : 'border-border-subtle bg-bg-raised/40',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink truncate">{p.title}</span>
              <span className="text-sm font-bold text-brand shrink-0">{currency(p.price)}</span>
            </div>
          </div>
        ))}
        {hidden > 0 && <span className="text-xs font-medium text-brand px-1">+{hidden} {hidden === 1 ? 'pacote' : 'pacotes'}</span>}
      </div>
    </button>
  )
}

interface CoachProfilePanelProps {
  booster: CoachBoosterInfo | undefined
  packages: BoosterService[]
  selectedPackageId: string | undefined
  onClose: () => void
  onHire: (pkg: BoosterService) => void
}

// Mesmo visual do formulário de cadastro de serviço do booster (label em caixa
// alta + chips "selecionados"), pro cliente ler o pacote como o coach o montou.
export function PackageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{title}</p>
      {children}
    </div>
  )
}

type ChipTone = 'success' | 'warning' | 'neutral'

const CHIP_TONE: Record<ChipTone, string> = {
  success: 'bg-success/15 border-success text-success',
  warning: 'bg-warning/15 border-warning text-warning',
  neutral: 'bg-bg-raised border-border-subtle text-ink-secondary',
}

interface Chip { label: string; iconUrl?: string | null; icon?: LucideIcon }

function ChipList({ items, tone }: { items: Chip[]; tone: ChipTone }) {
  return (
    <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
      {items.map(({ label, iconUrl, icon: Icon }) => (
        <span key={label} title={label} className={cn('inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-bold border-2', CHIP_TONE[tone])}>
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              className="h-4 w-4 shrink-0 rounded-sm object-cover"
              loading="lazy"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <span className="truncate">{label}</span>
        </span>
      ))}
    </div>
  )
}

// Rotas / Campeões / Especialidades em colunas de largura fixa (cabem os
// limites 2/3/N de chips), igual no perfil do coach e no resumo do pedido.
export function CoachPackageTags({ pkg }: { pkg: Pick<BoosterService, 'lanes' | 'champions' | 'specialties'> }) {
  const ddragonVersion = useDdragonVersion()
  const championIds = useDdragonChampionIds(ddragonVersion)
  return (
    <div className="grid sm:grid-cols-[11rem_18rem_minmax(0,1fr)] gap-x-4 gap-y-3 pt-3 border-t border-border-subtle">
      <PackageSection title="Rotas">
        <ChipList items={(pkg.lanes ?? []).map(l => ({ label: LANE_LABEL[l] ?? l, iconUrl: LANE_ICON_URL[l] }))} tone="success" />
      </PackageSection>
      <PackageSection title="Campeões">
        <ChipList items={(pkg.champions ?? []).map(c => ({ label: c, iconUrl: championIds ? championIconUrl(c, ddragonVersion, championIds) : null }))} tone="warning" />
      </PackageSection>
      <PackageSection title="Especialidades">
        <ChipList items={(pkg.specialties ?? []).map(sp => ({ label: SPECIALTY_LABEL[sp] ?? sp, icon: specialtyIcon(sp) }))} tone="neutral" />
      </PackageSection>
    </div>
  )
}

export function CoachProfilePanel({ booster, packages, selectedPackageId, onClose, onHire }: CoachProfilePanelProps) {
  const currency = useCurrency()
  const name = booster?.display_name ?? 'Booster'
  const ref = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState(() => packages.find(p => p.id === selectedPackageId)?.id ?? packages[0]?.id)
  const active = packages.find(p => p.id === activeId) ?? packages[0]
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [])
  if (!active) return null
  return (
    <div ref={ref} className="rounded-2xl border-2 border-brand/40 bg-bg-surface shadow-lg ring-4 ring-brand/10 overflow-hidden">
      <div className="h-1 bg-success" />
      <div className="p-4 flex items-center gap-3">
        <Avatar src={booster?.avatar_url} name={name} size="xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-bold text-ink truncate">{name}</p>
            {booster?.is_top3 && <Badge variant="warning" size="tag">Top 3</Badge>}
          </div>
          <BoosterStats booster={booster} packageCount={packages.length} />
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar perfil" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div role="tablist" aria-label="Pacotes" className="px-4 flex gap-2 overflow-x-auto">
        {packages.map(pkg => (
          <button
            key={pkg.id}
            type="button"
            role="tab"
            aria-selected={pkg.id === active.id}
            onClick={() => setActiveId(pkg.id)}
            className={cn(
              'shrink-0 max-w-64 text-left rounded-xl border-2 px-3.5 py-2 transition-all focus-ring',
              pkg.id === active.id ? 'bg-brand/15 border-brand' : 'border-border-subtle hover:border-brand/40',
            )}
          >
            <span className={cn('flex items-center gap-1.5 text-sm font-bold', pkg.id === active.id ? 'text-brand' : 'text-ink-secondary')}>
              <span className="truncate">{pkg.title}</span>
              {pkg.id === selectedPackageId && <CheckCircle2 className="h-3.5 w-3.5 text-brand shrink-0" />}
            </span>
            <span className="text-xs font-bold text-ink-muted">{currency(pkg.price)}</span>
          </button>
        ))}
      </div>

      <section role="tabpanel" className="mx-4 mb-4 mt-3 rounded-2xl border-2 border-border-subtle bg-bg-raised/30 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-ink truncate">{active.title}</h3>
          <span className="text-lg font-bold text-brand shrink-0">{currency(active.price)}</span>
        </div>
        <CoachPackageTags pkg={active} />
        {(showDescription(active) || active.requirements) && (
          <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3">
            {showDescription(active) && (
              <PackageSection title="Sobre o pacote">
                <p className="text-sm text-ink-secondary leading-snug whitespace-pre-line">{active.description}</p>
              </PackageSection>
            )}
            {active.requirements && (
              <PackageSection title="Requisitos">
                <p className="text-sm text-ink-secondary leading-snug whitespace-pre-line">{active.requirements}</p>
              </PackageSection>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-subtle">
          {active.tempo ? (
            <span className="flex items-center gap-1.5 text-sm text-ink-secondary">
              <Clock className="h-4 w-4 text-ink-muted" />{active.tempo}
            </span>
          ) : <span />}
          <Button onClick={() => onHire(active)}>Contratar e continuar</Button>
        </div>
      </section>
    </div>
  )
}
