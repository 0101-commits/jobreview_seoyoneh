/*
 * 비밀번호 정책 한 곳 — 기획서 §3 F11.
 *
 * 이 숫자가 화면 네 곳(관리자 계정 생성 · SME 계정 관리 · 계정 조작 패널 · 비밀번호 변경)에
 * 따로 적혀 있다가 8과 10으로 갈라진 적이 있다. 관리자가 만들어 준 값을 본인이 바꾸려는 순간
 * 더 센 기준으로 거절당했다. 그래서 화면 쪽 판정은 이 파일 하나만 본다.
 *
 * 최종 판정자는 서버다(`supabase/functions/admin-create-user/index.ts` 의 `passwordPolicyError`).
 * Edge Function 은 Deno 런타임이라 이 모듈을 import 할 수 없으므로 같은 규칙을 그쪽에도 적어 둔다.
 * **숫자를 바꿀 때는 반드시 두 곳을 함께 바꾼다.**
 *
 * 2026-09-04: 10 → 8. 파일럿 운영 계정에 9자 비밀번호를 쓰기로 한 결정에 맞춘다.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** 입력 도움말·필드 설명에 쓰는 한 문장. 문구가 화면마다 달라지지 않게 여기서 만든다. */
export const PASSWORD_POLICY_HINT = `${PASSWORD_MIN_LENGTH}자 이상, 영문과 숫자를 포함해 주세요.`;

/** 정책 위반 사유를 한국어로 돌려준다. 통과하면 null. 서버 판정과 같은 순서로 본다. */
export function passwordPolicyError(password: string): string | null {
  if (!password) return '비밀번호를 입력해 주세요.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다. 지금 ${password.length}자입니다.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return '비밀번호에는 영문과 숫자를 함께 넣어 주세요.';
  }
  return null;
}
