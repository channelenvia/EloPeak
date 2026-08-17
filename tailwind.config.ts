import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

// Design system: "High-Elo Operations Center". Tema único, escuro — sem
// alternância claro/escuro (ver src/styles/globals.css). Verde como cor de
// marca (CTA, progresso ao vivo), dourado como acento secundário (metas,
// conquista, destaque de valor). Base em preto acinzentado (neutro, sem tom
// azulado) em vez de preto puro. Cores de rank reaproveitam a paleta
// semântica onde a cor real da Riot já coincide (Esmeralda↔brand, Diamante↔
// info, Grão-Mestre↔danger).
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:        'rgb(var(--color-bg-base) / <alpha-value>)',
          surface:     'rgb(var(--color-bg-surface) / <alpha-value>)',
          raised:      'rgb(var(--color-bg-raised) / <alpha-value>)',
          interactive: 'rgb(var(--color-bg-interactive) / <alpha-value>)',
          // Novo degrau intermediário (conteúdo aninhado dentro de um card já
          // elevado, ex.: métrica compacta dentro de um card grande). Chave
          // própria ("inset"), NÃO reaproveita "elevated" — esse nome já é
          // sinônimo consolidado de bg-raised em ~200 usos existentes.
          inset:       'rgb(var(--color-bg-elevated) / <alpha-value>)',
          // Scrim de modal/overlay — sempre com alpha, nunca cor sólida.
          scrim:       'rgb(var(--color-bg-scrim) / <alpha-value>)',
          // Sinônimos (nomes originais, mantidos pra não forçar rename em
          // ~60 páginas ainda não reconstruídas — ver Estágios 5-8).
          card:        'rgb(var(--color-bg-surface) / <alpha-value>)',
          elevated:    'rgb(var(--color-bg-raised) / <alpha-value>)',
        },
        border: {
          subtle: 'rgb(var(--color-border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT:   'rgb(var(--color-ink) / <alpha-value>)',
          secondary: 'rgb(var(--color-ink-secondary) / <alpha-value>)',
          muted:     'rgb(var(--color-ink-muted) / <alpha-value>)',
          inverse:   'rgb(var(--color-ink-inverse) / <alpha-value>)',
        },
        // Marca — verde (CTA principal, progresso ao vivo, sucesso temático).
        // Fonte única de verdade em --color-brand (globals.css); mesmo valor
        // hex de antes (#22C55E/#16A34A), só que centralizado.
        brand: {
          DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)',
          hover:   'rgb(var(--color-brand-hover) / <alpha-value>)',
          muted:   'rgb(var(--color-brand-muted) / <alpha-value>)',
          subtle:  'rgb(var(--color-brand-subtle) / <alpha-value>)',
        },
        // Acento — dourado (meta, conquista, destaque de valor/preço)
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover:   'rgb(var(--color-accent-hover) / <alpha-value>)',
          muted:   'rgb(var(--color-accent-muted) / <alpha-value>)',
        },
        success: { DEFAULT: 'rgb(var(--color-success) / <alpha-value>)', muted: 'rgb(var(--color-success-muted) / <alpha-value>)' },
        warning: { DEFAULT: 'rgb(var(--color-warning) / <alpha-value>)', muted: 'rgb(var(--color-warning-muted) / <alpha-value>)' },
        danger:  { DEFAULT: 'rgb(var(--color-danger) / <alpha-value>)', muted: 'rgb(var(--color-danger-muted) / <alpha-value>)' },
        info:    { DEFAULT: 'rgb(var(--color-info) / <alpha-value>)', muted: 'rgb(var(--color-info-muted) / <alpha-value>)' },
        rank: {
          iron:        '#5C6570',
          bronze:      '#B2703C',
          silver:      '#9FB0C2',
          gold:        '#E8B84B',
          platinum:    '#4FD1C5',
          emerald:     '#3DDC84',
          diamond:     '#5B9DFF',
          master:      '#B389F0',
          grandmaster: '#EF4444',
          challenger:  '#F5E6B8',
        },
      },
      fontFamily: {
        // Auto-hospedadas via @fontsource-variable (ver globals.css) em vez do
        // link CDN do Google Fonts — mesmas famílias/eixos de peso de antes,
        // sem o round-trip de rede bloqueante antes do primeiro texto pintar.
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'monospace'],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card:         'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        brand:        'var(--shadow-brand)',
        accent:       'var(--shadow-accent)',
      },
      transitionDuration: {
        instant: 'var(--motion-instant)',
        fast:    'var(--motion-fast)',
        base:    'var(--motion-base)',
        panel:   'var(--motion-panel)',
        slow:    'var(--motion-slow)',
      },
      transitionTimingFunction: {
        out:    'var(--motion-ease-out)',
        inout:  'var(--motion-ease-in-out)',
      },
      backgroundImage: {
        'gradient-brand':  'linear-gradient(135deg, rgb(var(--color-brand-light)) 0%, rgb(var(--color-brand)) 55%, rgb(var(--color-brand-hover)) 100%)',
        'gradient-accent': 'linear-gradient(135deg, #FFCB33 0%, #F5B800 55%, #D9A300 100%)',
        'gradient-rail':   'linear-gradient(90deg, #5C6570 0%, #9FB0C2 22%, #3DDC84 44%, #5B9DFF 62%, #B389F0 78%, #F5E6B8 100%)',
        'gradient-dark':   'linear-gradient(180deg, #17181B 0%, #0E0F11 100%)',
        'gradient-card':   'linear-gradient(135deg, #1B1D21 0%, #232529 100%)',
        'hero-glow':       'radial-gradient(ellipse 90% 70% at 50% -10%, rgba(34,197,94,0.14), transparent)',
        'section-glow':    'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(34,197,94,0.06), transparent)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in':   'scaleIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        shimmer:      'shimmer 2s linear infinite',
        marquee:      'marquee 42s linear infinite',
        'rail-fill':  'railFill 1.1s cubic-bezier(0.16,1,0.3,1) forwards',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { transform: 'translateY(10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { from: { transform: 'translateY(-10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        scaleIn:   { from: { transform: 'scale(0.95)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        shimmer:   { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        marquee:   { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        railFill:  { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config
