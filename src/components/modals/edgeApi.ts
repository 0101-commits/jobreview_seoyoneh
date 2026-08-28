// admin-create-user Edge Function 호출을 한 곳으로 모은 모듈.
// URL 조립 + 헤더 3종 + 오류 파싱이 계정 관리 화면 5곳에 복붙돼 있던 것을 여기로 합쳤다.
// 실패하면 항상 "원인 + 다음 행동"이 담긴 한국어 Error를 throw 한다(영어 원문은 노출하지 않는다).
import { supabase } from '@/lib/supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;

/** 세션 토큰을 한 번만 얻어 온다. 반복 호출(일괄 업로드·일괄 삭제)에서는 루프 밖에서 부를 것. */
export async function getAccessToken(): Promise<string> {
  if (!supabase) throw new Error('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.');
  return token;
}

function toKoreanMessage(raw: unknown, status: number): string {
  const msg = typeof raw === 'string' ? raw.trim() : '';
  // Edge Function이 이미 한국어로 내려준 사유는 그대로 쓴다.
  if (/[가-힣]/.test(msg)) return msg;

  const lower = msg.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already been registered') || lower.includes('duplicate'))
    return '이미 등록된 이메일이에요. 다른 이메일을 쓰거나 기존 계정을 수정해 주세요.';
  if (lower.includes('password')) return '비밀번호 조건을 만족하지 않아요. 8자 이상, 영문과 숫자를 포함해 주세요.';
  if (lower.includes('email')) return '이메일 형식이 올바르지 않아요. 주소를 다시 확인해 주세요.';
  if (status === 401 || status === 403) return '권한이 없거나 로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.';
  if (status === 404) return '서버 기능을 찾을 수 없어요. 관리자에게 배포 상태 확인을 요청해 주세요.';
  return `요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요. (오류 코드 ${status})`;
}

/**
 * Edge Function 한 번 호출. token을 넘기지 않으면 내부에서 세션을 조회한다.
 * 실패는 예외로 던지므로 호출부는 try/catch로 받아 화면에 사유를 남겨야 한다.
 */
export async function callAdminFn<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const authToken = token ?? (await getAccessToken());

  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('서버에 연결하지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) throw new Error(toKoreanMessage(data.error, res.status));
  return data as T;
}

/** catch로 받은 값에서 사람이 읽을 메시지만 꺼낸다. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
