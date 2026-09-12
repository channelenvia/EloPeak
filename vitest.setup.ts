// Nota: `npm run deadcode` (knip) aponta esse arquivo como dependente de um
// pacote adaptador de ambiente jsdom não listado -- falso positivo
// conhecido: esse pacote separado era convenção do Vitest 1-3; o Vitest 4
// (instalado aqui) já embute suporte a jsdom nativamente (ver
// node_modules/vitest/jsdom.d.ts) e o pacote em questão nem existe mais no
// registro npm (confirmado: 404 ao tentar instalar). Sem efeito real -- os
// testes de componente (*.test.tsx, via pragma de ambiente no topo do
// arquivo) rodam e passam normalmente.

// Matchers extras (toBeInTheDocument, toBeDisabled, etc.) e limpeza
// automática do DOM entre testes de componente (*.test.tsx, ambiente jsdom
// -- cada arquivo declara isso via `// @vitest-environment jsdom` no topo).
// Sem o afterEach(cleanup) explícito aqui, o React Testing Library não
// desmonta a árvore renderizada de um `it()` antes do próximo -- cada teste
// que faz `render()` empilha DOM em cima do anterior no mesmo arquivo,
// fazendo queries como getByText baterem em múltiplos elementos. Import
// incondicional é inofensivo pros testes de lógica pura em 'node': cleanup()
// só itera um Set de containers montados, que fica vazio se nada renderizou.
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(cleanup)

// Testes rodam com `environment: 'node'` (ver vitest.config.ts) -- Node não
// tem localStorage/sessionStorage reais como um browser. A versão
// experimental do Node exige um --localstorage-file pra localStorage
// funcionar (sem ela, .setItem lança), e depender disso deixaria os testes
// reféns de uma flag experimental do runtime. Polyfill simples em memória,
// suficiente para o que o middleware `persist` do Zustand precisa
// (getItem/setItem/removeItem) em orderBuilderStore.ts.
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), writable: true, configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), writable: true, configurable: true })
