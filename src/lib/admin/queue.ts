import {
  ApiResult,
  NO_DB,
  ReviewStatus,
  Row,
  Suitability,
  fail,
  fetchAllJobsResult,
  fetchPagesByIds,
  num,
  ok,
  one,
  str,
  supabase,
} from './shared';
import {
  JobSignal,
  JobSignalInput,
  computeJobSignals,
  isComparableReview,
  suggestionKey,
} from './signals';
import {
  WorkshopFlagSource,
  fetchWorkshopFlags,
} from './workshop';

// ────────────────────────────────────────────────────────────────────
// 4. 제출 큐 (§6-3 ⓑ)
// ────────────────────────────────────────────────────────────────────

export interface SubmissionQueueItem {
  jobId: string;
  jobName: string;
  groupName: string;
  seriesName: string;
  /** 배정된 SME 수 · 그중 제출한 수 · 승인된 수. "1/2 제출"을 화면이 그릴 수 있게 셋 다 준다. */
  assignedSmeCount: number;
  submittedSmeCount: number;
  approvedSmeCount: number;
  /** 가장 마지막 제출 시각. 정렬(이견 신호 → 제출일)의 두 번째 키다. */
  submittedAt: string | null;
  /** 이견 신호 배지 수 = signals.length. 정렬의 첫 번째 키다. */
  signalCount: number;
  signals: JobSignal[];
  /** 지금 자동 규칙에 걸리는 사유. 저장된 플래그와 다를 수 있다(아직 반영 전). */
  autoReasons: string[];
  /** job_workshop_flags에 저장된 상태. 없으면 flagged=false, source=null. */
  workshopFlagged: boolean;
  workshopSource: WorkshopFlagSource | null;
  workshopReasons: string[];
}

/**
 * 제출 큐(§6-3 ⓑ). 제출이 한 건이라도 있는 직무 목록. 정렬은 화면이 한다.
 *
 * 쿼리 8회 고정(직무 목록 1 + 배정·검토 1 + 피드백 3 + FTE 1 + 신규 제안 1 + 플래그 1).
 * 직무 수·SME 수가 늘어도 회수는 그대로다.
 *
 * ponytail: 신호 계산에 필요한 응답 원본을 한 번에 받아 브라우저에서 집계한다.
 * review_id를 .in()으로 넘기므로 제출 검토가 수백 건을 넘으면 URL 길이가 한계에 닿는다.
 * 그때는 이 집계를 SECURITY DEFINER RPC(뷰) 한 개로 내리면 된다 — 화면 계약은 그대로다.
 */
