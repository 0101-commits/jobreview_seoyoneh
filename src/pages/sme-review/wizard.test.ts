/*
 * evaluateStep 계약 테스트 (기획안 dcab2660 §7 D6).
 *
 * 이 함수가 "다음 단계로 갈 수 있는가"를 판정한다. 게이트가 느슨해지면 미완성 응답이 제출로 가고,
 * 반대로 조여지면 사용자가 화면에서 할 수 있는 일이 없는데 막히는 막다른 길이 생긴다.
 * 그래서 통과/차단 양쪽을 단계마다 못박는다.
 *
 * reasons의 문장까지 비교하지는 않는다(copy.ts가 문언의 원천이다). 건수와 통과 여부만 본다.
 */
import { describe, expect, it } from 'vitest';
import { evaluateStep } from './wizard';
import type { GateInput } from './wizard';
import type { Feedback, Suitability } from '@/types';

const rated = (suitability: Suitability, extra: Partial<Feedback> = {}): Feedback => ({
  suitability,
  comment: '',
  suggestion: '',
  ...extra,
});

const base: GateInput = {
  tasks: [{ id: 't1' }, { id: 't2' }],
  skills: [{ id: 's1' }],
  feedback: {},
  newTasks: [],
  fteTotal: 0,
  fteTargetCount: 0,
};

const withFeedback = (entries: Record<string, Feedback>): GateInput => ({
  ...base,
  feedback: entries,
});

describe('evaluateStep — STEP 1 직무 개요', () => {
  it('직무명·직무정의 둘 다 평가해야 통과한다', () => {
    expect(evaluateStep(1, base).ok).toBe(false);
    expect(evaluateStep(1, withFeedback({ name: rated('적합') })).ok).toBe(false);
    expect(evaluateStep(1, withFeedback({ name: rated('적합'), definition: rated('적합') })).ok).toBe(true);
  });

  it("'적합'이 아니면 의견이나 수정안이 있어야 통과한다", () => {
    const noNote = withFeedback({ name: rated('부적합'), definition: rated('적합') });
    expect(evaluateStep(1, noNote).ok).toBe(false);

    const withComment = withFeedback({
      name: rated('부적합', { comment: '직무명이 실제 업무와 다릅니다' }),
      definition: rated('적합'),
    });
    expect(evaluateStep(1, withComment).ok).toBe(true);

    const withSuggestion = withFeedback({
      name: rated('일부 수정 필요', { suggestion: '영업기획' }),
      definition: rated('적합'),
    });
    expect(evaluateStep(1, withSuggestion).ok).toBe(true);
  });
});

describe('evaluateStep — STEP 2 과업', () => {
  it('미평가 과업이 남아 있으면 막는다', () => {
    expect(evaluateStep(2, base).ok).toBe(false);
    expect(evaluateStep(2, withFeedback({ 'task-t1': rated('적합') })).ok).toBe(false);
    expect(
      evaluateStep(2, withFeedback({ 'task-t1': rated('적합'), 'task-t2': rated('적합') })).ok,
    ).toBe(true);
  });

  it('이름이 빈 신규 제안이 있으면 막는다(저장되지 않는 항목이라서)', () => {
    const allRated = { 'task-t1': rated('적합'), 'task-t2': rated('적합') };
    const gate = evaluateStep(2, {
      ...withFeedback(allRated),
      newTasks: [{ client_key: 'k1', name: '  ', description: '', reason: '' }],
    });
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toHaveLength(1);
  });
});

describe('evaluateStep — STEP 3 투입 비중', () => {
  it('합계가 100%가 아니면 막는다', () => {
    expect(evaluateStep(3, { ...base, fteTargetCount: 2, fteTotal: 95 }).ok).toBe(false);
    expect(evaluateStep(3, { ...base, fteTargetCount: 2, fteTotal: 100 }).ok).toBe(true);
  });

  it('배분할 과업이 없으면 게이트를 걸지 않는다(막다른 길 방지)', () => {
    expect(evaluateStep(3, { ...base, fteTargetCount: 0, fteTotal: 0 }).ok).toBe(true);
  });

  it('부동소수 오차로 100%가 깨지지 않는다', () => {
    // 0.1 + 0.2 = 0.30000000000000004 같은 합계가 화면에서 만들어질 수 있다.
    expect(evaluateStep(3, { ...base, fteTargetCount: 3, fteTotal: 99.999999 }).ok).toBe(true);
    expect(evaluateStep(3, { ...base, fteTargetCount: 3, fteTotal: 99.99 }).ok).toBe(false);
  });
});

describe('evaluateStep — STEP 4 Skill·수행요건', () => {
  it('Skill과 수행요건 3종을 모두 평가해야 통과한다', () => {
    expect(evaluateStep(4, base).ok).toBe(false);
    const all = withFeedback({
      'skill-s1': rated('적합'),
      'req-education': rated('적합'),
      'req-major': rated('적합'),
      'req-certifications': rated('적합'),
    });
    expect(evaluateStep(4, all).ok).toBe(true);
  });
});

describe('evaluateStep — STEP 5', () => {
  it('자체 게이트가 없다(서버 submit_review가 최종 판정을 한다)', () => {
    expect(evaluateStep(5, base).ok).toBe(true);
  });
});
