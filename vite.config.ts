import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/*
 * index.html의 CSP 자리표시(%VITE_SUPABASE_ORIGIN% · %VITE_SUPABASE_HOST%)를 실제 값으로 바꾼다.
 * CSP를 코드에 하드코딩하지 않는 이유: Supabase 프로젝트가 바뀌면(스테이징·이관) connect-src가
 * 조용히 어긋나 로그인부터 막힌다. 값이 없으면 자리표시를 지운다 — 그때 CSP는 'self'만 남으므로
 * 개발 서버에서 곧바로 눈에 띈다(§8 S5).
 */
function cspEnv(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const url = env.VITE_SUPABASE_URL || '';
  let origin = '';
  let host = '';
  try {
    if (url) {
      const parsed = new URL(url);
      origin = parsed.origin;
      host = parsed.host;
    }
  } catch {
    // 잘못된 URL이면 비워 둔다. 빌드를 막지 않는다 — 배포 변수 오타가 빌드 실패로 번지지 않게.
  }
  return {
    name: 'csp-env',
    transformIndexHtml(html) {
      return html.replaceAll('%VITE_SUPABASE_ORIGIN%', origin).replaceAll('%VITE_SUPABASE_HOST%', host);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from /<repo>/, dev server from /.
  base: process.env.GITHUB_PAGES === 'true' ? '/jobreview_seoyoneh/' : '/',
  plugins: [react(), cspEnv(mode)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
}));
