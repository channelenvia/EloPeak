import { useEffect, useRef } from 'react'

// Ref sempre apontando para o valor mais recente, atualizado em efeito (nunca
// durante o render). Declare ANTES dos efeitos que o leem: efeitos do mesmo
// componente rodam na ordem de declaração.
export function useLatestRef<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
