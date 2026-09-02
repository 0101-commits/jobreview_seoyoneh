/*
 * computeJobSignals 계약 테스트 (기획안 dcab2660 §7 D6).
 *
 * 이 함수 하나가 워크숍 대상 판정(§6-3 ⓑ)의 전부다 — 이견 신호 배지 수, 자동 규칙 ①②③,
 * 비교 뷰의 하이라이트 행이 모두 여기서 나온다. 판정이 틀리면 워크숍에 올릴 직무가 바뀐다.
 *
 * 특히 "값이 없는 것"을 0으로 세지 않는 규칙을 못박는다. 그 실수는 오류 없이 조용히
 * 모든 행을 하이라이트해 제출 큐 순서를 뒤집는다.
 */
import { describe, expect, it } from 'vitest';
import { computeJobSignals, suggestionKey, type JobSignalInput } from './adminApi';
import { WORKSHOP_THRESHOLDS } from './workshopThresholds';

const GAP = WORKSHOP_THRESHOLDS.ftePointGap;

const emptyInput = (reviewIds: string[]): JobSignalInput => ({
  reviewIds,
  suitability: [],
  fte: [],
  newTasks: [],
});

describe('computeJobSignals — 적합성 판정 불일치', () => {
  it('같은 항목에 판정이 갈리면 신호 1건', () => {
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      suitability: [
        { key: 'task:t1', name: '연간 계획', reviewId: 'r1', value: 'SUITABLE' },
        { key: 'task:t1', name: '연간 계획', reviewId: 'r2', value: 'UNSUITABLE' },
      ],
    };
    const result = computeJobSignals(input);
    expect(result.signals.filter((s) => s.kind === 'SUITABILITY')).toHaveLength(1);
  });

  it('판정이 같으면 신호가 없다', () => {
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      suitability: [
        { key: 'task:t1', name: '연간 계획', reviewId: 'r1', value: 'SUITABLE' },
        { key: 'task:t1', name: '연간 계획', reviewId: 'r2', value: 'SUITABLE' },
      ],
    };
    expect(computeJobSignals(input).signals).toHaveLength(0);
  });

  it('부적합 비율이 임계값을 넘으면 자동 규칙 ①이 걸린다', () => {
    const input: JobSignalInput = {
      ...emptyInput(['r1']),
      suitability: [
        { key: 'task:t1', name: 'a', reviewId: 'r1', value: 'UNSUITABLE' },
        { key: 'task:t2', name: 'b', reviewId: 'r1', value: 'SUITABLE' },
      ],
    };
    const result = computeJobSignals(input);
    expect(result.unsuitableRatio).toBe(0.5);
    expect(result.workshopReasons.length).toBeGreaterThan(0);
  });
});

describe('computeJobSignals — FTE 행', () => {
  it(`비중 차가 ${GAP}%p 이상이면 하이라이트 + 신호`, () => {
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      fte: [
        { key: 'task:t1', name: '연간 계획', targetType: 'EXISTING', reviewId: 'r1', pct: 10 },
        { key: 'task:t1', name: '연간 계획', targetType: 'EXISTING', reviewId: 'r2', pct: 10 + GAP },
      ],
    };
    const result = computeJobSignals(input);
    const row = result.fteRows.find((r) => r.key === 'task:t1');
    expect(row?.maxGap).toBe(GAP);
    expect(row?.gapFlagged).toBe(true);
    expect(result.signals.some((s) => s.kind === 'FTE_GAP')).toBe(true);
  });

  it('FTE를 한 줄도 내지 않은 검토는 0%가 아니라 null로 남는다', () => {
    // r2는 FTE를 아예 답하지 않았다. 0으로 채우면 상대가 배분한 모든 행이 거짓으로 하이라이트된다.
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      fte: [{ key: 'task:t1', name: '연간 계획', targetType: 'EXISTING', reviewId: 'r1', pct: 60 }],
    };
    const result = computeJobSignals(input);
    const row = result.fteRows.find((r) => r.key === 'task:t1');
    expect(row?.pct.r2).toBeNull();
    expect(row?.gapFlagged).toBe(false);
  });

  it('확정 과업에 배분이 없는 것은 0%로 센다(FTE를 답한 검토 안에서)', () => {
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      fte: [
        { key: 'task:t1', name: 'a', targetType: 'EXISTING', reviewId: 'r1', pct: 100 },
        { key: 'task:t2', name: 'b', targetType: 'EXISTING', reviewId: 'r2', pct: 100 },
      ],
    };
    const result = computeJobSignals(input);
    // r2는 t1에 배분하지 않았다 = "그 과업에 시간을 쓰지 않는다"는 응답이다.
    expect(result.fteRows.find((r) => r.key === 'task:t1')?.pct.r2).toBe(0);
  });

  it('신규 제안을 한쪽만 냈으면 미제안(null) + 제안 불일치 신호', () => {
    const key = suggestionKey('신규 수주 대응');
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      fte: [
        { key: 'task:t1', name: 'a', targetType: 'EXISTING', reviewId: 'r1', pct: 50 },
        { key: 'task:t1', name: 'a', targetType: 'EXISTING', reviewId: 'r2', pct: 50 },
        { key, name: '신규 수주 대응', targetType: 'SUGGESTED', reviewId: 'r1', pct: 50 },
      ],
      newTasks: [{ reviewId: 'r1', name: '신규 수주 대응' }],
    };
    const result = computeJobSignals(input);
    const row = result.fteRows.find((r) => r.key === key);
    expect(row?.pct.r2).toBeNull();
    expect(row?.proposalMismatch).toBe(true);
    expect(result.newTaskCount).toBe(1);
  });

  it('1위 과업이 다르면 topTaskMismatch', () => {
    const input: JobSignalInput = {
      ...emptyInput(['r1', 'r2']),
      fte: [
        { key: 'task:t1', name: 'a', targetType: 'EXISTING', reviewId: 'r1', pct: 70 },
        { key: 'task:t2', name: 'b', targetType: 'EXISTING', reviewId: 'r1', pct: 30 },
        { key: 'task:t1', name: 'a', targetType: 'EXISTING', reviewId: 'r2', pct: 30 },
        { key: 'task:t2', name: 'b', targetType: 'EXISTING', reviewId: 'r2', pct: 70 },
      ],
    };
    const result = computeJobSignals(input);
    expect(result.topTaskByReview.r1).toBe('task:t1');
    expect(result.topTaskByReview.r2).toBe('task:t2');
    expect(result.topTaskMismatch).toBe(true);
  });

  it('배분이 없는 검토의 1위 과업은 null이다', () => {
    const result = computeJobSignals(emptyInput(['r1']));
    expect(result.topTaskByReview.r1).toBeNull();
    expect(result.topTaskMismatch).toBe(false);
  });
});

describe('suggestionKey', () => {
  it('공백·대소문자 차이를 무시해 같은 제안으로 맞춘다', () => {
    expect(suggestionKey('  신규  수주 대응 ')).toBe(suggestionKey('신규 수주 대응'));
    expect(suggestionKey('RFQ 대응')).toBe(suggestionKey('rfq 대응'));
  });
});
