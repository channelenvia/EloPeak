import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'light') return 'light'
  } catch { /* private browsing — ignore */ }
  return 'dark'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  return (
    <button
      type="button"
      onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
      aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
      className="p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors"
    >
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  )
}
