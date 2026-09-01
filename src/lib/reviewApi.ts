import { supabase } from './supabase';

/*
 * SME 검토 저장 API.
 *
 * 이 파일의 함수는 실패를 빈 배열이나 null로 감추지 않고 그대로 throw 한다.
 * 화면은 try/catch로 받아 사용자에게 원인과 다음 행동을 보여줘야 한다.
 *
 * 저장은 전부 Postgres RPC(save_review_draft / submit_review) 한 번의 호출로 처리한다.
 * 한 트랜잭션이라 중간에 실패해도 DB가 절반만 바뀌지 않는다.
 * (supabase/migrations/20260828010000_add_review_draft_rpc.sql)
 */

// ── 값 타입 ─────────────────────────────────────────────────────────

export type ReviewStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'REVIEW_REQUESTED' | 'RESUBMITTED';
export type Suitability = 'SUITABLE' | 'NEEDS_EDIT' | 'UNSUITABLE';
export type JobFeedbackSection = 'NAME' | 'DEFINITION' | 'REQ_EDUCATION' | 'REQ_MAJOR' | 'REQ_CERTIFICATIONS';

/** 화면에서 쓰는 한국어 라벨. App.tsx의 Suitability와 같은 값이다. */
export type SuitabilityLabel = '적합' | '일부 수정 필요' | '부적합' | '';

/** 화면에서 쓰는 피드백 한 칸. App.tsx의 Feedback과 같은 모양이다. */
export interface UiFeedback {
  suitability: SuitabilityLabel;
  comment: string;
  suggestion: string;
  remove?: boolean;
}

const LABEL_TO_DB: Record<SuitabilityLabel, Suitability | null> = {
  적합: 'SUITABLE',
  '일부 수정 필요': 'NEEDS_EDIT',
  부적합: 'UNSUITABLE',
  '': null,
};

const DB_TO_LABEL: Record<Suitability, SuitabilityLabel> = {
  SUITABLE: '적합',
  NEEDS_EDIT: '일부 수정 필요',
  UNSUITABLE: '부적합',
};

export function toDbSuitability(label: SuitabilityLabel): Suitability | null {
  return LABEL_TO_DB[label] ?? null;
}

export function toSuitabilityLabel(value: Suitability | null | undefined): SuitabilityLabel {
  return value ? (DB_TO_LABEL[value] ?? '') : '';
}

/** 화면의 feedback 키 ↔ job_feedback.section 대응. App.tsx가 쓰는 키를 그대로 따른다. */
const UI_KEY_TO_SECTION: Record<string, JobFeedbackSection> = {
  name: 'NAME',
  definition: 'DEFINITION',
  'req-education': 'REQ_EDUCATION',
  'req-major': 'REQ_MAJOR',
  'req-certifications': 'REQ_CERTIFICATIONS',
};

const SECTION_TO_UI_KEY: Record<JobFeedbackSection, string> = {
  NAME: 'name',
  DEFINITION: 'definition',
  REQ_EDUCATION: 'req-education',
  REQ_MAJOR: 'req-major',
  REQ_CERTIFICATIONS: 'req-certifications',
};

// ── 저장 payload 타입 ───────────────────────────────────────────────

export interface JobFeedbackInput {
  section: JobFeedbackSection;
  suitability: Suitability | null;
  comment: string;
  suggestion: string;
}

export interface TaskFeedbackInput {
  task_id: string;
  suitability: Suitability | null;
  comment: string;
  suggestion: string;
  delete_requested: boolean;
}

export interface SkillFeedbackInput {
  skill_id: string;
  suitability: Suitability | null;
  comment: string;
  suggestion: string;
  delete_requested: boolean;
}

export interface SuggestionInput {
  name: string;
  description: string;
  reason: string;
}

/**
 * 저장 payload. 피드백 3종은 upsert라서 "지금 화면에 있는 전체 상태"를 매번 보내야 한다.
 * 일부만 보내면 이전에 저장된 행이 그대로 남는다.
 * 신규 제안 2종은 전체 교체다.
 */
export interface ReviewDraftPayload {
  job: JobFeedbackInput[];
  tasks: TaskFeedbackInput[];
  skills: SkillFeedbackInput[];
  newTasks: SuggestionInput[];
  newSkills: SuggestionInput[];
}

export const EMPTY_DRAFT_PAYLOAD: ReviewDraftPayload = {
  job: [],
  tasks: [],
  skills: [],
  newTasks: [],
  newSkills: [],
};

