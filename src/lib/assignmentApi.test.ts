/*
 * assignmentGuardOf 계약 테스트 (기획안 dcab2660 §7 D6).
 *
 * 배정 해제의 안전장치다. 이 판정이 느슨해지면 제출된 응답이 산출물(E1·E2)에서 조용히 빠지고,
 * 조여지면 잘못 배정한 SME를 뺄 방법이 없어진다. 서버에도 같은 규칙의 트리거가 있다
 * (review_assignments_guard_deactivate) — 두 곳의 판정이 갈리지 않게 규칙을 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { assignmentGuardOf } from './assignmentApi';

describe('assignmentGuardOf', () => {
  it('제출된 응답이 있으면 해제를 막는다', () => {
    const guard = assignmentGuardOf({
      status: 'SUBMITTED',
      submittedAt: '2026-09-01T10:00:00Z',
      lastSavedAt: '2026-09-01T09:50:00Z',
    });
    expect(guard.blocked).toBeTruthy();
    expect(guard.warning).toBeNull();
  });

  it('제출 시각이 있으면 상태가 무엇이든 막는다(반려로 되돌아온 검토도)', () => {
    // 매트릭스의 셀 상태는 REJECTED로 표시된다(CellStatus). 제출 흔적이 있으면 그것이 기준이다.
    const guard = assignmentGuardOf({
      status: 'REJECTED',
      submittedAt: '2026-08-30T10:00:00Z',
      lastSavedAt: null,
    });
    expect(guard.blocked).toBeTruthy();
  });

  it('작성을 시작했으면 막지 않고 경고만 낸다', () => {
    const started = assignmentGuardOf({ status: 'IN_PROGRESS', submittedAt: null, lastSavedAt: null });
    expect(started.blocked).toBeNull();
    expect(started.warning).toBeTruthy();

    // 상태가 아직 NOT_STARTED여도 저장 흔적이 있으면 시작한 것으로 본다.
    const savedOnly = assignmentGuardOf({
      status: 'NOT_STARTED',
      submittedAt: null,
      lastSavedAt: '2026-09-01T09:00:00Z',
    });
    expect(savedOnly.blocked).toBeNull();
    expect(savedOnly.warning).toBeTruthy();
  });

  it('아무것도 시작하지 않았으면 확인 없이 해제한다', () => {
    const guard = assignmentGuardOf({ status: 'NOT_STARTED', submittedAt: null, lastSavedAt: null });
    expect(guard).toEqual({ blocked: null, warning: null });
  });
});
