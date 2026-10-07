import { Card } from '@/components/ui/Card'
/**
 * Aviso de que a troca da conta Discord vinculada não pode ser feita pelo
 * usuário — precisa ser solicitada a um administrador.
 */
export function DiscordAccountNotice() {
  return (
    <Card variant="inset" padding="xs" className="space-y-2">
      <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Conta Discord</p>
      <p className="text-xs text-ink-secondary leading-relaxed">
        Precisa trocar a conta do Discord vinculada? Por segurança, essa alteração deve ser
        solicitada a um administrador.
      </p>
    </Card>
  )
}
