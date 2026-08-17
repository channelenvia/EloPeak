import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  /** Slot opcional entre o título e o botão de fechar — ex.: um badge de status. */
  headerExtra?: React.ReactNode
  contentClassName?: string
}

const MAX_WIDTH = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl' }

export function Modal({ open, onOpenChange, title, description, children, maxWidth = 'md', headerExtra, contentClassName }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Scrim — usa o token dedicado (--color-bg-scrim), sempre com alpha,
            nunca cor sólida. O Presence interno do Radix já atrasa o unmount
            até a animação de saída terminar, então data-[state] + utilities
            do tailwindcss-animate bastam, sem precisar coordenar
            AnimatePresence manualmente aqui. */}
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-bg-scrim/70 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-base',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-fast',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2',
            'card-raised p-6 space-y-4 focus:outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-panel data-[state=open]:ease-out',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-fast',
            MAX_WIDTH[maxWidth],
            contentClassName,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-ink-secondary mt-1">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerExtra}
              <Dialog.Close className="focus-ring p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-bg-elevated transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