// ── 조회 결과 타입 ──────────────────────────────────────────────────

/** 저장/제출 후 DB가 돌려준 검토 상태. */
export interface ReviewState {
  review_id: string;
  status: ReviewStatus;
  started_at: string | null;
  last_saved_at: string | null;
  submitted_at: string | null;
}

/**
 * 서버 제출 게이트가 돌려준 부족 항목 한 건.
 * step은 마법사 단계 번호(0=가이드, 1~5), kind는 사유 종류, label은 화면에 그대로 띄울 문구다.
 */
export interface MissingItem {
  step: number;
  kind: string;
  label: string;
}

/**
 * 제출 결과. 게이트에 걸린 것은 "오류"가 아니라 "아직 덜 채운 상태"라서 예외로 던지지 않는다.
 * 던지면 화면이 저장 실패와 구분하지 못해 "다시 시도" 버튼만 내밀게 되는데,
 * 사용자가 해야 할 일은 재시도가 아니라 빠진 항목을 채우는 것이다.
 */
export type SubmitResult = { ok: true; state: ReviewState } | { ok: false; missing: MissingItem[] };

/** 내가 검토할 직무 한 건. */
export interface MyAssignment {
  assignment_id: string;
  job_id: string;
  job_name: string;
  group_name: string;
  series_name: string;
  review_id: string | null;
  status: ReviewStatus;
  last_saved_at: string | null;
  submitted_at: string | null;
}

/** 화면 복원용 저장 내용 전체. */
export interface ReviewFeedbackData {
  job: JobFeedbackInput[];
  tasks: TaskFeedbackInput[];
  skills: SkillFeedbackInput[];
  newTasks: SuggestionInput[];
  newSkills: SuggestionInput[];
}

// ── 내부 헬퍼 ───────────────────────────────────────────────────────

// client·fail은 surveyApi.ts도 그대로 쓴다. 연결 끊김·실패 문구를 두 파일이 따로 쓰면
// 같은 상황에서 화면 문구가 갈라지므로 여기 한 곳에만 두고 내보낸다.
export function client() {
  if (!supabase) throw new Error('데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.');
  return supabase;
}

export function fail(what: string, message: string): never {
  throw new Error(`${what} 실패했습니다. ${message}`);
}

/** PostgREST가 1:1 관계를 객체로 줄 때와 배열로 줄 때를 모두 받아 준다. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const suit = (v: unknown): Suitability | null =>
  v === 'SUITABLE' || v === 'NEEDS_EDIT' || v === 'UNSUITABLE' ? v : null;

// ── 배정·검토 세션 ──────────────────────────────────────────────────

/**
 * 내가 검토해야 할 직무 목록. review_assignments 기준이라 배정되지 않은 직무는 나오지 않는다.
 * (배정이 없는 직무는 저장할 review 행을 만들 수 없으므로 화면에 띄우면 안 된다.)
 */
export async function fetchMyAssignments(smeId: string): Promise<MyAssignment[]> {
  const { data, error } = await client()
    .from('review_assignments')
    .select(
      `
      id,
      job_id,
      jobs!inner(id, name, job_groups!inner(name), job_series!inner(name)),
      reviews(id, status, last_saved_at, submitted_at)
    `,
    )
    .eq('sme_id', smeId)
    .eq('active', true)
    .eq('jobs.active', true);

  if (error) fail('배정된 직무를 불러오지', error.message);

  return (data || [])
    .map((raw) => {
      const r = raw as Row;
      const job = one<Row>(r.jobs as Row) || {};
      const group = one<Row>(job.job_groups as Row) || {};
      const series = one<Row>(job.job_series as Row) || {};
      const review = one<Row>(r.reviews as Row);
      return {
        assignment_id: str(r.id),
        job_id: str(r.job_id),
        job_name: str(job.name),
        group_name: str(group.name),
        series_name: str(series.name),
        review_id: review ? str(review.id) : null,
        status: (review ? (review.status as ReviewStatus) : 'NOT_STARTED') || 'NOT_STARTED',
        last_saved_at: review ? str(review.last_saved_at) || null : null,
        submitted_at: review ? str(review.submitted_at) || null : null,
      };
    })
    .sort((a, b) => a.job_name.localeCompare(b.job_name, 'ko'));
}

