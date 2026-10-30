import type { Config } from 'tailwindcss'

const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        surface: c('surface'),
        raised: c('raised'),
        line: c('line'),
        'line-strong': c('line-strong'),
        fg: c('fg'),
        muted: c('muted'),
        faint: c('faint'),
        accent: c('accent'),
        'accent-fg': c('accent-fg'),
        ok: c('ok'),
        warn: c('warn'),
        err: c('err'),
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '10px' },
    },
  },
  plugins: [],
} satisfies Config
