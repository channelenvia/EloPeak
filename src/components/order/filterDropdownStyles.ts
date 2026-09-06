import { cn } from '@/lib/utils'

// Estilo compartilhado pelos 3 triggers de filtro em dropdown (status,
// categoria de serviço, subfiltros de tipo) -- fonte única pra garantir que
// os 3 fiquem do mesmo tamanho do campo de busca ao lado (input-base com
// pl-8 py-1.5 text-xs: mesma altura de padding/fonte aqui).
export function filterTriggerClass(open: boolean): string {
  return cn(
    'flex items-center gap-1.5 border border-border-subtle bg-bg-surface px-3 py-1.5 shadow-sm hover:border-brand/40 hover:shadow-brand transition-all text-xs font-bold text-brand',
    open ? 'rounded-t-lg border-b-0' : 'rounded-lg',
  )
}

export const FILTER_CHEVRON_CLASS = 'h-3 w-3 text-ink-muted transition-transform shrink-0'

// Linha de opção dentro do painel do dropdown (lista vertical) -- mesmo
// padrão nas 3 listas (status, categoria).
export function filterOptionRowClass(active: boolean): string {
  return cn(
    'flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-left transition-colors whitespace-nowrap',
    active ? 'font-bold text-brand bg-brand/5' : 'font-medium text-ink-secondary hover:bg-bg-raised',
  )
}
