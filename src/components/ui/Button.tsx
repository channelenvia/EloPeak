import { forwardRef } from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-white shadow-brand hover:bg-brand-hover hover:shadow-brand active:scale-[0.98]',
        accent:
          'bg-accent text-bg-base shadow-accent hover:bg-accent-hover active:scale-[0.98]',
        secondary:
          'bg-bg-elevated text-ink border border-bg-overlay hover:bg-bg-overlay hover:border-bg-overlay active:scale-[0.98]',
        ghost:
          'text-ink-secondary hover:text-ink hover:bg-bg-elevated active:scale-[0.98]',
        outline:
          'border border-bg-elevated text-ink-secondary hover:border-brand/50 hover:text-ink hover:bg-brand/10 active:scale-[0.98]',
        danger:
          'bg-danger text-white hover:bg-danger/90 active:scale-[0.98]',
        'danger-ghost':
          'text-danger hover:bg-danger/10 active:scale-[0.98]',
        success:
          'bg-success text-white hover:bg-success/90 active:scale-[0.98]',
        link:
          'text-brand underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs rounded-lg',
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-11 px-6 text-base',
        xl: 'h-12 px-8 text-base',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-7 w-7 p-0 rounded-lg',
        'icon-lg': 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, leftIcon, rightIcon, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'

    return (
      <Comp
        ref={ref}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          leftIcon
        )}
        <Slottable>{children}</Slottable>
        {!loading && rightIcon}
      </Comp>
    )
  }
)

Button.displayName = 'Button'
export { buttonVariants }
