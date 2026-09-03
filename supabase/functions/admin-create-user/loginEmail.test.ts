/*
 * 로그인 ID 규칙 계약 테스트(2026-09-03 결정 — 메일 주소 없이 파일럿 계정 만들기).
 *
 * 이 규칙이 틀리면 계정이 잘못된 ID로 만들어지고, 만든 뒤에는 되돌리기가 계정 삭제뿐이다.
 * 특히 "이메일을 비웠는데 사번도 없다"를 null로 돌려주는 것이 중요하다 —
 * 그때 '@seoyoneh.local' 같은 로컬파트 없는 주소가 만들어지면 그 계정은 아무도 로그인할 수 없다.
 */
import { describe, expect, it } from 'vitest';
import { resolveLoginEmail } from './loginEmail';

const D = 'seoyoneh.local';

describe('resolveLoginEmail', () => {
  it('진짜 이메일은 소문자로만 바꿔 그대로 쓴다', () => {
    expect(resolveLoginEmail('Kim@Company.COM', '2024001', D)).toBe('kim@company.com');
  });

  it("'@' 없이 넣은 값은 로그인 ID로 보고 도메인을 붙인다", () => {
    expect(resolveLoginEmail('hcg-admin', null, D)).toBe(`hcg-admin@${D}`);
  });

  it('이메일이 비면 사번으로 만든다', () => {
    expect(resolveLoginEmail('', '2024001', D)).toBe(`2024001@${D}`);
    expect(resolveLoginEmail('   ', ' 2024001 ', D)).toBe(`2024001@${D}`);
  });

  it('엑셀이 사번을 숫자로 주는 경우도 받는다', () => {
    expect(resolveLoginEmail(undefined, 2024001, D)).toBe(`2024001@${D}`);
  });

  it('한글·공백은 로컬파트에 쓸 수 없으므로 -로 바꾸고 양끝은 다듬는다', () => {
    expect(resolveLoginEmail('', '생기 001', D)).toBe(`001@${D}`);
    expect(resolveLoginEmail('', '김서연', D)).toBeNull();
  });

  it('이메일도 사번도 없으면 null — 로컬파트 없는 주소를 만들지 않는다', () => {
    expect(resolveLoginEmail('', '', D)).toBeNull();
    expect(resolveLoginEmail(null, undefined, D)).toBeNull();
  });
});
