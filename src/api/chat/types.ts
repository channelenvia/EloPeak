import type { OrderChatMessage } from '@/types'

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
