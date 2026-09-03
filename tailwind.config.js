/** @type {import('tailwindcss').Config} */

// rgb(var(--x) / <alpha-value>) 형태로 참조해야 bg-primary/10 같은 투명도 유틸이 살아납니다.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // 다크 값은 index.css의 .dark 블록에 쌍으로 정의되어 있습니다(v2 D8).
  // 토글 UI는 아직 없으므로 실제 효과는 .dark 클래스를 붙이는 순간부터입니다.
  darkMode: 'class',

  future: {
    /*
      v3 T1 — hover 유틸을 @media (hover: hover) and (pointer: fine)로 감싼다.
      Tailwind 기본값은 미디어 조건 없이 :hover를 붙이므로, 터치 기기에서 한 번 탭한 요소가
      hover 상태로 남아 계속 눌린 것처럼 보인다. montage는 @media not (pointer: fine)에서
      hover 오버레이를 0으로 되돌리는데, Tailwind에서는 이 플래그 한 줄이 같은 일을 한다.
      SME가 폰으로 접속하는 앱이라 실제로 눈에 보이는 차이가 있다.
    */
    hoverOnlyWhenSupported: true,
  },

  theme: {
    /*
      ── 간격 스케일에 대한 판정(v3 T1) ──────────────────────────────────────────
      montage의 spacing 허용 목록은 20단이다:
        0, 0.5, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80 (px)
      24 다음이 32, 32 다음이 40이라 28·36px 자리가 비어 있다 — Tailwind로 옮기면
      -7(28px)·-9(36px) 계열 금지다. 그 17곳은 v3 T1에서 허용 값으로 옮겼다.

      theme.spacing을 이 20단으로 덮어쓰지는 않았다. 이유:
       · spacing은 width·height·inset·translate까지 함께 먹는 스케일이라, 20단으로 좁히면
         w-24(96px)·w-64(256px)·h-20(80px)처럼 레이아웃에 실제로 필요한 값이 통째로 사라진다.
         montage는 모바일 부품 시스템이라 80px에서 끊기지만 이 앱에는 사이드바(256px)가 있다.
       · 터치 타깃 44px(min-h-11 53곳)은 WCAG 2.5.8 때문에 지켜야 하는 값인데 목록에 없다.
      그래서 스케일은 Tailwind 기본을 유지하고, 금지 값만 없애고 목록을 문서로 고정한다.
      새 코드에서 -7 / -9 계열을 쓰지 않는다 — 검사: grep -roE '\b[a-z]+-(7|9)\b' src
    */
    extend: {
      colors: {
        background: token('--background'),
        card: token('--card'),
        // 떠 있는 면 — 모달·드롭다운·토스트. 라이트에서는 card와 같고 다크에서 한 단 밝다.
        elevated: token('--elevated'),
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
        /*
          차트 6색 + 글자용 짝(v3 T1). 면에는 chart-N, 글자(범례·배지)에는 chart-N-fg를 쓴다.
          상태색(success/warning/destructive)을 데이터 구분에 쓰지 않는다.
        */
        chart: {
          1: token('--chart-1'),
          2: token('--chart-2'),
          3: token('--chart-3'),
          4: token('--chart-4'),
          5: token('--chart-5'),
          6: token('--chart-6'),
          '1-fg': token('--chart-1-fg'),
          '2-fg': token('--chart-2-fg'),
          '3-fg': token('--chart-3-fg'),
          '4-fg': token('--chart-4-fg'),
          '5-fg': token('--chart-5-fg'),
          '6-fg': token('--chart-6-fg'),
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
      /*
        겹침 층 5단(v3 T1). 화면에서 z-10~z-50을 직접 쓰지 않고 이름으로 쓴다 —
        z-popover / z-sticky / z-drawer / z-modal / z-toast.
        부품 내부의 지역 겹침(표 sticky 헤더·고정 열)은 이 층을 쓰지 않고 z-[1]을 쓴다.
      */
      zIndex: {
        popover: 'var(--z-popover)',
        sticky: 'var(--z-sticky)',
        drawer: 'var(--z-drawer)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
      /*
        모션 3단(v3 T1). 맨 `transition` 유틸의 기본값이 이미 150ms(fast)와 같으므로
        상태 피드백은 추가 클래스가 필요 없고, duration-base / duration-slow만 새로 붙인다.
      */
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
      },
      transitionTimingFunction: {
        overlay: 'var(--ease-overlay)',
        toggle: 'var(--ease-toggle)',
        expand: 'var(--ease-expand)',
      },
    },
  },
  plugins: [],
};
