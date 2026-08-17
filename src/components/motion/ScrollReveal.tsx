import { motion, type HTMLMotionProps } from 'framer-motion'

interface ScrollRevealProps extends Omit<HTMLMotionProps<'div'>, 'initial' | 'whileInView' | 'viewport'> {
  /** Atraso em segundos, pra escalonar uma lista (i * 0.08, por exemplo). */
  delay?: number
  /** Distância em px que o elemento percorre entrando (eixo Y). */
  distance?: number
}

// Wrapper único pro padrão de reveal-on-scroll já usado manualmente em
// HomePage/BoostersPage (initial+whileInView+viewport idênticos repetidos
// em cada motion.div) -- reduzido a um componente, pra reusar nas outras
// páginas públicas sem copiar/colar as 3 props toda vez. Respeita
// prefers-reduced-motion automaticamente via MotionConfig (Providers).
export function ScrollReveal({ delay = 0, distance = 20, transition, ...props }: ScrollRevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ...transition }}
      {...props}
    />
  )
}
