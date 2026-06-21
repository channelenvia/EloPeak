import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  leftElement?: React.ReactNode
  rightElement?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, leftElement, rightElement, ...props }, ref) => {
    if (leftElement || rightElement) {
      return (
        <div className="relative flex items-center">
          {leftElement && (
            <div className="absolute left-3 text-ink-muted pointer-events-none">{leftElement}</div>
          )}
          <input
            ref={ref}
            className={cn(
              'input-base',
              error && 'input-error',
              leftElement && 'pl-9',
              rightElement && 'pr-9',
              className
            )}
            {...props}
          />
          {rightElement && (
            <div className="absolute right-3 text-ink-muted">{rightElement}</div>
          )}
        </div>
      )
    }

    return (
      <input
        ref={ref}
        className={cn('input-base', error && 'input-error', className)}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn('input-base min-h-[100px] resize-y', error && 'input-error', className)}
      {...props}
    />
  )
)

Textarea.displayName = 'Textarea'
