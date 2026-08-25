// Som de "você foi mencionado no chat" -- sintetizado via Web Audio API,
// mesmo espírito de orderSoundLibrary.ts (booster), mas com timbre
// deliberadamente diferente: duas notas curtas descendentes tipo "pop" de
// notificação de chat, em vez dos sinos/alertas ascendentes de novo pedido.

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

export function playMentionSound(context: AudioContext, volume: number) {
  if (context.state !== 'running') return
  const masterGain = context.createGain()
  masterGain.gain.value = Math.min(1, Math.max(0, volume))
  masterGain.connect(context.destination)

  const now = context.currentTime
  tone(context, masterGain, { type: 'triangle', startTime: now, duration: 0.18, freqStart: 1_480, freqEnd: 1_180, peak: 0.6 })
  tone(context, masterGain, { type: 'triangle', startTime: now + 0.1, duration: 0.22, freqStart: 1_020, freqEnd: 740, peak: 0.55 })
}
