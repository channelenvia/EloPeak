import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SidebarNavItem } from './AppSidebar'
import { filterNavItems } from './filterNavItems'

interface CommandPaletteProps {
  items: readonly SidebarNavItem[]
}

// Paleta de comandos (Ctrl/Cmd+K): busca e vai direto para qualquer página do painel.
export function CommandPalette({ items }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const results = useMemo(() => filterNavItems(items, query), [items, query])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((value) => !value)
      }
    }
    addEventListener('keydown', onKeyDown)
    return () => removeEventListener('keydown', onKeyDown)
  }, [])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) { setQuery(''); setCursor(0) }
  }

  const go = (item: SidebarNavItem | undefined) => {
    if (!item) return
    onOpenChange(false)
    navigate(item.href)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-scrim/70 backdrop-blur-xs data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-fast" />
        <Dialog.Content
          aria-describedby={undefined}
          className="card-raised fixed left-1/2 top-[18vh] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden p-0 focus:outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-fast"
        >
          <Dialog.Title className="sr-only">Ir para uma página</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border-subtle px-4">
            <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
              onKeyDown={onInputKeyDown}
              placeholder="Ir para…"
              aria-label="Buscar página"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={results[cursor] ? `cmd-${cursor}` : undefined}
              className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-hidden"
            />
            <kbd className="shrink-0 rounded-md border border-border-subtle px-1.5 py-0.5 font-mono text-2xs text-ink-muted">Esc</kbd>
          </div>
          <ul id="command-palette-list" role="listbox" className="max-h-72 overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">Nenhuma página encontrada.</li>}
            {results.map((item, i) => (
              <li key={item.href} id={`cmd-${i}`} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => go(item)}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors', i === cursor ? 'bg-brand/15 text-brand' : 'text-ink-secondary')}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
