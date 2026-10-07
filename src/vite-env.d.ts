/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Chave pública do Mercado Pago (Card Payment Brick). Não é segredo.
  readonly VITE_MP_PUBLIC_KEY?: string
}
