/**
 * Aviso de que a troca da conta Discord vinculada não pode ser feita pelo
 * usuário — precisa ser solicitada a um administrador.
 */
export function DiscordAccountNotice() {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated/30 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Conta Discord</p>
      <p className="text-[11px] text-ink-secondary leading-relaxed">
        Precisa trocar a conta do Discord vinculada? Por segurança, essa alteração deve ser
        solicitada a um administrador.
      </p>
    </div>
  )
}
