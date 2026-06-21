import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-bg-elevated last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start justify-between gap-4 py-5 text-left"
      >
        <span className="text-sm font-semibold text-ink">{q}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-ink-muted shrink-0 mt-0.5 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <p className="pb-5 text-sm text-ink-secondary leading-relaxed -mt-1">{a}</p>
      )}
    </div>
  )
}

export function FAQPage() {
  const { t } = useTranslation()

  const FAQS = [
    { q: t('faq.q1'),  a: t('faq.a1')  },
    { q: t('faq.q2'),  a: t('faq.a2')  },
    { q: t('faq.q3'),  a: t('faq.a3')  },
    { q: t('faq.q4'),  a: t('faq.a4')  },
    { q: t('faq.q5'),  a: t('faq.a5')  },
    { q: t('faq.q6'),  a: t('faq.a6')  },
    { q: t('faq.q7'),  a: t('faq.a7')  },
    { q: t('faq.q8'),  a: t('faq.a8')  },
    { q: t('faq.q9'),  a: t('faq.a9')  },
    { q: t('faq.q10'), a: t('faq.a10') },
  ]

  return (
    <div className="py-16">
      <div className="container-app max-w-3xl">
        <div className="text-center mb-12">
          <p className="section-label mb-3">{t('faq.sectionLabel')}</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">{t('faq.title')}</h1>
          <p className="text-ink-secondary">
            {t('faq.cantFind')}{' '}
            <a href="/support" className="text-brand hover:underline">{t('faq.contactSupport')}</a>.
          </p>
        </div>

        <div className="card p-0 divide-y-0">
          <div className="px-6">
            {FAQS.map(({ q, a }) => (
              <FAQItem key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
