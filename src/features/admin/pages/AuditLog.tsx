import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { EmptyState, Pagination, SearchInput, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui'
import { timeAgo } from '@/lib/utils'
import { useAdminAuditLogs } from '@/api/admin'
import { usePagedList } from '@/hooks/usePagedList'
import type { AuditLogEntry } from '@/api/admin'

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', booster: 'Booster', customer: 'Cliente' }

// diff é heterogêneo por ação (reason+from/to num RPC, order_id+result
// noutro, sem reason nenhum num terceiro -- o motivo de order.status_override
// por exemplo mora em order_status_history, não aqui) -- em vez de assumir
// uma chave fixa, renderiza um resumo genérico compacto de todas as chaves.
function formatDiff(diff: AuditLogEntry['diff']): string {
  if (!diff || Object.keys(diff).length === 0) return '—'
  return Object.entries(diff)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
}

// Só 'order' linka direto (entity_id já é o id do pedido); os demais
// (booster/customer/duo_account/order_drop_request/review) ficam como texto
// -- linkar exigiria mapear entity_id pro id de rota de cada tela, que usa
// uma chave diferente (ex.: booster_profiles.id, não o user_id) em vários casos.
function EntityCell({ entry }: { entry: AuditLogEntry }) {
  const shortId = entry.entity_id.length > 8 ? `${entry.entity_id.slice(0, 8)}…` : entry.entity_id
  if (entry.entity_type === 'order') {
    return (
      <Link to={`/admin/orders/${entry.entity_id}`} className="font-mono text-xs text-brand hover:underline">
        #{shortId.toUpperCase()}
      </Link>
    )
  }
  return <span className="font-mono text-xs text-ink-muted">{entry.entity_type}:{shortId}</span>
}

export function AdminAuditLogPage() {
  const [search, setSearch] = useState('')
  const { data: logs, isLoading } = useAdminAuditLogs()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return logs ?? []
    return (logs ?? []).filter((entry) =>
      entry.action.toLowerCase().includes(q)
      || entry.entity_type.toLowerCase().includes(q)
      || entry.entity_id.toLowerCase().includes(q)
      || (entry.actor?.username?.toLowerCase().includes(q) ?? false),
    )
  }, [logs, search])

  const { page, pageItems, hasNextPage, onPrev, onNext } = usePagedList(filtered, 30, search)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Log de Auditoria</h1>
        <p className="text-sm text-ink-secondary mt-1">Toda ação administrativa (drop, reatribuição, refund, override, ajuste de saldo...) com quem fez, quando e por quê.</p>
      </div>

      {(logs?.length ?? 0) >= 300 && (
        <p className="text-xs text-warning">Mostrando as 300 entradas mais recentes — pode haver mais.</p>
      )}

      <SearchInput
        wrapperClassName="w-full sm:w-72 shrink-0"
        placeholder="Buscar por ação, entidade ou admin..."
        aria-label="Buscar no log de auditoria"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
      ) : !filtered.length ? (
        <EmptyState icon={History} title="Nenhuma entrada encontrada" />
      ) : (
        <>
          <div className="card p-0 backdrop-blur-none shadow-none bg-bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap" title={new Date(entry.created_at).toLocaleString('pt-BR')}>
                      {timeAgo(entry.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ink">{entry.action}</TableCell>
                    <TableCell><EntityCell entry={entry} /></TableCell>
                    <TableCell>
                      {entry.actor?.username ?? entry.actor_id.slice(0, 8)}
                      <span className="ml-1.5 text-[10px] text-ink-muted uppercase">{ROLE_LABEL[entry.actor_role] ?? entry.actor_role}</span>
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate text-xs" title={formatDiff(entry.diff)}>
                      {formatDiff(entry.diff)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}
    </div>
  )
}
