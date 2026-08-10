import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type UIEvent } from 'react'
import { Lock, MessageCircle, Send, ShieldCheck, Unlock, X } from 'lucide-react'
import { Avatar, Button, Card, ErrorAlert, Skeleton } from '@/components/ui'
import { cn, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useOrderChat, useSendOrderMessage, useSetOrderChatLock } from '@/api/chat'
import type { OrderStatus, UserRole } from '@/types'

const ROLE_LABEL: Record<UserRole, string> = {
  customer: 'Cliente',
  booster: 'Booster',
  admin: 'Admin',
}

// Mesmo limite validado no banco (order_messages_content_length, migration
// 007) -- char_length(btrim(content)) entre 1 e 4000. maxLength no textarea
// já impede digitar/colar além disso; o valor só precisa existir aqui uma
// vez pra também alimentar o contador visual abaixo da caixa.
const MESSAGE_MAX_LENGTH = 4000

// Último recurso depois que overflow-wrap/min-w-0 (CSS) não bastaram nesse
// layout -- força quebra de linha real (\n) a cada 36 caracteres, mas só
// dentro de um trecho SEM espaço que já passou de 36 (link, token, spam de
// teste tipo "aaaaaaa..."). Texto normal com espaços continua quebrando
// pelo fluxo natural do CSS -- só o "mesmo que não haja espaço" do pedido
// vira quebra forçada aqui.
const HARD_WRAP_TOKEN_LENGTH = 36
function hardWrapLongTokens(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token.length <= HARD_WRAP_TOKEN_LENGTH) return token
      const chunks: string[] = []
      for (let i = 0; i < token.length; i += HARD_WRAP_TOKEN_LENGTH) {
        chunks.push(token.slice(i, i + HARD_WRAP_TOKEN_LENGTH))
      }
      return chunks.join('\n')
    })
    .join('')
}

