import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/$/, '')

  // Build de producao sem estas envs publica um site quebrado em silencio (suporte some, pagamento falha): avisa alto.
  if (mode === 'production') {
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_MP_PUBLIC_KEY', 'VITE_DISCORD_TICKET_URL']) {
      if (!env[name]) console.warn(`\n[build] AVISO: ${name} nao definida - recurso correspondente fica indisponivel.\n`)
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      // Permite acessar o dev server via túnel ngrok (Vite bloqueia hosts
      // desconhecidos por padrão desde a 4.x, ver "Blocked request").
      allowedHosts: ['unlimited-disband-backlight.ngrok-free.dev'],
      ...(supabaseUrl
        ? {
            proxy: {
              '/functions/v1': {
                target: supabaseUrl,
                changeOrigin: true,
                secure: true,
              },
            },
          }
        : {}),
    },
    optimizeDeps: {
      include: [
        'react', 'react-dom', 'react-router-dom',
        '@tanstack/react-query', 'zustand',
        '@supabase/supabase-js', 'lucide-react',
      ],
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react'
            if (id.includes('@tanstack/react-query')) return 'vendor-query'
            if (id.includes('@supabase/')) return 'vendor-supabase'
            return undefined
          },
        },
      },
    },
  }
})
