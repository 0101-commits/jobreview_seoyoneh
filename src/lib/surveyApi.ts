import { client, fail } from './reviewApi';

/*
 * 업무조사(FTE)·운영 설정·소요 실측·문의 접근 계층.
 *
 * Phase 1에서 만든 신규 테이블(task_fte_allocations / review_sessions / inquiries / survey_settings)에
 * 대한 얇은 조회·저장 함수만 둔다. 화면은 Phase 2가 이 위에 올린다.
 *
 * reviewApi.ts와 같은 원칙이다 — 실패를 빈 배열이나 null로 감추지 않고 그대로 throw 한다.
 * 화면은 try/catch로 받아 사용자에게 원인과 다음 행동을 보여줘야 한다.
 * (다만 소요 실측은 부수 기록이라, 이탈 시점에 부르는 endReviewSession은 화면이 삼켜도 된다.)
 *
 * 연결 확인(client)과 실패 문구(fail)는 reviewApi.ts 것을 그대로 쓴다. 같은 상황에서
 * 두 파일의 문구가 갈라지지 않게 하기 위해서다.
 */

// ── 값 타입 ─────────────────────────────────────────────────────────

/** FTE 배분 대상. EXISTING=기존 확정 과업, SUGGESTED=이번 검토에서 SME가 새로 제안한 과업. */
export type FteTargetType = 'EXISTING' | 'SUGGESTED';

export type InquiryStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

// ── 저장 payload 타입 ───────────────────────────────────────────────

/**
 * 저장된 FTE 배분 한 줄(읽기 전용).
 *
 * 저장은 이제 이 파일이 하지 않는다 — save_review_draft(p_fte)가 초안과 같은 트랜잭션에서
 * 처리한다(v2 F5). 여기 남은 것은 화면 복원을 위한 조회뿐이다.
 * 신규 제안 행은 DB id 대신 client_key로 되돌린다: 화면의 키가 그 값이기 때문이다.
 */
export interface FteAllocationInput {
  target_type: FteTargetType;
  task_id: string | null;
  client_key: string | null;
  pct: number;
}

// ── 조회 결과 타입 ──────────────────────────────────────────────────

/** 회사 단위 조사 운영 설정. 마감일·예상 소요·가이드 문구·문의 담당 표기. */
export interface SurveySettings {
  company_id: string;
  due_date: string | null;
  expected_minutes: number | null;
  guide_md: string;
  inquiry_contact: string;
  updated_at: string | null;
}

/** 문의 한 건. 답변 전에는 answer가 빈 문자열이다. */
export interface Inquiry {
  id: string;
  review_id: string | null;
  step: number | null;
  body: string;
  status: InquiryStatus;
  answer: string;
  answered_at: string | null;
  created_at: string | null;
}

// ── 내부 헬퍼 ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
/** numeric·smallint는 PostgREST가 문자열로 줄 때가 있다. 값이 아예 없을 때만 null로 둔다. */
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));

// ── 운영 설정 ───────────────────────────────────────────────────────

/** 회사의 조사 설정 1행. 아직 관리자가 저장한 적이 없으면 null이다(오류가 아니다). */
export async function fetchSurveySettings(companyId: string): Promise<SurveySettings | null> {
  const { data, error } = await client()
    .from('survey_settings')
    .select('company_id, due_date, expected_minutes, guide_md, inquiry_contact, updated_at')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) fail('조사 설정을 불러오지', error.message);
  if (!data) return null;

  const r = data as Row;
  return {
    company_id: str(r.company_id),
    due_date: str(r.due_date) || null,
    expected_minutes: numOrNull(r.expected_minutes),
    guide_md: str(r.guide_md),
    inquiry_contact: str(r.inquiry_contact),
    updated_at: str(r.updated_at) || null,
  };
}

// ── 응답 소요 실측 (R4) ─────────────────────────────────────────────
//
// 화면 체류 구간만 남긴다. 개인의 작업 속도를 평가하려는 기록이 아니라
// 착수보고 11면의 "직무당 약 ○○분"을 실측으로 채우기 위한 것이다(§6-1).

