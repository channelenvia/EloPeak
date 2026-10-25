import { m, type HTMLMotionProps } from 'framer-motion'

interface RiseProps extends Omit<HTMLMotionProps<'div'>, 'initial' | 'whileInView' | 'viewport'> {
  /** Posição na escada de entrada (cada degrau atrasa 90ms). */
  step?: number
}

const STEP_DELAY_S = 0.09

// Entrada ao aparecer: sobe 30px com mola leve e escala de .96 a 1.
export function Rise({ step = 0, transition, ...props }: RiseProps) {
  return (
    <m.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{
        opacity: { duration: 0.6, delay: step * STEP_DELAY_S },
        default: { duration: 0.8, delay: step * STEP_DELAY_S, ease: [0.34, 1.45, 0.64, 1] },
        ...transition,
      }}
      {...props}
    />
  )
}
