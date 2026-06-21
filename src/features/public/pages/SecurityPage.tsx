import { Shield, Lock, Eye, Cpu, Server, CreditCard } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function SecurityPage() {
  const { t } = useTranslation()

  const PILLARS = [
    {
      icon: Shield,
      title: t('security.pillars.accountProtection'),
      items: [
        t('security.items.vpn'),
        t('security.items.offline'),
        t('security.items.noCredentials'),
        t('security.items.cleanIp'),
      ],
    },
    {
      icon: Lock,
      title: t('security.pillars.authSessions'),
      items: [
        t('security.items.bcrypt'),
        t('security.items.jwt'),
        t('security.items.revocation'),
        t('security.items.2fa'),
      ],
    },
    {
      icon: CreditCard,
      title: t('security.pillars.paymentSecurity'),
      items: [
        t('security.items.payment'),
        t('security.items.pci'),
        t('security.items.webhook'),
        t('security.items.idempotent'),
      ],
    },
    {
      icon: Eye,
      title: t('security.pillars.privacy'),
      items: [
        t('security.items.minimal'),
        t('security.items.noEmail'),
        t('security.items.privateUrls'),
        t('security.items.deletion'),
      ],
    },
    {
      icon: Cpu,
      title: t('security.pillars.accessControl'),
      items: [
        t('security.items.rls'),
        t('security.items.boosters'),
        t('security.items.audit'),
        t('security.items.serverSide'),
      ],
    },
    {
      icon: Server,
      title: t('security.pillars.infrastructure'),
      items: [
        t('security.items.encrypted'),
        t('security.items.soc2'),
        t('security.items.backups'),
      ],
    },
  ]

  return (
    <div className="py-16">
      <div className="container-app max-w-5xl space-y-16">
        <div className="text-center">
          <p className="section-label mb-3">{t('security.sectionLabel')}</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">{t('security.title')}</h1>
          <p className="text-lg text-ink-secondary max-w-xl mx-auto">
            {t('security.subtitle')}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PILLARS.map(({ icon: Icon, title, items }) => (
            <div key={title} className="card p-6 space-y-4">
              <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-success" />
              </div>
              <h3 className="font-semibold text-ink">{title}</h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item} className="text-xs text-ink-secondary flex items-start gap-2">
                    <span className="text-success mt-px">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