/** 배정에 붙은 검토 세션을 가져온다. 없으면 NOT_STARTED로 만든다. */
export async function getOrCreateReview(assignmentId: string): Promise<ReviewState> {
  const db = client();

  const { data: existing, error: selectError } = await db
    .from('reviews')
    .select('id, status, started_at, last_saved_at, submitted_at')
    .eq('assignment_id', assignmentId)
    .maybeSingle();
  if (selectError) fail('검토 상태를 불러오지', selectError.message);
  if (existing) return toReviewState(existing as Row);

  const { data: created, error: insertError } = await db
    .from('reviews')
    .insert({ assignment_id: assignmentId, status: 'NOT_STARTED' })
    .select('id, status, started_at, last_saved_at, submitted_at')
    .maybeSingle();

  // 다른 탭이 먼저 만들었으면 unique(assignment_id)에 걸린다. 그때는 다시 읽어 온다.
  if (insertError?.code === '23505') {
    const { data: retry, error: retryError } = await db
      .from('reviews')
      .select('id, status, started_at, last_saved_at, submitted_at')
      .eq('assignment_id', assignmentId)
      .maybeSingle();
    if (retryError) fail('검토 상태를 불러오지', retryError.message);
    if (retry) return toReviewState(retry as Row);
  }
  if (insertError) fail('검토를 시작하지', insertError.message);
  if (!created) fail('검토를 시작하지', '생성된 검토를 찾을 수 없습니다.');
  return toReviewState(created as Row);
}

/**
 * 직무 id로 바로 검토 세션을 연다. 화면이 직무를 먼저 고르는 구조라 이 쪽을 주로 쓴다.
 * 배정이 없으면 저장할 수 없으므로 사용자에게 보여줄 문구로 예외를 던진다.
 */
export async function getOrCreateReviewForJob(smeId: string, jobId: string): Promise<ReviewState> {
  const { data, error } = await client()
    .from('review_assignments')
    .select('id')
    .eq('sme_id', smeId)
    .eq('job_id', jobId)
    .eq('active', true)
    .maybeSingle();
  if (error) fail('검토 배정을 확인하지', error.message);
  if (!data)
    throw new Error(
      '이 직무는 회원님께 배정되어 있지 않아 검토를 저장할 수 없습니다. 관리자에게 배정을 요청해 주세요.',
    );
  return getOrCreateReview(str((data as Row).id));
}

function toReviewState(row: Row): ReviewState {
  return {
    review_id: str(row.id),
    status: (row.status as ReviewStatus) || 'NOT_STARTED',
    started_at: str(row.started_at) || null,
    last_saved_at: str(row.last_saved_at) || null,
    submitted_at: str(row.submitted_at) || null,
  };
}

// ── 저장된 검토 내용 복원 ───────────────────────────────────────────

export async function fetchReviewFeedback(reviewId: string): Promise<ReviewFeedbackData> {
  const db = client();
  const [job, tasks, skills, newTasks, newSkills] = await Promise.all([
    db.from('job_feedback').select('section, suitability, comment, suggestion').eq('review_id', reviewId),
    db
      .from('task_feedback')
      .select('task_id, suitability, comment, suggestion, delete_requested')
      .eq('review_id', reviewId),
    db
      .from('skill_feedback')
      .select('skill_id, suitability, comment, suggestion, delete_requested')
      .eq('review_id', reviewId),
    db.from('new_task_suggestions').select('name, description, reason').eq('review_id', reviewId).order('created_at'),
    db.from('new_skill_suggestions').select('name, description, reason').eq('review_id', reviewId).order('created_at'),
  ]);

  const firstError = [job, tasks, skills, newTasks, newSkills].find((r) => r.error)?.error;
  if (firstError) fail('저장된 검토 내용을 불러오지', firstError.message);

  const toSuggestion = (rows: unknown[] | null): SuggestionInput[] =>
    (rows || []).map((raw) => {
      const r = raw as Row;
      return { name: str(r.name), description: str(r.description), reason: str(r.reason) };
    });

  return {
    job: (job.data || []).map((raw) => {
      const r = raw as Row;
      return {
        section: r.section as JobFeedbackSection,
        suitability: suit(r.suitability),
        comment: str(r.comment),
        suggestion: str(r.suggestion),
      };
    }),
    tasks: (tasks.data || []).map((raw) => {
      const r = raw as Row;
      return {
        task_id: str(r.task_id),
        suitability: suit(r.suitability),
        comment: str(r.comment),
        suggestion: str(r.suggestion),
        delete_requested: r.delete_requested === true,
      };
    }),
    skills: (skills.data || []).map((raw) => {
      const r = raw as Row;
      return {
        skill_id: str(r.skill_id),
        suitability: suit(r.suitability),
        comment: str(r.comment),
        suggestion: str(r.suggestion),
        delete_requested: r.delete_requested === true,
      };
    }),
    newTasks: toSuggestion(newTasks.data),
    newSkills: toSuggestion(newSkills.data),
  };
}

