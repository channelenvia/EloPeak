import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base — driven by CSS variables, responds to theme toggle
        bg: {
          base:     'rgb(var(--color-bg-base) / <alpha-value>)',
          surface:  'rgb(var(--color-bg-surface) / <alpha-value>)',
          card:     'rgb(var(--color-bg-card) / <alpha-value>)',
          elevated: 'rgb(var(--color-bg-elevated) / <alpha-value>)',
          overlay:  'rgb(var(--color-bg-overlay) / <alpha-value>)',
        },
        // Brand — verde
        brand: {
          DEFAULT: '#22C55E',
          hover:   '#16A34A',
          muted:   'rgb(var(--color-brand-muted) / <alpha-value>)',
          subtle:  'rgb(var(--color-brand-subtle) / <alpha-value>)',
        },
        // Accent (gold)
        accent: {
          DEFAULT: '#F5B800',
          hover:   '#D9A300',
          muted:   'rgb(var(--color-accent-muted) / <alpha-value>)',
        },
        // Text — driven by CSS variables
        ink: {
          DEFAULT:   'rgb(var(--color-ink) / <alpha-value>)',
          secondary: 'rgb(var(--color-ink-secondary) / <alpha-value>)',
          muted:     'rgb(var(--color-ink-muted) / <alpha-value>)',
          inverse:   'rgb(var(--color-ink-inverse) / <alpha-value>)',
        },
        // Status
        success: { DEFAULT: '#10B981', muted: 'rgb(var(--color-success-muted) / <alpha-value>)' },
        warning: { DEFAULT: '#F59E0B', muted: 'rgb(var(--color-warning-muted) / <alpha-value>)' },
        danger:  { DEFAULT: '#EF4444', muted: 'rgb(var(--color-danger-muted)  / <alpha-value>)' },
        info:    { DEFAULT: '#3B82F6', muted: '#0A1830' },
        // Rank colors
        rank: {
          iron:        '#6B7280',
          bronze:      '#B45309',
          silver:      '#9CA3AF',
          gold:        '#F59E0B',
          platinum:    '#6EE7B7',
          emerald:     '#10B981',
          diamond:     '#60A5FA',
          master:      '#A855F7',
          grandmaster: '#EF4444',
          challenger:  '#FCD34D',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        xl:  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card:         'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        brand:        'var(--shadow-brand)',
        accent:       'var(--shadow-accent)',
        glow:         'var(--shadow-glow)',
      },
      backgroundImage: {
        'gradient-brand':  'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
        'gradient-accent': 'linear-gradient(135deg, #F5B800 0%, #F97316 100%)',
        'gradient-dark':   'linear-gradient(180deg, #0F1211 0%, #0B0D0C 100%)',
        'gradient-card':   'linear-gradient(135deg, #151A18 0%, #1C2421 100%)',
        'hero-glow':       'radial-gradient(ellipse 90% 70% at 50% -10%, rgba(34,197,94,0.18), transparent)',
        'section-glow':    'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(34,197,94,0.08), transparent)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-in-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in':   'scaleIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        shimmer:      'shimmer 2s linear infinite',
        'float':      'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { transform: 'translateY(10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { from: { transform: 'translateY(-10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        scaleIn:   { from: { transform: 'scale(0.95)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        shimmer:   { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        float:     { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
    },
  },
  plugins: [],
} satisfies Config
