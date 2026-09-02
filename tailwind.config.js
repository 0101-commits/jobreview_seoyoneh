/** @type {import('tailwindcss').Config} */

// rgb(var(--x) / <alpha-value>) 형태로 참조해야 bg-primary/10 같은 투명도 유틸이 살아납니다.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // 다크 값은 index.css의 .dark 블록에 쌍으로 정의되어 있습니다(v2 D8).
  // 토글 UI는 아직 없으므로 실제 효과는 .dark 클래스를 붙이는 순간부터입니다.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: token('--background'),
        card: token('--card'),
        muted: token('--muted'),
        border: token('--border'),
        foreground: {
          DEFAULT: token('--foreground'),
          muted: token('--foreground-muted'),
          subtle: token('--foreground-subtle'),
          disabled: token('--foreground-disabled'),
        },
        primary: {
          DEFAULT: token('--primary'),
          hover: token('--primary-hover'),
          heavy: token('--primary-heavy'),
          subtle: token('--primary-subtle'),
          border: token('--primary-border'),
          foreground: token('--primary-foreground'),
        },
        // v2 — fill(칩·표 헤더·hover) · 반전 표면 · 배경막 · 차트 팔레트
        fill: {
          strong: token('--fill-strong'),
          alt: token('--fill-alt'),
        },
        interaction: {
          disabled: token('--interaction-disabled'),
        },
        dimmer: token('--dimmer'),
        brand: token('--brand'),
        inverse: {
          DEFAULT: token('--inverse-bg'),
          label: token('--inverse-label'),
          'label-muted': token('--inverse-label-muted'),
          accent: token('--inverse-accent'),
        },
        chart: {
          1: token('--chart-1'),
          2: token('--chart-2'),
          3: token('--chart-3'),
          4: token('--chart-4'),
        },
        success: {
          DEFAULT: token('--success'),
          muted: token('--success-muted'),
          border: token('--success-border'),
          foreground: token('--success-foreground'),
        },
        warning: {
          DEFAULT: token('--warning'),
          muted: token('--warning-muted'),
          border: token('--warning-border'),
          foreground: token('--warning-foreground'),
        },
        destructive: {
          DEFAULT: token('--destructive'),
          muted: token('--destructive-muted'),
          border: token('--destructive-border'),
          foreground: token('--destructive-foreground'),
        },
      },
      borderRadius: {
        inner: 'var(--radius-inner)',
        element: 'var(--radius-element)',
        container: 'var(--radius-container)',
        page: 'var(--radius-page)',
      },
      spacing: {
        'control-sm': 'var(--control-sm)',
        'control-md': 'var(--control-md)',
        'control-lg': 'var(--control-lg)',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
      },
    },
  },
  plugins: [],
};
