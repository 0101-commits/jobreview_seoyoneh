/*
 * ── 메일 주소 없는 계정의 로그인 ID(2026-09-03 결정) ────────────────
 * Supabase Auth 는 email 없이는 계정을 만들 수 없다. 그래서 "이메일 없이 만든다"는 실제로는
 * 받지 않는 주소를 하나 지어 주는 것이다. 지어 준 주소가 그대로 로그인 ID가 된다.
 *
 * 이 파일이 index.ts 에서 갈라져 나온 이유는 하나다 — 여기 규칙이 틀리면 계정이 잘못된 ID 로
 * 만들어지고, 만든 뒤에는 되돌리기가 계정 삭제뿐이다. Deno 런타임 없이 돌려 볼 수 있어야
 * 규칙을 시험할 수 있다(loginEmail.test.ts).
 */

/**
 * 입력값을 로그인용 이메일로 바꾼다.
 *  - '@' 가 있으면 진짜 이메일로 보고 그대로 쓴다(기존 동작).
 *  - '@' 없이 값만 있으면 로그인 ID 로 보고 도메인을 붙인다(예: sme01 → sme01@seoyoneh.local).
 *  - 비었으면 fallback(SME 는 사번)으로 만든다.
 * 어느 쪽으로도 만들 수 없으면 null 을 돌려준다 — 호출부가 사유를 정해 응답한다.
 */
export function resolveLoginEmail(raw: unknown, fallback: unknown, domain: string): string | null {
  const pick = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const entered = pick(raw);
  if (entered.includes("@")) return entered.toLowerCase();
  // 이메일 로컬파트에 그대로 쓸 수 없는 글자(한글·공백 등)는 '-' 로 바꾼다.
  const local = (entered || pick(fallback))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return local ? `${local}@${domain}` : null;
}
