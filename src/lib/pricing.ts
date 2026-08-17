// Reexporta shared/pricing.ts — a lógica de preço vive lá porque também é
// usada pela Edge Function create-pix-payment (fonte autoritativa do preço
// cobrado). Este arquivo existe só para manter o import `@/lib/pricing` já
// usado em todo o order-builder.
export * from '../../shared/pricing'