// orderStatus é opcional só pra decidir a mensagem certa quando o chat está
// travado (pedido concluído trava sozinho -- ver trigger
// trg_lock_chat_on_order_completed, migration 085 -- e não deve soar como se
// um admin tivesse bloqueado manualmente).
export function OrderChat({ orderId, viewerRole, orderStatus, onClose }: { orderId: string; viewerRole: UserRole; orderStatus?: OrderStatus; onClose?: () => void }) {
  const { profile } = useAuthStore()
  const [message, setMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Guarda se o usuário estava perto do fim da lista ANTES da mensagem nova
  // chegar (atualizado só em eventos reais de scroll) -- sem isso, calcular
  // "está perto do fim?" depois que o DOM já cresceu com a mensagem nova
  // sempre dava uma distância maior que o threshold pra mensagens longas,
  // fazendo o auto-scroll nunca disparar mesmo com o usuário já no fim.
  const nearBottomRef = useRef(true)

  const chat = useOrderChat(orderId)
  const sendMessage = useSendOrderMessage(orderId)
  const setLocked = useSetOrderChatLock(orderId)

  useEffect(() => {
    if (nearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [chat.data?.messages.length])

  function handleListScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // Caixa cresce junto com o texto (até um teto) em vez de ficar fixa em 2
  // linhas -- sem isso, Shift+Enter já quebra a linha (handleKeyDown abaixo),
  // mas a quebra some rolando pra fora da caixa em vez de aparecer.
  const TEXTAREA_MAX_HEIGHT_PX = 160

  function autoGrowTextarea(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }

  function handleMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setMessage(event.target.value)
    autoGrowTextarea(event.target)
  }

  function submitMessage() {
    const content = message.trim()
    if (!content || sendMessage.isPending || !chat.data?.can_send) return
    sendMessage.mutate(content, {
      onSuccess: () => {
        setMessage('')
        if (textareaRef.current) textareaRef.current.style.height = ''
        // Quem envia espera ver a própria mensagem, independente de onde
        // estava rolado antes.
        nearBottomRef.current = true
      },
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitMessage()
    }
  }

  if (chat.isLoading) {
    return (
      <Card padding="md" className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-48 w-full" />
      </Card>
    )
  }

  if (chat.isError || !chat.data) {
    return (
      <Card padding="md">
        <ErrorAlert message={chat.error instanceof Error ? chat.error.message : 'Não foi possível carregar o chat.'} />
      </Card>
    )
  }

  const { chat_available: available, chat_locked: locked, messages, can_send: canSend } = chat.data

  return (
    <Card padding="none" className="overflow-hidden h-full flex flex-col">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
        <MessageCircle className="h-4 w-4 text-brand" />
        <div>
          <h3 className="text-sm font-semibold text-ink">Chat do pedido</h3>
          {available && (
            <p className="text-[11px] text-ink-muted">{messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}</p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {viewerRole === 'admin' && available && (
            <Button
              size="sm"
              variant={locked ? 'secondary' : 'danger-ghost'}
              loading={setLocked.isPending}
              onClick={() => setLocked.mutate(!locked)}
              leftIcon={locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            >
              {locked ? 'Desbloquear chat' : 'Bloquear chat'}
            </Button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar chat"
              className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-bg-elevated transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!available ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-elevated">
            <Lock className="h-5 w-5 text-ink-muted" />
          </div>
          <p className="text-sm font-semibold text-ink">Chat ainda indisponível</p>
          <p className="mt-1 max-w-sm text-xs text-ink-muted">
            Cliente e booster poderão conversar quando um booster for atribuído a este pedido.
          </p>
        </div>
      ) : (
        <>
          {locked && (
            <div className="flex items-start gap-2 border-b border-warning/20 bg-warning/10 px-4 py-3 text-xs text-warning shrink-0">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {orderStatus === 'completed'
                  ? 'Pedido concluído — o chat fica salvo aqui só para consulta.'
                  : 'Chat bloqueado pela administração. Somente administradores podem enviar mensagens.'}
              </span>
            </div>
          )}

          <div
            className="flex-1 min-h-0 min-w-0 space-y-4 overflow-x-hidden overflow-y-auto px-4 py-5"
            aria-live="polite"
            onScroll={handleListScroll}
          >
            {messages.length === 0 ? (
              <p className="py-12 text-center text-xs text-ink-muted">Nenhuma mensagem enviada.</p>
            ) : (
              messages.map((item) => {
                const isMe = item.sender_id === profile?.id
                const isAdmin = item.sender_role === 'admin'
                return (
                  <div key={item.id} className={cn('flex items-start gap-2.5', isMe && 'flex-row-reverse')}>
                    <Avatar src={item.sender_avatar_url} name={item.sender_name} size="sm" />
                    {/* min-w-0 é o que de fato permite a bolha encolher abaixo da
                        largura "natural" do conteúdo -- sem isso, um item flex
                        nunca fica menor que seu min-content, então uma palavra
                        longa sem espaço (link, token) empurrava a área toda pra
                        rolagem horizontal em vez de quebrar linha, mesmo com
                        break-words no filho. max-w em % (não mais em `ch` fixo)
                        agora que o painel é bem mais largo -- ~78% do painel,
                        nunca a largura toda, mas acompanha o tamanho real do
                        painel em vez de travar num valor pensado pra sidebar
                        estreita. */}
                    <div className={cn('flex min-w-0 max-w-[78%] flex-col', isMe ? 'items-end' : 'items-start')}>
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 px-1 text-[10px] text-ink-muted">
                        <span className="font-semibold text-ink-secondary">{item.sender_name}</span>
                        <span>{ROLE_LABEL[item.sender_role]}</span>
                      </div>
                      <div
                        className={cn(
                          'min-w-0 whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                          isMe && !isAdmin && 'rounded-tr-sm bg-brand text-white',
                          !isMe && !isAdmin && 'rounded-tl-sm bg-bg-elevated text-ink',
                          isAdmin && 'border border-accent/30 bg-accent/10 text-ink',
                        )}
                      >
                        {hardWrapLongTokens(item.content)}
                      </div>
                      <time className="mt-1 px-1 text-[10px] text-ink-muted" dateTime={item.created_at}>
                        {formatDateTime(item.created_at)}
                      </time>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {canSend ? (
            <div className="border-t border-border-subtle p-3 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={handleMessageChange}
                  onKeyDown={handleKeyDown}
                  maxLength={MESSAGE_MAX_LENGTH}
                  rows={1}
                  placeholder={viewerRole === 'admin' && locked ? 'Mensagem administrativa...' : 'Escreva uma mensagem...'}
                  aria-label="Escrever mensagem"
                  style={{ maxHeight: TEXTAREA_MAX_HEIGHT_PX }}
                  className="input-base min-h-11 min-w-0 flex-1 resize-none overflow-y-auto py-2.5 text-sm"
                  disabled={sendMessage.isPending}
                />
                <Button
                  size="icon-lg"
                  onClick={submitMessage}
                  loading={sendMessage.isPending}
                  disabled={!message.trim()}
                  title="Enviar mensagem"
                  aria-label="Enviar mensagem"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {/* Só aparece perto do teto -- o limite (mesmo char_length(btrim(content))
                  entre 1 e 4000 validado no banco, ver order_messages_content_length)
                  já é aplicado silenciosamente pelo maxLength nativo; isso é só o
                  aviso visual de que ele existe, sem poluir a caixa o tempo todo. */}
              {message.length > MESSAGE_MAX_LENGTH * 0.9 && (
                <p className={cn(
                  'mt-1 text-right text-[10px]',
                  message.length >= MESSAGE_MAX_LENGTH ? 'text-danger font-semibold' : 'text-ink-muted',
                )}>
                  {message.length}/{MESSAGE_MAX_LENGTH}
                </p>
              )}
            </div>
          ) : locked ? null : (
            <div className="border-t border-border-subtle px-4 py-3 text-center text-xs text-ink-muted">
              Você não pode enviar mensagens neste chat.
            </div>
          )}
        </>
      )}

      {sendMessage.isError && (
        <div className="border-t border-border-subtle p-3">
          <ErrorAlert message={sendMessage.error instanceof Error ? sendMessage.error.message : 'Erro ao enviar mensagem.'} />
        </div>
      )}
      {setLocked.isError && (
        <div className="border-t border-border-subtle p-3">
          <ErrorAlert message={setLocked.error instanceof Error ? setLocked.error.message : 'Erro ao controlar o chat.'} />
        </div>
      )}
    </Card>
  )
}
