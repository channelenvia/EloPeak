import type { Database } from '@/lib/database.types'

export type PayoutRequestRow = Database['public']['Tables']['payout_requests']['Row']
export type PayoutRequestStatus = Database['public']['Enums']['payout_request_status']

export interface BoosterPayoutTotals {
  available_balance: number
  total_earned: number
  reserved: number
  total_paid: number
}

export interface PayoutOrderBreakdownRow {
  order_id: string
  service_type: string
  gross_amount: number
  commission_rate: number
  booster_commission: number
  amount_included: number
}
