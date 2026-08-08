import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'brand' | 'glass'
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddingMap = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

const variantMap = {
  default: 'card',
  elevated: 'card-raised',
  brand: 'card-brand',
  glass: 'card-glass',
}

export function Card({ className, variant = 'default', padding = 'md', children, ...props }: CardProps) {
  return (
    <div className={cn(variantMap[variant], paddingMap[padding], className)} {...props}>
      {children}
    </div>
  )
}
