import type { OrderChatMessage, UserRole } from '@/types'

export type { OrderChatMessage }

export interface OrderChatState {
  success: boolean
  code?: string
  message?: string
  chat_available: boolean
  chat_locked: boolean
  chat_locked_at: string | null
  can_send: boolean
  messages: OrderChatMessage[]
}

export interface OrderChatMentionTarget {
  id: string
  name: string
  role: UserRole
  avatar_url: string | null
}
