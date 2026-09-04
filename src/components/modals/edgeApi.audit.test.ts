/*
 * 감사 로그에 비밀번호가 실리지 않는다 — 기획서 docs/PLAN_2026-09-04_IMPROVEMENT.md §2-4.
 *
 * planAccountAudit 은 요청 body 와 응답 data 를 함께 받는다. 편의로 `meta: body` 를 넣는 순간
 * 비밀번호 평문이 audit_logs 로 들어가고, E5 Export 가 meta 를 통째로 덤프하므로 그대로 파일이 된다.
 * 그 사고를 코드 리뷰가 아니라 테스트가 막게 한다.
 */
import { describe, expect, it } from 'vitest';
import { planAccountAudit } from './edgeApi';

const SECRET = 'Sup3rSecretPw!';

describe('planAccountAudit — 비밀번호가 meta 로 새지 않는다', () => {
  it('관리자 지정 비밀번호는 meta 어디에도 없다', () => {
    const plan = planAccountAudit(
      { mode: 'set-password', profileId: 'p1', password: SECRET, forceChange: true },
      { success: true, tempPassword: null, mustChangePassword: true },
    );
    expect(plan?.action).toBe('PASSWORD_RESET_BY_ADMIN');
    expect(JSON.stringify(plan?.meta)).not.toContain(SECRET);
  });

  it('서버가 만든 임시 비밀번호도 meta 에 없다', () => {
    const plan = planAccountAudit(
      { mode: 'set-password', profileId: 'p1' },
      { success: true, tempPassword: SECRET, mustChangePassword: true },
    );
    expect(JSON.stringify(plan?.meta)).not.toContain(SECRET);
    // 값 대신 "무엇이 발급됐는지"만 남는다.
    expect(plan?.meta).toMatchObject({ issued: 'temp' });
  });

  it('열람은 PASSWORD_VIEWED 한 줄로 남고 값은 남지 않는다', () => {
    const plan = planAccountAudit(
      { mode: 'reveal-password', profileId: 'p1', reauthPassword: SECRET },
      { success: true, found: true, password: SECRET, setAt: '2026-09-04T00:00:00Z' },
    );
    expect(plan?.action).toBe('PASSWORD_VIEWED');
    expect(plan?.entityId).toBe('p1');
    expect(JSON.stringify(plan?.meta)).not.toContain(SECRET);
  });

  it('값이 나오지 않은 열람 시도는 기록하지 않는다', () => {
    const plan = planAccountAudit(
      { mode: 'reveal-password', profileId: 'p1', reauthPassword: SECRET },
      { success: true, found: false, reason: '보관된 값이 없어요.' },
    );
    expect(plan).toBeNull();
  });

  it('로그인 ID 변경은 새 ID 를 meta 에 남기지 않는다', () => {
    const plan = planAccountAudit(
      { mode: 'set-login-id', profileId: 'p1', email: 'someone@example.com' },
      { success: true },
    );
    expect(plan?.action).toBe('LOGIN_ID_CHANGED');
    expect(JSON.stringify(plan?.meta)).not.toContain('someone@example.com');
  });
});
