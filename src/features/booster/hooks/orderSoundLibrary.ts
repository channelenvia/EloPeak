// Catálogo de sons de "novo pedido disponível" — cada função sintetiza o som
// via Web Audio API (sem arquivos de áudio pra servir/baixar). Todas recebem
// o AudioContext já desbloqueado (ver useNewOrderSound) e um volume 0–1
// aplicado como ganho máximo do envelope.

export type OrderSoundId = 'coin' | 'chime' | 'alert' | 'arcade'

export const ORDER_SOUND_OPTIONS: { id: OrderSoundId; label: string }[] = [
  { id: 'coin', label: 'Moeda' },
  { id: 'chime', label: 'Sino' },
  { id: 'alert', label: 'Alerta' },
  { id: 'arcade', label: 'Arcade' },
]

function tone(
  context: AudioContext,
  masterGain: GainNode,
  { type, startTime, duration, freqStart, freqEnd, peak }: {
    type: OscillatorType
    startTime: number
    duration: number
    freqStart: number
    freqEnd?: number
    peak: number
  },
) {
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(peak, startTime + Math.min(0.01, duration / 4))
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
  gain.connect(masterGain)

  const osc = context.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freqStart, startTime)
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration * 0.6)
  osc.connect(gain)
  osc.start(startTime)
  osc.stop(startTime + duration)
}

function playCoin(context: AudioContext, masterGain: GainNode, now: number) {
  tone(context, masterGain, { type: 'sine', startTime: now, duration: 0.24, freqStart: 880, freqEnd: 1_320, peak: 0.9 })
  tone(context, masterGain, { type: 'triangle', startTime: now + 0.07, duration: 0.25, freqStart: 1_760, freqEnd: 2_200, peak: 0.7 })
}

function playChime(context: AudioContext, masterGain: GainNode, now: number) {
  // Sino de três notas ascendentes, tipo campainha de app de mensagens.
  tone(context, masterGain, { type: 'sine', startTime: now, duration: 0.45, freqStart: 1_046.5, peak: 0.8 })
  tone(context, masterGain, { type: 'sine', startTime: now + 0.12, duration: 0.45, freqStart: 1_318.5, peak: 0.7 })
  tone(context, masterGain, { type: 'sine', startTime: now + 0.24, duration: 0.55, freqStart: 1_568, peak: 0.65 })
}

function playAlert(context: AudioContext, masterGain: GainNode, now: number) {
  // Dois bipes curtos e firmes — mais urgente, pra quem quer notar de longe.
  tone(context, masterGain, { type: 'square', startTime: now, duration: 0.14, freqStart: 660, peak: 0.55 })
  tone(context, masterGain, { type: 'square', startTime: now + 0.19, duration: 0.14, freqStart: 660, peak: 0.55 })
}

function playArcade(context: AudioContext, masterGain: GainNode, now: number) {
  // Blip retrô em 4 degraus subindo, tipo coletar item de 8-bit.
  const steps = [523.25, 659.25, 783.99, 1_046.5]
  steps.forEach((freq, i) => {
    tone(context, masterGain, { type: 'square', startTime: now + i * 0.06, duration: 0.09, freqStart: freq, peak: 0.5 })
  })
}

const PLAYERS: Record<OrderSoundId, (context: AudioContext, masterGain: GainNode, now: number) => void> = {
  coin: playCoin,
  chime: playChime,
  alert: playAlert,
  arcade: playArcade,
}

// Volume 0–1 vira o teto do envelope de ganho de cada som — em vez de
// silenciar (state !== 'running'), quem chama decide isso antes (mute
// checado no hook, não aqui, pra permitir preview mesmo com alertas mutados).
export function playOrderSound(context: AudioContext, soundId: OrderSoundId, volume: number) {
  if (context.state !== 'running') return
  const masterGain = context.createGain()
  masterGain.gain.value = Math.min(1, Math.max(0, volume))
  masterGain.connect(context.destination)
  PLAYERS[soundId](context, masterGain, context.currentTime)
}
