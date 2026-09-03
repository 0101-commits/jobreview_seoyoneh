import {
  ApiResult,
  InquiryStatus,
  NO_DB,
  Row,
  currentUserId,
  daysSince,
  fail,
  invalid,
  numOrNull,
  ok,
  one,
  str,
  supabase,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 8. 문의 인박스 (§6-3 ⓒ)
// ────────────────────────────────────────────────────────────────────

/** 인박스 필터. §6-3 ⓒ의 "상태(미답/답변/종결)" 그대로다. */
export type InquiryFilter = 'ALL' | InquiryStatus;

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  OPEN: '미답',
  ANSWERED: '답변',
  CLOSED: '종결',
};

/*
 * 답변·종결이 한 행도 고치지 못했을 때의 문구.
 *
 * .update()는 .select()가 없으면 return=minimal로 나가 204를 받고 { data: null, error: null }을
 * 돌려준다. RLS UPDATE 정책(inquiries_owner_update)이 행을 걸러내면 매칭 행이 0이 되지만 에러는
 * 나지 않고, 잠금 트리거도 갱신되는 행이 없으면 아예 발화하지 않는다. 그대로 두면
 * "답변을 저장했습니다" 토스트만 뜨고 DB에는 아무것도 남지 않는다 — 조회 실패를 0건으로 위장하지
 * 않는다는 원칙(jobApi.ts 상단)이 쓰기 경로에서 뒤집히는 자리다. 그래서 .select('id')로
 * 고쳐진 행을 세고, 0이면 실패로 돌린다(decide_review가 P0002로 같은 상황을 막는 것과 같은 결).
 *
 * 실제로 닿는 경로 둘: SME가 자기 문의를 지운 뒤 열어 둔 인박스에서 답변할 때,
 * 관리자 계정이 세션 도중 비활성화·역할 변경되어 서버의 is_admin()만 false가 될 때.
 */
const INQUIRY_MISS = '해당 문의를 찾을 수 없거나 권한이 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.';

export interface AdminInquiry {
  id: string;
  smeId: string;
  smeName: string;
  organization: string;
  reviewId: string | null;
  /** 문의에 자동 첨부된 직무 컨텍스트(§6-3 ⓒ). review_id가 없으면 빈 값이다. */
  jobId: string | null;
  jobName: string;
  step: number | null;
  body: string;
  status: InquiryStatus;
  answer: string;
  answeredAt: string | null;
  createdAt: string | null;
  /** 미답 경과일(§6-3 ⓒ). OPEN이 아니거나 시각을 못 읽으면 null. */
  waitingDays: number | null;
}

/**
 * 문의 인박스(§6-3 ⓒ). 쿼리 2회(문의+작성자 1 + 검토→직무 해석 1).
 * inquiries에는 company_id가 없으므로 작성자 profiles를 inner join 해서 계열사로 좁힌다.
 */
export async function fetchInquiries(
  companyId?: string | null,
  filter: InquiryFilter = 'ALL',
): Promise<ApiResult<AdminInquiry[]>> {
  if (!supabase) return fail('문의 목록 조회', NO_DB);

  let query = supabase
    .from('inquiries')
    .select(
      `
      id, sme_id, review_id, step, body, status, answer, answered_at, created_at,
      profiles!inner(id, name, organization, company_id),
      reviews(id, assignment_id)
    `,
    )
    .order('created_at', { ascending: false });
  if (companyId) query = query.eq('profiles.company_id', companyId);
  if (filter !== 'ALL') query = query.eq('status', filter);

  const { data, error } = await query;
  if (error) return fail('문의 목록 조회', error.message);

  const rows = (data || []).map((raw) => raw as Row);
  const assignmentIds = [
    ...new Set(rows.map((r) => str(one(r.reviews).assignment_id)).filter(Boolean)),
  ];

  const jobByAssignment = new Map<string, { id: string; name: string }>();
  if (assignmentIds.length) {
    const { data: assignments, error: assignmentError } = await supabase
      .from('review_assignments')
      .select('id, job_id, jobs!inner(id, name)')
      .in('id', assignmentIds);
    if (assignmentError) return fail('문의 목록 조회', assignmentError.message);
    for (const raw of assignments || []) {
      const r = raw as Row;
      const job = one(r.jobs);
      jobByAssignment.set(str(r.id), { id: str(job.id) || str(r.job_id), name: str(job.name) });
    }
  }

  return ok(
    rows.map((r) => {
      const profile = one(r.profiles);
      const job = jobByAssignment.get(str(one(r.reviews).assignment_id));
      const status: InquiryStatus =
        str(r.status) === 'ANSWERED' || str(r.status) === 'CLOSED' ? (str(r.status) as InquiryStatus) : 'OPEN';
      const createdAt = str(r.created_at) || null;
      return {
        id: str(r.id),
        smeId: str(profile.id) || str(r.sme_id),
        smeName: str(profile.name),
        organization: str(profile.organization),
        reviewId: str(r.review_id) || null,
        jobId: job?.id ?? null,
        jobName: job?.name ?? '',
        step: numOrNull(r.step),
        body: str(r.body),
        status,
        answer: str(r.answer),
        answeredAt: str(r.answered_at) || null,
        createdAt,
        waitingDays: status === 'OPEN' && createdAt ? daysSince(createdAt) : null,
      } satisfies AdminInquiry;
    }),
  );
}

/**
 * 문의 답변(§6-3 ⓒ). 답변하면 SME 화면에 배너로 노출된다.
 *
 * inquiries의 status·answer·answered_by·answered_at은 컬럼 잠금 트리거(20260901020000 ⑨)가
 * 걸려 있지만 통과 조건이 "app.trusted_rpc 마커 또는 public.is_admin()"이라
 * 관리자는 직접 update로 답변할 수 있다. 전용 RPC를 새로 만들지 않는 이유가 이것이다.
 * 쿼리 1회(+ 작성자 id 조회 1회).
 */
export async function answerInquiry(inquiryId: string, answer: string): Promise<ApiResult<void>> {
  if (!supabase) return fail('문의 답변', NO_DB);
  const text = answer.trim();
  if (!text) return invalid('답변 내용을 입력해 주세요.');

  const { data, error } = await supabase
    .from('inquiries')
    .update({
      answer: text,
      status: 'ANSWERED',
      answered_by: await currentUserId(),
      answered_at: new Date().toISOString(),
    })
    .eq('id', inquiryId)
    .select('id');
  if (error) return fail('문의 답변', error.message);
  if (!data || data.length === 0) return fail('문의 답변', INQUIRY_MISS);
  return ok(undefined);
}

/** 문의 종결(§6-3 ⓒ). 답변 없이 닫을 수도 있으므로 answer는 건드리지 않는다. 쿼리 1회. */
export async function closeInquiry(inquiryId: string): Promise<ApiResult<void>> {
  if (!supabase) return fail('문의 종결', NO_DB);
  const { data, error } = await supabase
    .from('inquiries')
    .update({ status: 'CLOSED' })
    .eq('id', inquiryId)
    .select('id');
  if (error) return fail('문의 종결', error.message);
  if (!data || data.length === 0) return fail('문의 종결', INQUIRY_MISS);
  return ok(undefined);
}
