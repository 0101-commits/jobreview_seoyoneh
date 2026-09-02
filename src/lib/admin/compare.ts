import {
  ApiResult,
  NO_DB,
  Row,
  SmeReviewFeedback,
  fail,
  fetchAllPages,
  fetchJobReviewFeedback,
  fetchPagesByIds,
  num,
  ok,
  str,
  supabase,
} from './shared';
import {
  JobSignalInput,
  JobSignalResult,
  computeJobSignals,
  isComparableReview,
  suggestionKey,
} from './signals';

// ────────────────────────────────────────────────────────────────────
// 5. 비교 뷰 (§6-3 ⓑ · 그림 6-B)
// ────────────────────────────────────────────────────────────────────

export interface JobComparison extends JobSignalResult {
  jobId: string;
  /**
   * SME별 검토 전체(적합성·의견·수정 제안·신규 제안). reviewApi.fetchJobReviewFeedback 결과 그대로다.
   * 신호는 제출된 검토끼리만 계산하지만, 여기에는 작성 중인 응답도 들어 있다(관리자가 진행을 봐야 한다).
   */
  smes: SmeReviewFeedback[];
  /** 신호 계산에 실제로 쓰인 검토 id(=제출된 것). 화면이 비교 열을 이 순서로 그리면 된다. */
  comparedReviewIds: string[];
}

/**
 * 한 직무의 SME별 응답 비교(§6-3 ⓑ 비교 뷰).
 * reviewApi.fetchJobReviewFeedback(쿼리 6회)를 재사용하고, 거기에 없는 FTE 배분과
 * 과업명 해석에 필요한 3회를 더한다 — 합계 9회, SME 수와 무관하다.
 *
 * 과업명은 job_tasks(기존 확정 과업)와 new_task_suggestions(이번 검토의 신규 제안) 양쪽에서 푼다.
 * 신규 제안은 SME마다 행 id가 다르므로 이름으로 같은 과업을 맞춘다(suggestionKey).
 *
 * fetchJobReviewFeedback은 throw 규약이라 여기서 try/catch로 받아 ApiResult로 바꾼다.
 * 이 파일에서 규약이 갈리는 곳은 여기 한 곳뿐이다.
 */
export async function fetchJobComparison(jobId: string): Promise<ApiResult<JobComparison>> {
  if (!supabase) return fail('SME 응답 비교 조회', NO_DB);

  let smes: SmeReviewFeedback[];
  try {
    smes = await fetchJobReviewFeedback(jobId);
  } catch (e) {
    return fail('SME 응답 비교 조회', e instanceof Error ? e.message : String(e));
  }

  const submitted = smes.filter((s) => isComparableReview(s.status));
  const reviewIds = submitted.map((s) => s.review_id);

  // v2 D1: 제안·배분은 검토 수에 비례해 늘어난다(제출 2명 × 과업 25개 = 50행이지만 워크숍 대상
  // 직무를 모아 보는 경로에서는 훨씬 커진다). 청크 + 끝까지 읽기로 통일했다(lib/paging.ts).
  const [tasks, suggestions, fte] = await Promise.all([
    fetchAllPages(() => supabase!.from('job_tasks').select('id, name').eq('job_id', jobId).eq('active', true)),
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!.from('new_task_suggestions').select('id, review_id, name').in('review_id', ids),
    ),
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!
        .from('task_fte_allocations')
        .select('review_id, target_type, task_id, suggestion_id, pct')
        .in('review_id', ids),
    ),
  ]);

  const firstError = [tasks, suggestions, fte].find((r) => r.error)?.error;
  if (firstError) return fail('SME 응답 비교 조회', firstError);

  const taskName = new Map<string, string>();
  for (const raw of tasks.rows) {
    const r = raw as Row;
    taskName.set(str(r.id), str(r.name));
  }
  const suggestionName = new Map<string, string>();
  for (const raw of suggestions.rows) {
    const r = raw as Row;
    suggestionName.set(str(r.id), str(r.name));
  }

  const input: JobSignalInput = { reviewIds, suitability: [], fte: [], newTasks: [] };

  for (const sme of submitted) {
    for (const f of sme.feedback.job) {
      input.suitability.push({
        key: `job:${f.section}`,
        name: f.section,
        reviewId: sme.review_id,
        value: f.suitability,
      });
    }
    for (const f of sme.feedback.tasks) {
      input.suitability.push({
        key: `task:${f.task_id}`,
        name: taskName.get(f.task_id) ?? '(삭제된 과업)',
        reviewId: sme.review_id,
        value: f.suitability,
      });
    }
    for (const f of sme.feedback.skills) {
      input.suitability.push({
        key: `skill:${f.skill_id}`,
        name: '',
        reviewId: sme.review_id,
        value: f.suitability,
      });
    }
    for (const t of sme.feedback.newTasks) {
      input.newTasks.push({ reviewId: sme.review_id, name: t.name });
    }
  }

  for (const raw of fte.rows) {
    const r = raw as Row;
    const suggested = str(r.target_type) === 'SUGGESTED';
    const name = suggested
      ? suggestionName.get(str(r.suggestion_id)) ?? '(사라진 제안)'
      : taskName.get(str(r.task_id)) ?? '(삭제된 과업)';
    input.fte.push({
      key: suggested ? suggestionKey(name) : `task:${str(r.task_id)}`,
      name,
      targetType: suggested ? 'SUGGESTED' : 'EXISTING',
      reviewId: str(r.review_id),
      pct: num(r.pct),
    });
  }

  return ok({ jobId, smes, comparedReviewIds: reviewIds, ...computeJobSignals(input) });
}
