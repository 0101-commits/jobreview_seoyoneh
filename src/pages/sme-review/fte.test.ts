/*
 * buildFteTargets 계약 테스트 (기획안 dcab2660 §5-4 DoD ⑤).
 *
 * 이 함수가 STEP 2 상태와 STEP 3 배분을 잇는 유일한 규칙이다. 이름이 아니라 client_key로
 * 맞추게 바꾼 것이 v2 F5의 핵심이라, 그 성질을 여섯 가지로 못박는다.
 *   ① 유지 과업은 그대로 대상
 *   ② 삭제 제안한 과업은 대상에서 빠지고 excluded로 나온다(되살리기 안내가 이름을 쓴다)
 *   ③ 이름이 빈 신규 제안은 대상에서 빠진다(저장되지 않는 항목이라서)
 *   ④ 같은 이름의 신규 제안 두 줄이 각각 대상이 된다(옛 구현은 한 줄로 합쳤다)
 *   ⑤ 제안 이름을 고쳐도 키가 그대로라 배분이 유지된다
 *   ⑥ STEP 2의 판정·수정 제안명이 행 머리 표시용으로 함께 실린다
 *
 * 실행: npm test (vitest, jsdom 없이 순수 함수만 본다)
 */
import { describe, expect, it } from 'vitest';
import { buildFteTargets } from './fte';
import type { SuggestionInput } from '@/lib/reviewApi';
import type { Feedback } from '@/types';
import type { JobDetail } from '@/lib/jobApi';

type Tasks = JobDetail['tasks'];

const task = (id: string, name: string, activities: { id: string; activity_name: string }[] = []) => ({
  id,
  name,
  description: `${name} 설명`,
  sort_order: 0,
  task_activities: activities.map((a, i) => ({ ...a, sort_order: i })),
});

const tasks: Tasks = [task('t1', '연간 사업계획 수립'), task('t2', '실적 분석·경영 보고', [
  { id: 'a1', activity_name: '월간 실적 집계' },
])] as Tasks;

const suggestion = (client_key: string, name: string): SuggestionInput => ({
  client_key,
  name,
  description: '',
  reason: '',
});

const feedbackOf = (entries: Record<string, Partial<Feedback>>): Record<string, Feedback> => {
  const out: Record<string, Feedback> = {};
  for (const [key, value] of Object.entries(entries)) {
    out[key] = { suitability: '', comment: '', suggestion: '', ...value };
  }
  return out;
};

describe('buildFteTargets', () => {
  it('① 유지 과업은 task-{id} 키로 대상이 된다', () => {
    const { targets, excluded } = buildFteTargets(tasks, {}, []);
    expect(targets.map((t) => t.key)).toEqual(['task-t1', 'task-t2']);
    expect(excluded).toEqual([]);
    expect(targets[1].activities).toEqual([{ id: 'a1', name: '월간 실적 집계' }]);
  });

  it('② 삭제 제안한 과업은 대상에서 빠지고 excluded에 이름과 함께 남는다', () => {
    const { targets, excluded } = buildFteTargets(tasks, feedbackOf({ 'task-t1': { remove: true } }), []);
    expect(targets.map((t) => t.key)).toEqual(['task-t2']);
    expect(excluded).toEqual([{ taskId: 't1', name: '연간 사업계획 수립' }]);
  });

  it('③ 이름이 빈 신규 제안은 대상에서 빠진다', () => {
    const { targets } = buildFteTargets(tasks, {}, [suggestion('k1', '   '), suggestion('k2', '신규 수주 대응')]);
    expect(targets.map((t) => t.key)).toEqual(['task-t1', 'task-t2', 'sug-k2']);
  });

  it('④ 같은 이름의 신규 제안 두 줄이 각각 대상이 된다', () => {
    const { targets } = buildFteTargets(tasks, {}, [suggestion('k1', '견적 검토'), suggestion('k2', '견적 검토')]);
    expect(targets.filter((t) => t.isNew).map((t) => t.key)).toEqual(['sug-k1', 'sug-k2']);
  });

  it('⑤ 제안 이름을 고쳐도 키가 유지된다(배분이 따라온다)', () => {
    const before = buildFteTargets(tasks, {}, [suggestion('k1', '견적 검토')]);
    const after = buildFteTargets(tasks, {}, [suggestion('k1', '견적 검토·승인')]);
    const last = (list: { key: string; name: string }[]) => list[list.length - 1];
    expect(last(before.targets).key).toBe('sug-k1');
    expect(last(after.targets).key).toBe(last(before.targets).key);
    expect(last(after.targets).name).toBe('견적 검토·승인');
  });

  it('⑥ STEP 2의 판정·수정 제안명이 대상에 함께 실린다', () => {
    const { targets } = buildFteTargets(
      tasks,
      feedbackOf({ 'task-t2': { suitability: '일부 수정 필요', suggestion: ' 월간 실적 분석·보고 ' } }),
      [],
    );
    const row = targets.find((t) => t.key === 'task-t2');
    expect(row?.suitability).toBe('일부 수정 필요');
    expect(row?.suggestedName).toBe('월간 실적 분석·보고');
  });
});
