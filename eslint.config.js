import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      /*
       * 원시 글자 크기 금지(v3 T2).
       *
       * 왜 린트로 막나: 타이포 스케일(.t-*)을 index.css에 정의해 두고도 화면이 원시
       * text-xs~3xl을 474곳에서 쓰고 있었다. 같은 역할의 텍스트가 화면마다 다른 크기로
       * 나온 원인이고, 사람이 리뷰로 잡기에는 수가 많다.
       *
       * 도입 방식은 montage의 eslint-plugin-wds를 따른다 — 규칙을 적게 두고,
       * recommended(warn)로 켜서 기존 코드를 막지 않다가 정리된 뒤 error로 올린다.
       * 지금은 잔존이 0건이므로 error로 두어도 되지만, 외부 코드 조각을 붙여 넣는 중간
       * 상태를 막지 않기 위해 warn으로 둔다. CI에서 경고 0을 요구하면 그때 error로 바꾼다.
       *
       * 쓸 것: t-title / t-heading(-2) / t-headline(-2) / t-body(-2) / t-label(-2) / t-caption(-2)
       * 여러 줄 문단: t-body-reading / t-body-2-reading / t-label-reading
       * 줄 간격만 따로 주고 싶으면 leading-* 유틸을 t-* 뒤에 붙인다(유틸이 이긴다).
       */
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            'Literal[value=/(^|\\s)text-(xs|sm|base|lg|[2-9]?xl|\\[[0-9]+px\\])(\\s|$)/]',
          message:
            '원시 글자 크기 대신 타이포 스케일을 쓰세요 — t-caption(-2) / t-label(-2) / t-body(-2) / t-headline(-2) / t-heading(-2) / t-title. 여러 줄 문단은 -reading 짝을 씁니다(v3 T2).',
        },
        {
          selector:
            'TemplateElement[value.raw=/(^|\\s)text-(xs|sm|base|lg|[2-9]?xl|\\[[0-9]+px\\])(\\s|$)/]',
          message:
            '원시 글자 크기 대신 타이포 스케일을 쓰세요 — t-caption(-2) / t-label(-2) / t-body(-2) / t-headline(-2) / t-heading(-2) / t-title. 여러 줄 문단은 -reading 짝을 씁니다(v3 T2).',
        },
      ],
    },
  }
);
