import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { CurrencyMaskedInput } from '@/components/ui'
import { EMPTY_SERVICE_FORM, type ServiceFormData } from '@/features/booster/utils/boosterServiceForm'
import { LANES, COACH_SPECIALTIES, TEMPO_OPTIONS } from '@/lib/lolTaxonomy'
import { normalizeChampionName, resolveChampionName, useDdragonChampionIds, useDdragonVersion } from '@/lib/ddragon'
import { cn } from '@/lib/utils'

const MAX_PRICE_CENTS = 10000 * 100

const MAX_SPECIALTIES = 5
const MAX_CHAMPIONS = 3

// Campo de tags de texto livre com chips removíveis (usado por Campeões e
// pelas especialidades custom) -- `chips` é o que renderiza como pílula
// removível, `existingValues` é o conjunto completo usado pra contar contra
// `max` e checar duplicata (na aba Especialidades os dois divergem: as
// pré-definidas contam pro total mas não viram chip aqui, já que já têm
// botão de toggle próprio em `children`).
function TagListInput({
  label, required, max, chips, existingValues, onAdd, onRemove, placeholder, maxLength, children,
}: {
  label: string
  required?: boolean
  max: number
  chips: string[]
  existingValues: string[]
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  placeholder: string
  maxLength: number
  children?: ReactNode
}) {
  const [value, setValue] = useState('')

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || existingValues.length >= max || existingValues.includes(trimmed)) return
    onAdd(trimmed)
    setValue('')
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wide text-ink-muted">
        {label} {required && <span className="text-danger">*</span>}{' '}
        <span className="normal-case font-normal">(máx. {max}{required ? '' : ', opcional'})</span>
      </label>
      {children}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map(chip => (
            <span
              key={chip}
              className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl text-sm font-bold border-2 bg-brand/15 border-brand text-brand"
            >
              {chip}
              <button
                type="button"
                onClick={() => onRemove(chip)}
                aria-label={`Remover ${chip}`}
                className="p-0.5 rounded-full hover:bg-brand/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {existingValues.length < max && (
        <div className="flex gap-2">
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            maxLength={maxLength}
            placeholder={placeholder}
            className="input-base w-full text-sm"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-xl text-sm font-bold text-brand border-2 border-brand/40 hover:bg-brand/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  )
}

