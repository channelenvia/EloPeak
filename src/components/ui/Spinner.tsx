import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpinnerProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }

export function Spinner({ className, size = 'md' }: SpinnerProps) {
  return <Loader2 className={cn('animate-spin text-brand', sizeMap[size], className)} />
}

export function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  )
}

export function SectionLoader({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Spinner />
      {message && <p className="text-sm text-ink-secondary">{message}</p>}
    </div>
  )
}
