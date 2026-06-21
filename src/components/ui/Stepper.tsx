import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  id: string
  label: string
  description?: string
}

interface StepperProps {
  steps: Step[]
  currentStep: string
  completedSteps?: string[]
}

export function Stepper({ steps, currentStep, completedSteps = [] }: StepperProps) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-0">
        {steps.map((step, idx) => {
          const isCompleted = completedSteps.includes(step.id)
          const isCurrent = step.id === currentStep
          const isLast = idx === steps.length - 1

          return (
            <li key={step.id} className={cn('flex items-center', !isLast && 'flex-1')}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all',
                    isCompleted && 'border-brand bg-brand text-white',
                    isCurrent && !isCompleted && 'border-brand bg-brand-muted text-brand',
                    !isCurrent && !isCompleted && 'border-bg-overlay bg-bg-surface text-ink-muted'
                  )}
                >
                  {isCompleted ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs whitespace-nowrap font-medium',
                    (isCurrent || isCompleted) ? 'text-ink' : 'text-ink-muted'
                  )}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={cn(
                    'h-px flex-1 mx-2 mt-[-1rem]',
                    isCompleted ? 'bg-brand' : 'bg-bg-elevated'
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