// ── 저장 ────────────────────────────────────────────────────────────

function rpcArgs(reviewId: string, payload: ReviewDraftPayload) {
  return {
    p_review_id: reviewId,
    p_job: payload.job,
    p_tasks: payload.tasks,
    p_skills: payload.skills,
    p_new_tasks: payload.newTasks,
    p_new_skills: payload.newSkills,
  };
}

function toState(data: unknown, what: string): ReviewState {
  const r = (data || {}) as Row;
  if (!r.review_id) fail(what, '서버가 검토 상태를 돌려주지 않았습니다.');
  return {
    review_id: str(r.review_id),
    status: (r.status as ReviewStatus) || 'IN_PROGRESS',
    started_at: str(r.started_at) || null,
    last_saved_at: str(r.last_saved_at) || null,
    submitted_at: str(r.submitted_at) || null,
  };
}

/** 임시저장. 한 트랜잭션에서 피드백 3종과 신규 제안 2종을 함께 저장한다. */
export async function saveReviewDraft(reviewId: string, payload: ReviewDraftPayload): Promise<ReviewState> {
  const { data, error } = await client().rpc('save_review_draft', rpcArgs(reviewId, payload));
  if (error) fail('검토 내용을 저장하지', error.message);
  return toState(data, '검토 내용을 저장하지');
}

/** 서버가 준 부족 항목 배열을 화면이 그대로 쓸 수 있는 모양으로 정리한다. 개수는 서버가 준 그대로 보존한다. */
function toMissing(value: unknown): MissingItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const r = (raw || {}) as Row;
    return { step: typeof r.step === 'number' ? r.step : 0, kind: str(r.kind), label: str(r.label) };
  });
}

/**
 * 최종 제출. 저장과 제출이 한 트랜잭션이라 payload를 함께 보내면 따로 임시저장할 필요가 없다.
 *
 * 서버 제출 게이트(§7-2)는 ①전 섹션 평가 ②조건부 필수 의견 ③FTE 합계 100.00 ④호출자=배정 SME 본인을
 * 다시 검증하고, 하나라도 모자라면 예외 대신 { ok:false, missing:[...] }를 돌려준다.
 * 이 파일의 원칙("실패를 감추지 않는다")은 그대로다 — 네트워크·권한 오류는 여전히 throw 한다.
 * 부족 항목은 실패가 아니라 사용자가 화면에서 채우면 되는 상태라서 호출부가 구분하도록 값으로 돌려줄 뿐이다.
 *
 * 게이트가 없던 구버전 서버는 ok 키 없이 검토 상태만 돌려준다. 그래서 ok가 undefined면 성공으로 읽는다.
 */
export async function submitReview(
  reviewId: string,
  payload: ReviewDraftPayload = EMPTY_DRAFT_PAYLOAD,
  note = '',
): Promise<SubmitResult> {
  const { data, error } = await client().rpc('submit_review', { ...rpcArgs(reviewId, payload), p_note: note });
  if (error) fail('검토를 제출하지', error.message);

  const r = (data || {}) as Row;
  if (r.ok === false) return { ok: false, missing: toMissing(r.missing) };
  // 성공 응답은 검토 상태를 평평하게 담아 준다. state로 한 번 감싸 보내는 경우도 같이 받아 둔다.
  return { ok: true, state: toState((r.state as Row) ?? r, '검토를 제출하지') };
}

// ── 화면 상태 ↔ payload 변환 ────────────────────────────────────────

const isEmpty = (f: UiFeedback) => !f.suitability && !f.comment.trim() && !f.suggestion.trim() && !f.remove;

/**
 * 화면의 `Record<string, Feedback>`(키: name / definition / req-* / task-<id> / skill-<id>)을
 * 저장 payload로 바꾼다. 아무것도 입력하지 않은 항목은 보내지 않는다.
 */
