// admin-create-user Edge Function 호출을 한 곳으로 모은 모듈.
// URL 조립 + 헤더 3종 + 오류 파싱이 계정 관리 화면 5곳에 복붙돼 있던 것을 여기로 합쳤다.
// 실패하면 항상 "원인 + 다음 행동"이 담긴 한국어 Error를 throw 한다(영어 원문은 노출하지 않는다).
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/auditApi';

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

/*
 * ── 계정 생성·삭제 감사 기록(§8 S5) ────────────────────────────────
 * §8 S5는 "제출·승인/반려·계정 생성/삭제·업로드·Export·메일 발송"을 audit_logs 기록 대상으로 못박는다.
 * 이 중 계정 생성/삭제만 기록이 빠져 있었다 — Edge Function(admin-create-user)이 계정을 만들지만
 * 그쪽에서는 로그를 남길 수 없기 때문이다. log_audit RPC는 actor_id를 auth.uid()로 강제하고
 * 비로그인 호출을 42501로 거절하는데(APPLY_2026-09-01_phase0.sql:231-238), Edge Function은
 * service_role로 붙으므로 auth.uid()가 없다. Phase 4의 mailApi.ts가 같은 이유로 발송 기록을
 * 클라이언트에서 남기고 있다(src/lib/mailApi.ts:279) — 여기서도 같은 방식을 따른다.
 *
 * actor_id가 실제 행위자를 가리키는가 — 가리킨다. 아래 로그는 Edge Function 호출이 성공한 뒤에만
 * 남는데, 그 성공은 Edge Function이 방금 보낸 것과 같은 JWT로 auth.getUser → profiles.role='admin'
 * 검증을 통과했다는 뜻이다(supabase/functions/admin-create-user/index.ts:40-55).
 * 즉 auth.uid()(= log_audit이 박는 actor_id) = Edge Function이 검증한 호출자 = 실제 행위자다.
 * 사칭 경로도 없다: actor_id는 인자로 받지 않으므로 남의 이름으로 남길 수 없다.
 *
 * meta에는 개인정보를 넣지 않는다(§8 S6) — 이름·이메일·사번은 담지 않고 대상 id와 역할만 남긴다.
 * 대상 id(entity_id)만 있으면 profiles·review_history와 조인해 추적할 수 있다.
 *
 * 일괄 업로드·일괄 삭제는 계정 한 건마다 한 줄씩 쌓인다(호출당 RPC 1회 추가).
 * 100명 업로드면 audit_logs 100행 + RPC 100회다. 계정별 추적이 감사 목적에 맞으므로 이대로 두되,
 * 일괄 처리 체감 속도가 문제가 되면 서버 측 일괄 기록 RPC로 옮기는 편이 낫다.
 */
type AuditPlan = { action: string; entityId: string | null; meta: Record<string, unknown> };

function planAccountAudit(
  body: Record<string, unknown>,
  data: Record<string, unknown>,
): AuditPlan | null {
  const mode = typeof body.mode === 'string' ? body.mode : '';
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  switch (mode) {
    // mode 없음 = 관리자 계정 생성(Edge Function의 기본 분기).
    case '':
      return { action: 'ADMIN_CREATED', entityId: str(data.userId), meta: { role: 'admin' } };
    case 'create-sme': {
      const sme = (body.sme as Record<string, unknown>) || {};
      return {
        action: 'SME_CREATED',
        entityId: str(data.userId),
        meta: { role: 'sme', company_id: str(sme.company_id) },
      };
    }
    case 'delete':
      return { action: 'ACCOUNT_DELETED', entityId: str(body.profileId), meta: {} };
    // 비활성화는 삭제와 같은 결과(로그인 차단)를 내므로 함께 남긴다. 행위 이름으로 둘을 가른다.
    case 'toggle-active':
      return {
        action: body.active === false ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_ACTIVATED',
        entityId: str(body.profileId),
        meta: {},
      };
    // 조회(check-auth)와 이름·소속 수정(update·update-sme)은 S5의 기록 대상이 아니다.
    // 대상을 넓히면 감사 로그가 조회 기록에 묻힌다.
    // (recreate-auth 모드는 v2 F3으로 제거했다 — profile.id ≠ auth.uid 계정을 만들었다.)
    default:
      return null;
  }
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

  // 성공한 계정 조작만 남긴다. logAudit은 실패해도 던지지 않으므로(auditApi.ts 주석)
  // 감사 기록이 실패해도 이미 끝난 계정 생성·삭제가 오류로 뒤집히지 않는다.
  const plan = planAccountAudit(body, data);
  if (plan) await logAudit(plan.action, 'profiles', plan.entityId, plan.meta);

  return data as T;
}

/** catch로 받은 값에서 사람이 읽을 메시지만 꺼낸다. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
