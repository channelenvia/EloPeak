import { Children } from 'react'
import { cn } from '@/lib/cn'

// Rodapé de ações padrão (modais, formulários, passos): cancelar/voltar/
// reiniciar à ESQUERDA (variant secondary), confirmar/avançar/concluir à DIREITA
// (primary/danger). Botões com o mesmo tamanho; no mobile empilha com a ação
// principal por cima. Um botão só fica à direita.
export function ActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  const count = Children.toArray(children).length
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center',
        count > 1 ? 'sm:justify-between' : 'sm:justify-end',
        '[&>button]:min-w-28 max-sm:[&>button]:w-full',
        className,
      )}
    >
      {children}
    </div>
  )
}
