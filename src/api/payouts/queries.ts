import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { BoosterPayoutTotals, PayoutOrderBreakdownRow, PayoutRequestRow } from './types'

export async function fetchBoosterPayoutTotals(boosterId: string): Promise<BoosterPayoutTotals> {
  const { data, error } = await supabase.rpc('booster_payout_totals', { p_booster_id: boosterId })
  if (error) throw normalizeApiError(error)
  const result = data as (BoosterPayoutTotals & { success: boolean; error?: string }) | null
  if (!result?.success) throw normalizeApiError(new Error(result?.error ?? 'failed_to_load_totals'))
  return {
    available_balance: result.available_balance,
    total_earned: result.total_earned,
    reserved: result.reserved,
    total_paid: result.total_paid,
  }
}

export async function fetchBoosterPayoutRequests(boosterId: string): Promise<PayoutRequestRow[]> {
  const { data, error } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('booster_id', boosterId)
    .order('created_at', { ascending: false })
  if (error) throw normalizeApiError(error)
  return data ?? []
}

export async function fetchAdminPayoutRequests(status?: PayoutRequestRow['status']): Promise<PayoutRequestRow[]> {
  let query = supabase.from('payout_requests').select('*').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw normalizeApiError(error)
  return data ?? []
}

export async function fetchPayoutRequestBreakdown(requestId: string): Promise<PayoutOrderBreakdownRow[]> {
  const { data, error } = await supabase.rpc('payout_request_order_breakdown', { p_request_id: requestId })
  if (error) throw normalizeApiError(error)
  return (data ?? []) as PayoutOrderBreakdownRow[]
}
