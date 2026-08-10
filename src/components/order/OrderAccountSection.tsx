import type { ReactNode } from 'react'
import { KeyRound } from 'lucide-react'
import { Card } from '@/components/ui'

export function OrderAccountSection({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <Card padding="none" className="overflow-hidden h-full flex flex-col">
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-3">
        <KeyRound className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">Conta do pedido</h3>
        {status && <div className="ml-auto">{status}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {children}
      </div>
    </Card>
  )
}