export function buildDraftPayload(
  feedback: Record<string, UiFeedback>,
  suggestions: { newTasks?: SuggestionInput[]; newSkills?: SuggestionInput[] } = {},
): ReviewDraftPayload {
  const payload: ReviewDraftPayload = {
    job: [],
    tasks: [],
    skills: [],
    newTasks: (suggestions.newTasks || []).filter((s) => s.name.trim()),
    newSkills: (suggestions.newSkills || []).filter((s) => s.name.trim()),
  };

  for (const [key, raw] of Object.entries(feedback)) {
    const f: UiFeedback = {
      suitability: raw?.suitability || '',
      comment: raw?.comment || '',
      suggestion: raw?.suggestion || '',
      remove: raw?.remove,
    };
    if (isEmpty(f)) continue;

    const section = UI_KEY_TO_SECTION[key];
    if (section) {
      payload.job.push({
        section,
        suitability: toDbSuitability(f.suitability),
        comment: f.comment,
        suggestion: f.suggestion,
      });
    } else if (key.startsWith('task-')) {
      payload.tasks.push({
        task_id: key.slice('task-'.length),
        suitability: toDbSuitability(f.suitability),
        comment: f.comment,
        suggestion: f.suggestion,
        delete_requested: f.remove === true,
      });
    } else if (key.startsWith('skill-')) {
      payload.skills.push({
        skill_id: key.slice('skill-'.length),
        suitability: toDbSuitability(f.suitability),
        comment: f.comment,
        suggestion: f.suggestion,
        delete_requested: f.remove === true,
      });
    }
  }

  return payload;
}

/** fetchReviewFeedback 결과를 화면의 `Record<string, Feedback>`으로 되돌린다. */
export function toFeedbackState(data: ReviewFeedbackData): Record<string, UiFeedback> {
  const state: Record<string, UiFeedback> = {};
  for (const f of data.job) {
    const key = SECTION_TO_UI_KEY[f.section];
    if (!key) continue;
    state[key] = { suitability: toSuitabilityLabel(f.suitability), comment: f.comment, suggestion: f.suggestion };
  }
  for (const f of data.tasks) {
    state[`task-${f.task_id}`] = {
      suitability: toSuitabilityLabel(f.suitability),
      comment: f.comment,
      suggestion: f.suggestion,
      remove: f.delete_requested,
    };
  }
  for (const f of data.skills) {
    state[`skill-${f.skill_id}`] = {
      suitability: toSuitabilityLabel(f.suitability),
      comment: f.comment,
      suggestion: f.suggestion,
      remove: f.delete_requested,
    };
  }
  return state;
}

// ── 관리자용: 한 직무에 달린 SME 피드백 전체 ────────────────────────
//
// fetchReviewFeedback는 review 한 건 기준이라 관리자 화면에서는 쓸 수 없다.
// 관리자는 같은 직무를 검토한 여러 SME의 의견을 한 번에 봐야 하므로
// 배정 → 검토 → 피드백 5종을 묶어서 한 번에 가져온다(쿼리 6회, SME 수와 무관).

/** SME 한 명이 이 직무에 남긴 검토 전체. */
export interface SmeReviewFeedback {
  review_id: string;
  sme_id: string;
  sme_name: string;
  organization: string;
  status: ReviewStatus;
  submitted_at: string | null;
  last_saved_at: string | null;
  feedback: ReviewFeedbackData;
}

const emptyFeedback = (): ReviewFeedbackData => ({ job: [], tasks: [], skills: [], newTasks: [], newSkills: [] });

const hasContent = (f: ReviewFeedbackData) =>
  f.job.length > 0 || f.tasks.length > 0 || f.skills.length > 0 || f.newTasks.length > 0 || f.newSkills.length > 0;

const SUBMITTED_STATUSES: ReviewStatus[] = ['SUBMITTED', 'RESUBMITTED', 'REVIEW_REQUESTED'];

