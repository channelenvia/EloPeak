import { Fragment, useRef, type ElementType } from 'react'
import { m, useInView } from 'framer-motion'
import { cn } from '@/lib/cn'

interface WordsHeadingProps {
  text: string
  as?: ElementType
  className?: string
  /** Palavras (por índice) pintadas com o gradiente da marca. */
  highlight?: readonly number[]
}

const WORD_STAGGER_S = 0.045

// Título que sobe palavra por palavra, cada uma saindo de uma máscara. Observa o
// título inteiro: a palavra, deslocada dentro da máscara, nunca "cruzaria" a tela.
export function WordsHeading({ text, as: Tag = 'h2', className, highlight = [] }: WordsHeadingProps) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const words = text.split(/\s+/)
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {words.map((word, i) => (
        <Fragment key={i}>
          <span aria-hidden="true" className="inline-block overflow-hidden align-top pb-[0.08em] -mb-[0.08em]">
            <m.span
              className={cn('inline-block', highlight.includes(i) && 'text-gradient-brand')}
              initial={false}
              animate={{ y: inView ? 0 : '108%' }}
              transition={{ duration: 0.9, delay: i * WORD_STAGGER_S, ease: [0.23, 1, 0.32, 1] }}
            >
              {word}
            </m.span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  )
}
