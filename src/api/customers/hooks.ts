import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import {
  getAdminCustomerDetail, getCustomerDashboardStats, listAdminCustomerOrders, listAdminCustomerReviews,
  listAdminCustomers,
} from './queries'

export function useCustomerDashboardStats(customerId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.customers.profile(customerId ?? '').concat(['dashboard-stats']),
    queryFn: () => getCustomerDashboardStats(customerId!),
    enabled: !!customerId,
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: `customer-dashboard-stats-${customerId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: customerId ? [queryKeys.customers.profile(customerId).concat(['dashboard-stats'])] : [],
    enabled: !!customerId,
  })
  return query
}

export function useAdminCustomers() {
  const query = useQuery({
    queryKey: queryKeys.customers.adminList(),
    queryFn: () => listAdminCustomers(),
    refetchInterval: 30_000,
  })
  useRealtimeInvalidate({
    channel: 'admin-customers',
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: [queryKeys.customers.adminList()],
  })
  return query
}

export function useAdminCustomerDetail(customerProfileId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.customers.adminDetail(customerProfileId ?? ''),
    queryFn: () => getAdminCustomerDetail(customerProfileId!),
    enabled: !!customerProfileId,
    refetchInterval: 20_000,
  })
  useRealtimeInvalidate({
    channel: `admin-customer-detail-${customerProfileId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: customerProfileId ? [queryKeys.customers.adminDetail(customerProfileId)] : [],
    enabled: !!customerProfileId,
  })
  return query
}

export function useAdminCustomerOrders(customerUserId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.customers.adminDetail(customerUserId ?? '').concat(['orders']),
    queryFn: () => listAdminCustomerOrders(customerUserId!),
    enabled: !!customerUserId,
    refetchInterval: 20_000,
  })
  useRealtimeInvalidate({
    channel: `admin-customer-orders-${customerUserId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    queryKeys: customerUserId ? [queryKeys.customers.adminDetail(customerUserId).concat(['orders'])] : [],
    enabled: !!customerUserId,
  })
  return query
}

export function useAdminCustomerReviews(customerUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customers.adminDetail(customerUserId ?? '').concat(['reviews']),
    queryFn: () => listAdminCustomerReviews(customerUserId!),
    enabled: !!customerUserId,
  })
}