export function BoosterServiceForm({
  initial = EMPTY_SERVICE_FORM,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ServiceFormData
  onSave: (data: ServiceFormData) => void
  onCancel: () => void
  saving: boolean
}) {
  const [data, setData] = useState<ServiceFormData>(initial)
  const ddragonVersion = useDdragonVersion()
  const championIndex = useDdragonChampionIds(ddragonVersion)

  function field(k: 'title' | 'description') {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setData(d => ({ ...d, [k]: e.target.value }))
  }

  const priceCents = Math.round(parseFloat(data.price || '0') * 100) || 0

  function handlePriceCentsChange(cents: number) {
    setData(d => ({ ...d, price: (cents / 100).toFixed(2) }))
  }

  function toggleLane(key: string) {
    setData(d => ({
      ...d,
      lanes: d.lanes.includes(key) ? d.lanes.filter(l => l !== key) : d.lanes.length < 2 ? [...d.lanes, key] : d.lanes,
    }))
  }

  function toggleSpecialty(key: string) {
    setData(d => ({
      ...d,
      specialties: d.specialties.includes(key)
        ? d.specialties.filter(s => s !== key)
        : d.specialties.length < MAX_SPECIALTIES ? [...d.specialties, key] : d.specialties,
    }))
  }

  const predefinedSpecialtyKeys = new Set<string>(COACH_SPECIALTIES.map(s => s.key))
  const customSpecialties = data.specialties.filter(s => !predefinedSpecialtyKeys.has(s))

  const valid =
    data.title.trim().length > 0 &&
    data.description.trim().length > 0 &&
    data.tempo.trim().length > 0 &&
    parseFloat(data.price) > 0 &&
    parseFloat(data.price) <= 10000 &&
    data.lanes.length > 0 &&
    data.specialties.length > 0

  return (
    <div className="card border-brand/30 p-5 space-y-4">
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Título <span className="text-danger">*</span></label>
        <input
          value={data.title}
          onChange={field('title')}
          maxLength={60}
          placeholder="Ex: Coaching Macro Diamante+"
          className="input-base w-full text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Descrição <span className="text-danger">*</span></label>
          <span className="text-[10px] text-ink-muted">{data.description.length}/300</span>
        </div>
        <textarea
          value={data.description}
          onChange={field('description')}
          maxLength={300}
          rows={3}
          placeholder="Descreva o que está incluso na sessão..."
          className="input-base w-full text-sm resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Duração <span className="text-danger">*</span></label>
          <select
            value={data.tempo}
            onChange={e => setData(d => ({ ...d, tempo: e.target.value }))}
            className="input-base w-full text-sm"
          >
            <option value="" disabled>Selecione...</option>
            {data.tempo && !(TEMPO_OPTIONS as readonly string[]).includes(data.tempo) && (
              <option value={data.tempo}>{data.tempo}</option>
            )}
            {TEMPO_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Valor (R$) <span className="text-danger">*</span></label>
          <CurrencyMaskedInput
            valueCents={priceCents}
            onChangeCents={handlePriceCentsChange}
            maxCents={MAX_PRICE_CENTS}
            className="text-sm"
            aria-label="Valor do serviço"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wide text-ink-muted">
          Lanes <span className="text-danger">*</span> <span className="normal-case font-normal">(máx. 2)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {LANES.map(({ key, label }) => {
            const selected = data.lanes.includes(key)
            const disabled = !selected && data.lanes.length >= 2
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLane(key)}
                disabled={disabled}
                className={cn(
                  'px-3.5 py-2 rounded-xl text-sm font-bold border-2 transition-all',
                  selected
                    ? 'bg-brand/15 border-brand text-brand'
                    : disabled
                      ? 'border-border-subtle text-ink-muted opacity-40 cursor-not-allowed'
                      : 'border-border-subtle text-ink-secondary hover:border-brand/40 hover:text-ink',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <TagListInput
        label="Campeões"
        max={MAX_CHAMPIONS}
        chips={data.champions}
        existingValues={data.champions}
        onAdd={value => setData(d => {
          const canonicalName = resolveChampionName(value, championIndex)
          const normalizedName = normalizeChampionName(canonicalName)
          const alreadyAdded = d.champions.some(champion => normalizeChampionName(champion) === normalizedName)
          return alreadyAdded ? d : { ...d, champions: [...d.champions, canonicalName] }
        })}
        onRemove={value => setData(d => ({ ...d, champions: d.champions.filter(c => c !== value) }))}
        placeholder="Ex: Lee Sin"
        maxLength={30}
      />

      <TagListInput
        label="Especialidades"
        required
        max={MAX_SPECIALTIES}
        chips={customSpecialties}
        existingValues={data.specialties}
        onAdd={value => setData(d => ({ ...d, specialties: [...d.specialties, value] }))}
        onRemove={value => setData(d => ({ ...d, specialties: d.specialties.filter(s => s !== value) }))}
        placeholder="Adicionar especialidade própria..."
        maxLength={40}
      >
        <div className="flex flex-wrap gap-2">
          {COACH_SPECIALTIES.map(({ key, label }) => {
            const selected = data.specialties.includes(key)
            const disabled = !selected && data.specialties.length >= MAX_SPECIALTIES
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSpecialty(key)}
                disabled={disabled}
                className={cn(
                  'px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all',
                  selected
                    ? 'bg-brand/15 border-brand text-brand'
                    : disabled
                      ? 'border-border-subtle text-ink-muted opacity-40 cursor-not-allowed'
                      : 'border-border-subtle text-ink-secondary hover:border-brand/40 hover:text-ink',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </TagListInput>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm text-ink-secondary hover:bg-bg-elevated transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave(data)}
          disabled={!valid || saving}
          className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold hover:bg-brand/90 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
