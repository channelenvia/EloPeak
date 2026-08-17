import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX, Play, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBoosterSoundStore } from '@/stores/boosterSoundStore'
import { ORDER_SOUND_OPTIONS, playOrderSound } from '@/features/booster/hooks/orderSoundLibrary'

/**
 * Popover de preferência do som de "novo pedido" -- volume, mute e escolha
 * entre os sons do catálogo (com preview). Mesmo padrão de popover ancorado
 * do NotificationBell (botão + painel absoluto + fecha ao clicar fora).
 * Um AudioContext próprio só pra preview -- o do alerta em si vive em
 * useNewOrderSound, desbloqueado no primeiro gesto do usuário no painel.
 */
export function OrderSoundSettings() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewContextRef = useRef<AudioContext | null>(null)

  const { soundId, volume, muted, setSoundId, setVolume, toggleMuted } = useBoosterSoundStore()

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    return () => {
      const context = previewContextRef.current
      previewContextRef.current = null
      if (context && context.state !== 'closed') void context.close()
    }
  }, [])

  function preview(id: typeof soundId) {
    if (!previewContextRef.current) previewContextRef.current = new AudioContext()
    const context = previewContextRef.current
    if (context.state === 'suspended') void context.resume()
    playOrderSound(context, id, volume)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors"
        aria-label="Som de novo pedido"
      >
        {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-bg-surface/90 backdrop-blur-xl border border-border-subtle rounded-2xl shadow-2xl z-50 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-ink">Som de Novo Pedido</p>
            <button
              onClick={() => toggleMuted()}
              className={cn(
                'flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors',
                muted
                  ? 'bg-danger/10 text-danger border-danger/20'
                  : 'bg-success/10 text-success border-success/20',
              )}
            >
              {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
              {muted ? 'Mutado' : 'Ativo'}
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="order-sound-volume" className="text-xs font-semibold text-ink-secondary">Volume</label>
              <span className="text-xs text-ink-muted" data-tabular>{Math.round(volume * 100)}%</span>
            </div>
            <input
              id="order-sound-volume"
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              disabled={muted}
              className="w-full accent-brand disabled:opacity-40"
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-secondary mb-2">Escolher som</p>
            <div className="space-y-1.5">
              {ORDER_SOUND_OPTIONS.map(({ id, label }) => (
                <div
                  key={id}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors',
                    soundId === id ? 'border-brand bg-brand/10' : 'border-border-subtle bg-bg-card',
                  )}
                >
                  <button
                    onClick={() => setSoundId(id)}
                    className={cn('flex-1 flex items-center gap-2 text-left text-xs font-medium', soundId === id ? 'text-brand' : 'text-ink-secondary')}
                  >
                    {soundId === id && <Check className="h-3.5 w-3.5 shrink-0" />}
                    {label}
                  </button>
                  <button
                    onClick={() => preview(id)}
                    aria-label={`Ouvir ${label}`}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-bg-elevated transition-colors shrink-0"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
