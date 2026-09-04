import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, passwordPolicyError } from './passwordPolicy';

describe('passwordPolicyError', () => {
  it('빈 값은 입력을 요구한다', () => {
    expect(passwordPolicyError('')).toBe('비밀번호를 입력해 주세요.');
  });

  it('최소 길이 미만은 지금 길이를 함께 알려 준다', () => {
    const short = 'a1'.repeat(Math.floor((PASSWORD_MIN_LENGTH - 1) / 2));
    expect(passwordPolicyError(short)).toContain(`${PASSWORD_MIN_LENGTH}자 이상`);
  });

  it('영문만·숫자만은 거절한다', () => {
    expect(passwordPolicyError('abcdefghij')).toBe('비밀번호에는 영문과 숫자를 함께 넣어 주세요.');
    expect(passwordPolicyError('1234567890')).toBe('비밀번호에는 영문과 숫자를 함께 넣어 주세요.');
  });

  // 이 값이 통과하지 못하면 운영 관리자 계정이 화면에서 막힌다(APPLY_2026-09-04_admin_account.sql).
  it('admin0123(9자)을 통과시킨다', () => {
    expect(passwordPolicyError('admin0123')).toBeNull();
  });
});