export async function fetchSubmissionQueue(companyId?: string | null): Promise<ApiResult<SubmissionQueueItem[]>> {
  if (!supabase) return fail('제출 큐 조회', NO_DB);

  const jobList = await fetchAllJobsResult(companyId);
  if (!jobList.ok) return jobList;
  const jobMeta = new Map(jobList.data.map((j) => [j.id, j]));

  // reviews는 left join이다. 검토 행은 SME가 화면을 처음 열 때 만들어질 수도 있어(reviewApi.getOrCreateReview)
  // 배정만 있고 행이 없는 상태가 정상이다. inner로 걸면 그 배정이 통째로 빠져 "1/1명 제출"처럼
  // 분모가 조용히 줄어든다 — 진행 매트릭스(fetchProgressMatrix)는 같은 배정을 미시작으로 세므로
  // 두 관리자 화면이 다른 인원을 말하게 된다. 행이 없으면 one()이 {}를 주고 status가 ''라
  // 제출 집계에는 들어가지 않는다(배정 수에만 잡힌다).
  let assignmentQuery = supabase
    .from('review_assignments')
    .select(
      `
      id, sme_id, job_id,
      jobs!inner(id, name, company_id, active),
      reviews(id, status, submitted_at, approved_at)
    `,
    )
    .eq('active', true)
    .eq('jobs.active', true);
  if (companyId) assignmentQuery = assignmentQuery.eq('jobs.company_id', companyId);

  const { data: assignments, error: assignmentError } = await assignmentQuery;
  if (assignmentError) return fail('제출 큐 조회', assignmentError.message);

  interface JobBucket {
    jobId: string;
    jobName: string;
    assigned: number;
    approved: number;
    submittedReviewIds: string[];
    submittedAt: string | null;
  }
  const buckets = new Map<string, JobBucket>();
  const reviewToJob = new Map<string, string>();

  for (const raw of assignments || []) {
    const r = raw as Row;
    const job = one(r.jobs);
    const review = one(r.reviews);
    const jobId = str(job.id) || str(r.job_id);
    if (!jobId) continue;

    let bucket = buckets.get(jobId);
    if (!bucket) {
      bucket = { jobId, jobName: str(job.name), assigned: 0, approved: 0, submittedReviewIds: [], submittedAt: null };
      buckets.set(jobId, bucket);
    }
    bucket.assigned += 1;

    const status = str(review.status) as ReviewStatus;
    const reviewId = str(review.id);
    const submittedAt = str(review.submitted_at);
    if (reviewId && isComparableReview(status)) {
      bucket.submittedReviewIds.push(reviewId);
      reviewToJob.set(reviewId, jobId);
      if (submittedAt && (!bucket.submittedAt || submittedAt > bucket.submittedAt)) bucket.submittedAt = submittedAt;
      if (str(review.approved_at)) bucket.approved += 1;
    }
  }

  const queued = [...buckets.values()].filter((b) => b.submittedReviewIds.length > 0);
  const reviewIds = [...reviewToJob.keys()];

  /*
    신호 계산용 원본.
    v2 D1·D4: 예전에는 review_id 수백 개를 .in() 하나에 실어 URL 길이 한계에 기대고 있었고,
    응답도 1,000행에서 잘렸다(제출 200건 × 과업 25개면 task_feedback만 5,000행이다).
    이제 청크로 나눠 끝까지 읽는다(lib/paging.ts). 제출된 검토가 없으면 왕복하지 않는다.
  */
  const [jobFb, taskFb, skillFb, fte, suggestions, flags] = await Promise.all([
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!.from('job_feedback').select('review_id, section, suitability').in('review_id', ids),
    ),
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!.from('task_feedback').select('review_id, task_id, suitability').in('review_id', ids),
    ),
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!.from('skill_feedback').select('review_id, skill_id, suitability').in('review_id', ids),
    ),
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!
        .from('task_fte_allocations')
        .select('review_id, target_type, task_id, suggestion_id, pct')
        .in('review_id', ids),
    ),
    fetchPagesByIds(reviewIds, (ids) =>
      supabase!.from('new_task_suggestions').select('id, review_id, name').in('review_id', ids),
    ),
    fetchWorkshopFlags(companyId),
  ]);

  const firstError = [jobFb, taskFb, skillFb, fte, suggestions].find((r) => r.error)?.error;
  if (firstError) return fail('제출 큐 조회', firstError);
  if (!flags.ok) return flags;
  const flagByJob = new Map(flags.data.map((f) => [f.jobId, f]));

  // 직무별 신호 입력 모으기.
  const inputs = new Map<string, JobSignalInput>();
  for (const bucket of queued) {
    inputs.set(bucket.jobId, { reviewIds: bucket.submittedReviewIds, suitability: [], fte: [], newTasks: [] });
  }
  const inputOf = (reviewId: string): JobSignalInput | undefined => {
    const jobId = reviewToJob.get(reviewId);
    return jobId ? inputs.get(jobId) : undefined;
  };

  const suggestionName = new Map<string, string>();
  for (const raw of suggestions.rows) {
    const r = raw as Row;
    suggestionName.set(str(r.id), str(r.name));
    inputOf(str(r.review_id))?.newTasks.push({ reviewId: str(r.review_id), name: str(r.name) });
  }
  for (const raw of jobFb.rows) {
    const r = raw as Row;
    inputOf(str(r.review_id))?.suitability.push({
      key: `job:${str(r.section)}`,
      name: str(r.section),
      reviewId: str(r.review_id),
      value: (str(r.suitability) as Suitability) || null,
    });
  }
  for (const raw of taskFb.rows) {
    const r = raw as Row;
    inputOf(str(r.review_id))?.suitability.push({
      key: `task:${str(r.task_id)}`,
      name: '',
      reviewId: str(r.review_id),
      value: (str(r.suitability) as Suitability) || null,
    });
  }
  for (const raw of skillFb.rows) {
    const r = raw as Row;
    inputOf(str(r.review_id))?.suitability.push({
      key: `skill:${str(r.skill_id)}`,
      name: '',
      reviewId: str(r.review_id),
      value: (str(r.suitability) as Suitability) || null,
    });
  }
  for (const raw of fte.rows) {
    const r = raw as Row;
    const suggested = str(r.target_type) === 'SUGGESTED';
    const name = suggested ? suggestionName.get(str(r.suggestion_id)) ?? '' : '';
    inputOf(str(r.review_id))?.fte.push({
      key: suggested ? suggestionKey(name) : `task:${str(r.task_id)}`,
      name,
      targetType: suggested ? 'SUGGESTED' : 'EXISTING',
      reviewId: str(r.review_id),
      pct: num(r.pct),
    });
  }

  const items: SubmissionQueueItem[] = queued.map((bucket) => {
    const meta = jobMeta.get(bucket.jobId);
    const result = computeJobSignals(
      inputs.get(bucket.jobId) ?? { reviewIds: bucket.submittedReviewIds, suitability: [], fte: [], newTasks: [] },
    );
    const flag = flagByJob.get(bucket.jobId);
    return {
      jobId: bucket.jobId,
      jobName: bucket.jobName || meta?.name || '',
      groupName: meta?.group_name || '',
      seriesName: meta?.series_name || '',
      assignedSmeCount: bucket.assigned,
      submittedSmeCount: bucket.submittedReviewIds.length,
      approvedSmeCount: bucket.approved,
      submittedAt: bucket.submittedAt,
      signalCount: result.signals.length,
      signals: result.signals,
      autoReasons: result.workshopReasons,
      workshopFlagged: flag?.flagged ?? false,
      workshopSource: flag?.source ?? null,
      workshopReasons: flag?.reasons ?? [],
    };
  });

  return ok(items);
}
