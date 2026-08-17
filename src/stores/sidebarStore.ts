import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  /** Rail fixado expandido (clique no botão de pin) -- independe de hover.
   * Persistido porque é uma preferência de uso, não estado de sessão. */
  pinned: boolean
  togglePinned: () => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      pinned: false,
      togglePinned: () => set((s) => ({ pinned: !s.pinned })),
    }),
    { name: 'sidebar-pinned' },
  ),
)
