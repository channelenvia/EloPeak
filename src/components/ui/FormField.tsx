import { cn } from '@/lib/utils'

interface FormFieldProps {
  label?: string
  /** Optional node rendered to the right of the label, e.g. an "Editar"
   * unlock affordance for fields locked after a Riot auto-fill. */
  labelAction?: React.ReactNode
  /** id of the single focusable control inside `children` (input/textarea/
   * select) -- required to make the label programmatically associated
   * (`htmlFor`). Without it the label is visual-only for assistive tech.
   * Omit for fields that wrap a button group instead of one control (those
   * need `role="radiogroup"`/`aria-pressed` on the buttons, not htmlFor). */
  id?: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function FormField({ label, labelAction, id, error, hint, required, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={id} className="label-base">
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </label>
          {labelAction}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  )
}
