import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Testes de lógica pura (shared/*.test.ts, *.test.ts) rodam em 'node' --
    // mais rápido, sem DOM. Testes de componente (*.test.tsx) precisam de
    // DOM (React Testing Library) -- cada um declara isso individualmente
    // via `// @vitest-environment jsdom` no topo do arquivo.
    environment: 'node',
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
