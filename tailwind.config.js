/** @type {import('tailwindcss').Config} */

// rgb(var(--x) / <alpha-value>) 형태로 참조해야 bg-primary/10 같은 투명도 유틸이 살아납니다.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // 다크모드 UI는 만들지 않습니다. .dark 클래스가 어디에도 없으므로 효과는 0이고,
  // 나중에 도입할 때 config 변경 없이 시작할 수 있게 선언만 남겨 둡니다.
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
        },
        primary: {
          DEFAULT: token('--primary'),
          hover: token('--primary-hover'),
          subtle: token('--primary-subtle'),
          border: token('--primary-border'),
          foreground: token('--primary-foreground'),
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
    },
  },
  plugins: [],
};
