import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && key ? createClient(url, key) : null;

/**
 * 비밀번호 재설정 메일의 착지 주소(§A F1).
 * Supabase가 이 주소 뒤에 #access_token=…&type=recovery 를 붙여 보낸다.
 * 앱은 해시가 아니라 경로(/reset-password)로 재설정 흐름을 판정한다 —
 * supabase-js가 해시를 먼저 지워도 경로는 남기 때문이다.
 * GitHub Pages의 404.html 폴백이 이 경로를 index.html로 되돌린다.
 */
export const RESET_PASSWORD_PATH = 'reset-password';

export const resetRedirectUrl = () =>
  `${window.location.origin}${import.meta.env.BASE_URL}${RESET_PASSWORD_PATH}`;

/** 지금 열린 주소가 재설정 착지 주소인가. */
export const isResetPasswordPath = () =>
  window.location.pathname.replace(/\/+$/, '').endsWith(`/${RESET_PASSWORD_PATH}`);
