import { useState } from 'react'
import { EMPTY_SERVICE_FORM, type ServiceFormData } from '@/features/booster/utils/boosterServiceForm'
import { LANES, COACH_SPECIALTIES } from '@/lib/lolTaxonomy'
import { cn } from '@/lib/utils'

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

  function field(k: 'title' | 'description' | 'tempo' | 'price') {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setData(d => ({ ...d, [k]: e.target.value }))
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
      specialties: d.specialties.includes(key) ? d.specialties.filter(s => s !== key) : [...d.specialties, key],
    }))
  }

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
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Duração / prazo estimado <span className="text-danger">*</span></label>
          <input
            value={data.tempo}
            onChange={field('tempo')}
            maxLength={50}
            placeholder="Ex: 1h por sessão"
            className="input-base w-full text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Valor (R$) <span className="text-danger">*</span></label>
          <input
            value={data.price}
            onChange={field('price')}
            type="number"
            min="0"
            max="10000"
            step="0.01"
            placeholder="0,00"
            className="input-base w-full text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
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
                  'px-3.5 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                  selected
                    ? 'bg-brand/15 border-brand text-brand'
                    : disabled
                      ? 'border-bg-elevated text-ink-muted opacity-40 cursor-not-allowed'
                      : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Especialidades <span className="text-danger">*</span></label>
        <div className="flex flex-wrap gap-2">
          {COACH_SPECIALTIES.map(({ key, label }) => {
            const selected = data.specialties.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSpecialty(key)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                  selected
                    ? 'bg-brand/15 border-brand text-brand'
                    : 'border-bg-elevated text-ink-secondary hover:border-brand/40 hover:text-ink',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

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
