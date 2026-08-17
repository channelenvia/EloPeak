import { useState } from 'react'
import { CheckSquare, ListChecks, Plus } from 'lucide-react'
import { Card, Skeleton, Button, ErrorAlert } from '@/components/ui'
import { cn, formatDateTime } from '@/lib/utils'
import { useAddOrderCoachingTopic, useOrderCoachingTopics, useSetOrderCoachingTopicDone } from '@/api/orders'

// Registro colaborativo do passo a passo da sessão de coaching -- cliente e
// booster vão adicionando tópicos e marcando check conforme avançam. Sem
// distinção de UI por papel: a RPC já garante que só as duas partes do
// pedido (ou admin) conseguem ler/escrever aqui.
export function OrderCoachingTopics({ orderId }: { orderId: string }) {
  const { data: topics, isLoading } = useOrderCoachingTopics(orderId)
  const addTopic = useAddOrderCoachingTopic(orderId)
  const setDone = useSetOrderCoachingTopicDone(orderId)
  const [content, setContent] = useState('')

  function handleAdd() {
    const trimmed = content.trim()
    if (!trimmed) return
    addTopic.mutate(trimmed, { onSuccess: () => setContent('') })
  }

  return (
    <Card padding="md" className="h-full overflow-y-auto">
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="h-4 w-4 text-brand" />
        <h3 className="text-base font-semibold text-ink">Tópicos do coaching</h3>
      </div>

      {addTopic.isError && (
        <ErrorAlert
          className="mb-3"
          message={addTopic.error instanceof Error ? addTopic.error.message : 'Erro ao adicionar tópico'}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !topics?.length ? (
        <p className="text-xs text-ink-muted py-4 text-center">
          Nenhum tópico registrado ainda. Adicione o primeiro abaixo.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {topics.map((topic) => (
            <label
              key={topic.id}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors',
                topic.is_done ? 'bg-brand/5 border-brand/15' : 'bg-bg-elevated/40 border-border-subtle',
              )}
            >
              <input
                type="checkbox"
                checked={topic.is_done}
                disabled={setDone.isPending}
                onChange={(e) => setDone.mutate({ topicId: topic.id, done: e.target.checked })}
                className="h-4 w-4 mt-0.5 shrink-0 accent-brand"
              />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', topic.is_done ? 'text-ink-muted line-through' : 'text-ink')}>
                  {topic.content}
                </p>
                {topic.is_done && topic.completed_at && (
                  <p className="flex items-center gap-1 text-[10px] text-ink-muted mt-0.5">
                    <CheckSquare className="h-3 w-3" /> Concluído em {formatDateTime(topic.completed_at)}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
          placeholder="ex: Revisar posicionamento em teamfight..."
          maxLength={200}
          className="input-base flex-1 text-sm"
        />
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          loading={addTopic.isPending}
          disabled={!content.trim()}
          onClick={handleAdd}
        >
          Adicionar
        </Button>
      </div>
    </Card>
  )
}