export async function fetchJobReviewFeedback(jobId: string): Promise<SmeReviewFeedback[]> {
  const db = client();

  const { data, error } = await db
    .from('review_assignments')
    .select(
      `
      sme_id,
      profiles!inner(name, organization),
      reviews!inner(id, status, submitted_at, last_saved_at)
    `,
    )
    .eq('job_id', jobId)
    .eq('active', true);
  if (error) fail('SME 검토 내용을 불러오지', error.message);

  const reviews: SmeReviewFeedback[] = (data || [])
    .map((raw) => {
      const r = raw as Row;
      const profile = one<Row>(r.profiles as Row) || {};
      const review = one<Row>(r.reviews as Row) || {};
      return {
        review_id: str(review.id),
        sme_id: str(r.sme_id),
        sme_name: str(profile.name),
        organization: str(profile.organization),
        status: (review.status as ReviewStatus) || 'NOT_STARTED',
        submitted_at: str(review.submitted_at) || null,
        last_saved_at: str(review.last_saved_at) || null,
        feedback: emptyFeedback(),
      };
    })
    .filter((r) => r.review_id);

  if (reviews.length === 0) return [];
  const ids = reviews.map((r) => r.review_id);

  const [job, tasks, skills, newTasks, newSkills] = await Promise.all([
    db.from('job_feedback').select('review_id, section, suitability, comment, suggestion').in('review_id', ids),
    db
      .from('task_feedback')
      .select('review_id, task_id, suitability, comment, suggestion, delete_requested')
      .in('review_id', ids),
    db
      .from('skill_feedback')
      .select('review_id, skill_id, suitability, comment, suggestion, delete_requested')
      .in('review_id', ids),
    db
      .from('new_task_suggestions')
      .select('review_id, name, description, reason')
      .in('review_id', ids)
      .order('created_at'),
    db
      .from('new_skill_suggestions')
      .select('review_id, name, description, reason')
      .in('review_id', ids)
      .order('created_at'),
  ]);

  const firstError = [job, tasks, skills, newTasks, newSkills].find((r) => r.error)?.error;
  if (firstError) fail('SME 검토 내용을 불러오지', firstError.message);

  const byId = new Map(reviews.map((r) => [r.review_id, r]));
  const bucket = (raw: unknown): ReviewFeedbackData | null => {
    const r = raw as Row;
    return byId.get(str(r.review_id))?.feedback ?? null;
  };

  for (const raw of job.data || []) {
    const r = raw as Row;
    bucket(raw)?.job.push({
      section: r.section as JobFeedbackSection,
      suitability: suit(r.suitability),
      comment: str(r.comment),
      suggestion: str(r.suggestion),
    });
  }
  for (const raw of tasks.data || []) {
    const r = raw as Row;
    bucket(raw)?.tasks.push({
      task_id: str(r.task_id),
      suitability: suit(r.suitability),
      comment: str(r.comment),
      suggestion: str(r.suggestion),
      delete_requested: r.delete_requested === true,
    });
  }
  for (const raw of skills.data || []) {
    const r = raw as Row;
    bucket(raw)?.skills.push({
      skill_id: str(r.skill_id),
      suitability: suit(r.suitability),
      comment: str(r.comment),
      suggestion: str(r.suggestion),
      delete_requested: r.delete_requested === true,
    });
  }
  for (const raw of newTasks.data || []) {
    const r = raw as Row;
    bucket(raw)?.newTasks.push({ name: str(r.name), description: str(r.description), reason: str(r.reason) });
  }
  for (const raw of newSkills.data || []) {
    const r = raw as Row;
    bucket(raw)?.newSkills.push({ name: str(r.name), description: str(r.description), reason: str(r.reason) });
  }

  // 아직 아무것도 쓰지 않은 배정은 관리자 화면에서 잡음이라 감춘다.
  // 제출까지 간 검토는 내용이 비어 있어도 남긴다(제출 사실 자체가 정보다).
  return reviews
    .filter((r) => hasContent(r.feedback) || SUBMITTED_STATUSES.includes(r.status))
    .sort(
      (a, b) =>
        (b.submitted_at || '').localeCompare(a.submitted_at || '') || a.sme_name.localeCompare(b.sme_name, 'ko'),
    );
}

/**
 * 재검토 요청(반려). reviews.status를 REVIEW_REQUESTED로 바꾸고 review_history에 사유를 남긴다.
 * 두 쓰기가 한 트랜잭션이어야 감사 기록이 어긋나지 않으므로 RPC 한 번으로 처리한다.
 * (supabase/migrations/20260828020000_add_request_rereview_rpc.sql)
 */
export async function requestRereview(reviewId: string, note: string): Promise<ReviewState> {
  const { data, error } = await client().rpc('request_rereview', { p_review_id: reviewId, p_note: note });
  if (error) fail('재검토를 요청하지', error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return toState(row, '재검토를 요청하지');
}
