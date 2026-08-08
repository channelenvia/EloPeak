import { cn } from '@/lib/utils'

interface FormFieldProps {
  label?: string
  /** Optional node rendered to the right of the label, e.g. an "Editar"
   * unlock affordance for fields locked after a Riot auto-fill. */
  labelAction?: React.ReactNode
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function FormField({ label, labelAction, error, hint, required, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <label className="label-base">
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
