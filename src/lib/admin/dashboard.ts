import {
  ApiResult,
  NO_DB,
  ReviewStatus,
  Row,
  daysUntil,
  fail,
  fetchAllPages,
  ok,
  one,
  str,
  supabase,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 9. 대시보드 상단 4지표 (§6-3 ⓐ)
// ────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  /** 응답률 = 제출/배정. 배정이 0이면 0이다. */
  responseRate: number;
  assignedCount: number;
  submittedCount: number;
  /** survey_settings.due_date. 미설정이면 null. */
  dueDate: string | null;
  /** 마감까지 남은 날. 오늘이면 0, 지났으면 음수. due_date 미설정이면 null. */
  dDay: number | null;
  /** 배정된 검토가 전부 미시작인 SME 수 — 아직 한 번도 들어오지 않은 사람이다. */
  notStartedSme: number;
  /** 미답(OPEN) 문의 수. */
  openInquiries: number;
  /**
   * 상태별 배정 건수(v2 §6-5 "대시보드 KPI 단일화").
   * 대시보드의 도넛·범례가 이 값을 쓴다. 예전에는 도넛이 get_review_status를, 상단 KPI가
   * 이 함수를 써서 같은 화면의 두 수치가 다른 모집단을 말했다(U2).
   */
  statusCounts: Record<ReviewStatus, number>;
  /** 배정된 SME 수(중복 없이). '전체 SME 수' 카드가 쓰던 값을 같은 모집단으로 옮긴 것이다. */
  smeCount: number;
}

/**
 * 대시보드 상단 4지표(§6-3 ⓐ): 응답률(제출/배정) · 마감 D-day · 미시작 SME 수 · 미답 문의 수.
 * 쿼리 3회(배정·검토 1 + 조사 설정 1 + 미답 문의 건수 1). SME 수와 무관하다.
 *
 * D-day는 survey_settings.due_date 기준이며 미설정이면 null이다.
 * 계열사를 고르지 않은 전체 보기에서는 회사별 마감일을 하나로 합칠 수 없으므로 역시 null이다
 * (아무 회사의 마감일이나 골라 보여 주면 그 자체가 잘못된 근거가 된다).
 */
export async function fetchDashboardStats(companyId?: string | null): Promise<ApiResult<DashboardStats>> {
  if (!supabase) return fail('대시보드 지표 조회', NO_DB);

  // 배정 전량을 읽는다 — 잘리면 응답률·미시작 SME 수가 조용히 낮아진다(v2 D1).
  const assignmentPages = fetchAllPages(() => {
    let q = supabase!
      .from('review_assignments')
      .select('id, sme_id, jobs!inner(company_id, active), reviews(status)')
      .eq('active', true)
      .eq('jobs.active', true);
    if (companyId) q = q.eq('jobs.company_id', companyId);
    return q;
  });

  let inquiryQuery = supabase
    .from('inquiries')
    .select('id, profiles!inner(company_id)', { count: 'exact', head: true })
    .eq('status', 'OPEN');
  if (companyId) inquiryQuery = inquiryQuery.eq('profiles.company_id', companyId);

  const [assignments, settings, inquiries] = await Promise.all([
    assignmentPages,
    companyId
      ? supabase.from('survey_settings').select('due_date').eq('company_id', companyId).maybeSingle()
      : Promise.resolve({ data: null as Row | null, error: null as { message: string } | null }),
    inquiryQuery,
  ]);

  if (assignments.error) return fail('대시보드 지표 조회', assignments.error);
  if (settings.error) return fail('마감일 조회', settings.error.message);
  if (inquiries.error) return fail('미답 문의 수 조회', inquiries.error.message);

  let assignedCount = 0;
  let submittedCount = 0;
  const statusCounts: Record<ReviewStatus, number> = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    SUBMITTED: 0,
    RESUBMITTED: 0,
    REVIEW_REQUESTED: 0,
  };
  /** smeId → 하나라도 시작(NOT_STARTED가 아님)했는가. */
  const startedBySme = new Map<string, boolean>();

  for (const raw of assignments.rows) {
    const r = raw as Row;
    const review = one(r.reviews);
    const status = (str(review.status) as ReviewStatus) || 'NOT_STARTED';
    assignedCount += 1;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (status === 'SUBMITTED' || status === 'RESUBMITTED') submittedCount += 1;

    const smeId = str(r.sme_id);
    if (smeId) startedBySme.set(smeId, (startedBySme.get(smeId) ?? false) || status !== 'NOT_STARTED');
  }

  let notStartedSme = 0;
  for (const started of startedBySme.values()) if (!started) notStartedSme += 1;

  const dueDate = str((settings.data as Row | null)?.due_date) || null;

  return ok({
    responseRate: assignedCount > 0 ? submittedCount / assignedCount : 0,
    assignedCount,
    submittedCount,
    dueDate,
    dDay: dueDate ? daysUntil(dueDate) : null,
    notStartedSme,
    openInquiries: inquiries.count ?? 0,
    statusCounts,
    smeCount: startedBySme.size,
  });
}
