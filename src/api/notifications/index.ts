import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import type { Notification } from '@/types'

export type { Notification }

export async function listNotifications(userId: string, limit = 20): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as Notification[]
}

// Contagem separada da lista renderizada -- a lista é limitada (dropdown do
// sino), então derivar o badge dela subestima usuários com mais notificações
// não lidas do que o limite (e "marcar todas" via essa lista deixava
// notificações antigas presas como não lidas pra sempre, já que nunca
// apareciam na página). head:true evita baixar linhas só pra contar.
export async function getUnreadNotificationsCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)
  if (error) throw normalizeApiError(error)
  return count ?? 0
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', ids)
  if (error) throw normalizeApiError(error)
}

// Marca TODAS as não lidas do usuário, não só as que estão carregadas na
// lista limitada do dropdown (ver getUnreadNotificationsCount acima).
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
  if (error) throw normalizeApiError(error)
}

export function useNotifications(userId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.notifications.list(userId ?? ''),
    queryFn: () => listNotifications(userId!),
    enabled: !!userId,
    refetchInterval: 30_000,
  })

  useRealtimeInvalidate({
    channel: `notifications-${userId ?? 'none'}`,
    table: 'notifications',
    event: 'INSERT',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    queryKeys: userId ? [queryKeys.notifications.list(userId)] : [],
    enabled: !!userId,
  })

  return query
}

// Badge do sino: contagem independente da lista (que é limitada), então
// nunca fica presa em "9+" nem some quando existem não lidas fora do
// intervalo carregado. Escuta INSERT (nova notificação) e UPDATE (lida em
// outra aba/dispositivo) pra manter o número em dia via Realtime.
export function useUnreadNotificationsCount(userId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.notifications.unreadCount(userId ?? ''),
    queryFn: () => getUnreadNotificationsCount(userId!),
    enabled: !!userId,
    refetchInterval: 30_000,
  })

  useRealtimeInvalidate({
    channel: `notifications-unread-count-${userId ?? 'none'}`,
    table: 'notifications',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    queryKeys: userId ? [queryKeys.notifications.unreadCount(userId)] : [],
    enabled: !!userId,
  })

  return query
}

function useInvalidateNotifications(userId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId ?? '') })
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount(userId ?? '') })
  }
}

export function useMarkNotificationsRead(userId: string | undefined) {
  const invalidate = useInvalidateNotifications(userId)
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: invalidate,
  })
}

export function useMarkAllNotificationsRead(userId: string | undefined) {
  const invalidate = useInvalidateNotifications(userId)
  return useMutation({
    mutationFn: () => markAllNotificationsRead(userId!),
    onSuccess: invalidate,
  })
}