/** 마법사 단계 진입 기록을 만들고 세션 id를 돌려준다. 이 id를 endReviewSession에 그대로 넘긴다. */
export async function startReviewSession(reviewId: string, step: number): Promise<string> {
  const { data, error } = await client()
    .from('review_sessions')
    .insert({ review_id: reviewId, step })
    .select('id')
    .maybeSingle();
  if (error) fail('검토 소요 기록을 시작하지', error.message);
  if (!data) fail('검토 소요 기록을 시작하지', '생성된 세션을 찾을 수 없습니다.');
  return str((data as Row).id);
}

/** 단계 이탈 기록. 이미 닫힌 세션을 다시 닫아도 시각만 덮어쓰므로 두 번 불러도 안전하다. */
export async function endReviewSession(sessionId: string): Promise<void> {
  const { error } = await client()
    .from('review_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) fail('검토 소요 기록을 마치지', error.message);
}

// ── 과업별 투입 비중(FTE) ───────────────────────────────────────────

export async function fetchFteAllocations(reviewId: string): Promise<FteAllocationInput[]> {
  // new_task_suggestions를 함께 읽어 client_key를 가져온다(FK 임베드). 화면 키가 그 값이라,
  // 여기서 풀어 두면 복원할 때 이름으로 되짚는 과정이 없어진다(v2 F5).
  const { data, error } = await client()
    .from('task_fte_allocations')
    .select('target_type, task_id, pct, new_task_suggestions(client_key)')
    .eq('review_id', reviewId);
  if (error) fail('투입 비중을 불러오지', error.message);

  return (data || []).map((raw) => {
    const r = raw as Row;
    const sug = (r.new_task_suggestions || null) as { client_key?: unknown } | null;
    return {
      target_type: r.target_type === 'SUGGESTED' ? 'SUGGESTED' : 'EXISTING',
      task_id: str(r.task_id) || null,
      client_key: sug ? str(sug.client_key) || null : null,
      pct: num(r.pct),
    };
  });
}

/*
 * (삭제) saveFteAllocations — v2 F5.
 * delete → insert 두 왕복이라 트랜잭션이 아니었고, 자동저장 도중 순단이 나면 배분 0행 상태가
 * 남았다(화면은 100%였다). 이제 save_review_draft(p_fte)가 초안 저장과 한 트랜잭션에서 처리한다.
 */

// ── 문의 ────────────────────────────────────────────────────────────

/** 문의 작성. 직무(review)와 현재 단계를 함께 넣어 관리자가 어떤 화면에서 온 질문인지 알 수 있게 한다. */
export async function createInquiry(
  smeId: string,
  reviewId: string | null,
  step: number | null,
  body: string,
): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('문의 내용을 입력해 주세요.');

  const { error } = await client()
    .from('inquiries')
    .insert({ sme_id: smeId, review_id: reviewId, step, body: text });
  if (error) fail('문의를 등록하지', error.message);
}

/** 내가 남긴 문의 목록. 최근 것이 위로 온다. */
export async function fetchMyInquiries(smeId: string): Promise<Inquiry[]> {
  const { data, error } = await client()
    .from('inquiries')
    .select('id, review_id, step, body, status, answer, answered_at, created_at')
    .eq('sme_id', smeId)
    .order('created_at', { ascending: false });
  if (error) fail('내 문의를 불러오지', error.message);

  return (data || []).map((raw) => {
    const r = raw as Row;
    const status = r.status;
    return {
      id: str(r.id),
      review_id: str(r.review_id) || null,
      step: numOrNull(r.step),
      body: str(r.body),
      status: status === 'ANSWERED' || status === 'CLOSED' ? status : 'OPEN',
      answer: str(r.answer),
      answered_at: str(r.answered_at) || null,
      created_at: str(r.created_at) || null,
    };
  });
}
