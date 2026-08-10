import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import { queryKeys } from '@/api/core/queryKeys'
import { listBoosterNames } from '@/api/boosters'

export interface PublicReview {
  id: string
  rating: number
  content: string
  created_at: string
  booster_id: string
  booster_display_name: string
}

// Avaliações reais e públicas (reviews.is_public = true) com o nome do
// booster anexado -- usado nas seções de "depoimentos" que antes mostravam
// TESTIMONIALS fabricados (src/features/public/data/testimonials.ts).
export async function listPublicReviews(limit = 24): Promise<PublicReview[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, content, created_at, booster_id')
    .eq('is_public', true)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)

  const rows = (data ?? []).filter(
    (r): r is typeof r & { content: string; booster_id: string } => !!r.content && !!r.booster_id,
  )
  const boosterIds = [...new Set(rows.map((r) => r.booster_id))]
  const names = await listBoosterNames(boosterIds)

  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    created_at: r.created_at,
    booster_id: r.booster_id,
    booster_display_name: names.get(r.booster_id)?.display_name ?? 'Booster EloPeak',
  }))
}

export function usePublicReviews(limit = 24) {
  return useQuery({
    queryKey: queryKeys.reviews.public(limit),
    queryFn: () => listPublicReviews(limit),
    staleTime: 60_000,
  })
}

export interface BoosterReview {
  id: string
  rating: number
  content: string | null
  created_at: string
  customer_nickname: string
  service_type: string | null
}

// Nickname do cliente e serviço contratado vêm de get_public_booster_reviews
// (migration 172, SECURITY DEFINER) -- profiles e orders não são legíveis
// direto pelo client anônimo, então precisa de uma função que já cruza
// reviews (is_public = true) com orders.service_type e profiles.username.
export async function listBoosterReviews(boosterUserId: string): Promise<BoosterReview[]> {
  const { data, error } = await supabase.rpc('get_public_booster_reviews', { p_booster_id: boosterUserId })
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterReview[]
}

export function useBoosterReviews(boosterUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.forBooster(boosterUserId ?? ''),
    queryFn: () => listBoosterReviews(boosterUserId!),
    enabled: !!boosterUserId,
  })
}

export interface OwnReview {
  id: string
  rating: number
  content: string | null
  created_at: string
}

// Uma review por pedido (orders.id é unique em reviews) -- usado pra decidir
// entre mostrar o formulário ou a avaliação já enviada em OrderReviewSection.
export async function getOwnReview(orderId: string): Promise<OwnReview | null> {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, content, created_at')
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data
}

export function useOwnReview(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.own(orderId ?? ''),
    queryFn: () => getOwnReview(orderId!),
    enabled: !!orderId,
  })
}

export interface CreateReviewInput {
  orderId: string
  boosterId: string | null
  rating: number
  content: string
}

// RLS (reviews_customer_insert, migration archive 137) exige customer_id =
// auth.uid(), pedido do próprio cliente com status 'completed', e booster_id
// batendo com orders.assigned_booster_id do mesmo pedido -- nunca confiar só
// na validação client-side.
export async function createReview({ orderId, boosterId, rating, content }: CreateReviewInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Não autenticado.')
  const { error } = await supabase.from('reviews').insert({
    order_id: orderId,
    customer_id: auth.user.id,
    booster_id: boosterId,
    rating,
    content: content.trim() || null,
  })
  if (error) throw normalizeApiError(error, 'Não foi possível enviar sua avaliação.')
}

export function useCreateReview(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<CreateReviewInput, 'orderId'>) => createReview({ orderId, ...input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviews.own(orderId) }),
  })
}
