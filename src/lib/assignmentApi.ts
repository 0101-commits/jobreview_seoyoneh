import { supabase } from './supabase';
import { fetchAllJobsResult, type ApiResult } from './jobApi';
import { cellStatusOf, type CellStatus } from './adminApi';
import { logAudit } from './auditApi';
import type { ReviewStatus } from './reviewApi';

/*
 * SME 배정 관리(§6-3 ⓐ · R6 "직무별 최소 인원의 업무전문가(SME, 1~2명)")의 데이터 계층.
 * 화면(JSX)은 src/pages/AssignmentAdminPage.tsx 에 있고 이 파일에는 없다.
 *
 * ── 왜 이 파일이 생겼나 ──
 * sync_sme_assignments(supabase/APPLY_2026-08-28.sql)는 SME 계정을 만들 때마다 그 회사의
 * 활성 직무 "전부"를 배정한다. Phase 5의 link_sme_roster가 명부로 특정 직무를 더하는 경로를
 * 만들었지만 내리는 경로가 없어, 직무 하나에 SME가 회사 인원만큼 붙어도 R6을 지킬 방법이 없었다.
 * 이 파일이 그 "내리는" 쪽이다.
 *
 * ── 규약 ──
 * adminApi.ts와 같다. 실패를 던지지 않고 ApiResult<T>(ok/error)로 돌려준다.
 * 조회 실패를 "0건"으로 위장하지 않기 위해 화면이 `if (r.ok)` 분기를 반드시 지나게 한다.
 *
 * ── 해제는 삭제가 아니다 ──
 * review_assignments 행을 지우면 reviews.assignment_id FK가 딸려 있어 삭제가 실패하거나
 * (연쇄 삭제를 열어 두었다면) 이미 작성한 응답이 함께 사라진다. 그래서 해제는 전부
 * active = false 다. 기존 조회들이 모두 .eq('active', true)로 거르므로 내려간 배정은
 * SME 화면·진행 매트릭스·제출 큐·Export에서 함께 빠진다.
 *
 * ── 쿼리 수와 페이지 ──
 * fetchAssignments가 읽는 것은 3종이다(직무 목록 + 배정·프로필·검토 + SME 후보). 배정 한 번에
 * profiles·reviews를 embed 해 오고 묶기는 브라우저에서 한다(adminApi.fetchProgressMatrix와 같은 방식).
 * 다만 왕복 횟수는 "3회 고정"이 아니라 가져온 행 수에 비례한다. PostgREST는 한 응답의 행 수에
 * 상한(db-max-rows, Supabase 기본 1,000)을 걸고 **잘린 응답을 오류 없이** 돌려주기 때문이다.
 * 이 화면이 읽는 배정 행 수는 (활성 직무 수 × 회사 SME 수)로 곱해진다 — sync_sme_assignments가
 * 계정마다 그 회사의 전 직무를 배정한다. 직무 40 × SME 25 = 1,000이면 그때부터 응답이 조용히 잘리고,
 * 잘려 나간 직무는 SME가 실제로 붙어 있어도 "미배정 · SME 0명"이라는 거짓 R6 판정으로 그려진다.
 * 그래서 배정·SME 후보는 fetchAllPages로 끝까지 읽는다(exportApi.ts의 fetchAll과 같은 규칙·같은 이유).
 */

/** 화면이 import 두 줄을 쓰지 않도록 결과 타입을 여기서 다시 내보낸다. 정의는 jobApi.ts에 있다. */
export type { ApiResult } from './jobApi';

// ── 내부 헬퍼 (adminApi.ts와 같은 형태) ─────────────────────────────

type Row = Record<string, unknown>;

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** PostgREST가 1:1 관계를 객체로 줄 때와 배열로 줄 때를 모두 받아 준다. */
function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row) || {};
  return (value as Row) || {};
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[assignmentApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

/** 서버에 보내기 전에 클라이언트가 먼저 막는 입력·상태 오류. 화면이 그대로 띄운다. */
function invalid<T>(message: string): ApiResult<T> {
  return { ok: false, error: message };
}

const byKorean = (a: string, b: string) => a.localeCompare(b, 'ko');

// ── 페이지 나눔 ─────────────────────────────────────────────────────

/** 한 번에 읽는 행 수. PostgREST db-max-rows의 Supabase 기본값과 같다(exportApi.ts의 PAGE와 같은 값). */
const PAGE = 1000;

/** fetchAllPages가 요구하는 최소 모양. supabase-js의 쿼리 빌더가 구조적으로 여기에 들어맞는다. */
interface Pageable {
  order(column: string, options: { ascending: boolean }): Pageable;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * 조회를 끝까지 읽는다. 파일 머리 「쿼리 수와 페이지」의 이유로, 이 화면의 조회는 한 번에 다 오지 않는다.
 *
 * build()는 부를 때마다 새 빌더를 만들어야 한다(supabase-js 빌더는 한 번 await 하면 재사용할 수 없다).
 * 정렬을 여기서 강제하는 이유는 exportApi.ts의 PAGE_ORDER_KEY 주석과 같다 — 정렬 없는 range()의
 * 행 순서는 보장되지 않아 같은 행이 두 페이지에 오거나(중복) 어느 페이지에도 안 온다(누락).
 * 표시 순서를 따로 걸어 둔 조회는 그 정렬이 먼저 오고 여기서 붙는 id가 동률만 가르는 2차 키가 된다.
 */
async function fetchAllPages(what: string, build: () => Pageable): Promise<ApiResult<Row[]>> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build()
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return fail(what, error.message);
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    // 마지막 장은 PAGE보다 짧다. 정확히 PAGE면 한 장 더 확인한다(빈 응답으로 끝난다).
    if (rows.length < PAGE) return ok(out);
  }
}

// ── 해제 안전장치 ───────────────────────────────────────────────────

export interface AssignmentGuard {
  /** 해제를 막는 사유. null이면 해제할 수 있다. 화면은 이 문장을 그대로 보여 준다. */
  blocked: string | null;
  /** 해제 전에 한 번 더 확인받을 사유. null이면 확인 없이 해제한다. */
  warning: string | null;
}

export interface AssignmentGuardInput {
  status: CellStatus;
  submittedAt: string | null;
  lastSavedAt: string | null;
}

/**
 * 배정 해제를 막을지·경고할지 판정한다. 순수 함수라 화면과 deactivateAssignment가 같은 규칙을 쓴다
 * (화면에서만 판정하면 목록을 띄워 둔 사이에 SME가 제출한 배정을 그대로 내릴 수 있다).
 *
 * 막는 기준을 status가 아니라 submitted_at으로 보는 이유: 반려된 검토는 status가
 * REVIEW_REQUESTED로 돌아가지만 제출 시각과 응답 원본은 그대로 남는다(decide_review 주석 참조).
 * status만 보면 "한 번 제출했다가 반려된" 응답을 아무 경고 없이 화면에서 지우게 된다.
 */
export function assignmentGuardOf(input: AssignmentGuardInput): AssignmentGuard {
  if (input.submittedAt) {
    return {
      blocked:
        '이미 제출된 응답이 있어 배정을 해제할 수 없습니다. 해제하면 제출된 응답이 관리자 화면과 산출물(E1·E2)에서 함께 빠져 집계가 어긋납니다. 이 SME를 대상에서 빼야 한다면 제출된 응답을 어떻게 처리할지 먼저 정해 주세요.',
      warning: null,
    };
  }
  if (input.status !== 'NOT_STARTED' || input.lastSavedAt) {
    return {
      blocked: null,
      warning:
        '이미 작성을 시작한 검토입니다. 해제하면 SME 화면에서 이 직무가 사라지고, 작성 중이던 내용은 제출되지 않은 채 관리자 화면에서도 보이지 않게 됩니다.',
    };
  }
  return { blocked: null, warning: null };
}

// ── 조회 ────────────────────────────────────────────────────────────

/** 직무 하나에 배정된 SME 한 명. */
export interface AssignedSme {
  assignmentId: string;
  smeId: string;
  name: string;
  organization: string;
  title: string;
  /** 검토 진행 상태. 검토 행이 아직 없으면 NOT_STARTED다(SME가 화면을 열 때 만들어진다). */
  status: CellStatus;
  submittedAt: string | null;
  lastSavedAt: string | null;
  /** 해제 가능 여부. blocked가 있으면 버튼을 잠그고 사유를 보여 준다. */
  guard: AssignmentGuard;
}

/** 배정 화면의 한 행 = 직무 하나. */
export interface JobAssignmentRow {
  jobId: string;
  jobName: string;
  /** 직군. */
  groupName: string;
  /** 직렬. */
  seriesName: string;
  companyId: string | null;
  companyName: string;
  /** 이 직무에 배정된(active) SME. 이름 순. */
  smes: AssignedSme[];
}

/** 배정을 더할 수 있는 SME 후보. 비활성 계정은 로그인할 수 없으므로 목록에 넣지 않는다. */
export interface SmeCandidate {
  id: string;
  name: string;
  organization: string;
  title: string;
  companyId: string | null;
}

export interface AssignmentBoard {
  /** 활성 직무 전체. 배정이 0명인 직무도 남긴다 — R6 위반 중 가장 심한 "미배정"을 감추지 않기 위해서다. */
  jobs: JobAssignmentRow[];
  /** 회사 범위 안의 활성 SME. 화면이 여기서 추가 대상을 고른다. */
  smes: SmeCandidate[];
}

/**
 * 직무별 배정 현황과 추가 후보 SME. 조회 3종(직무 목록 + 배정 + SME 후보)이고, 왕복 횟수는
 * 가져온 행 수에 비례한다(파일 머리 「쿼리 수와 페이지」).
 *
 * 열(직무)을 배정과 따로 조회한다. 배정 행에서만 직무를 만들면 아무도 배정되지 않은 직무가
 * 목록에서 통째로 사라져, 이 화면이 맡은 R6 점검 중 "0명"을 영영 볼 수 없다
 * (adminApi.fetchProgressMatrix가 열을 따로 가져오는 것과 같은 이유다).
 */
export async function fetchAssignments(companyId?: string | null): Promise<ApiResult<AssignmentBoard>> {
  if (!supabase) return fail('배정 현황 조회', NO_DB);
  const db = supabase;

  const jobList = await fetchAllJobsResult(companyId);
  if (!jobList.ok) return jobList;
  // 직무 목록(jobApi.fetchAllJobsResult)은 아직 페이지를 나누지 않는다. 그 함수는 이 화면 밖에서도
  // 쓰이므로 여기서 고치지 않았고(OPEN_ISSUES 「남은 작업」), 대신 잘렸을 수 있는 응답을 그대로
  // 그리지 않는다. 행 수가 상한에 딱 맞아떨어지면 "정확히 그만큼"인지 "잘린 것"인지 구분할 수 없다 —
  // 그 상태로 목록을 그리면 빠진 직무가 화면에서 통째로 사라진다. 0건으로 위장하지 않고 실패로 알린다.
  if (jobList.data.length > 0 && jobList.data.length % PAGE === 0) {
    return invalid(
      '직무가 많아 목록의 일부만 조회됐을 수 있습니다. 위에서 계열사를 골라 범위를 좁힌 뒤 다시 시도해 주세요.',
    );
  }

  // 빌더는 한 번 await 하면 재사용할 수 없어, 페이지마다 새로 만들도록 함수로 감싼다.
  const buildAssignments = () => {
    const q = db
      .from('review_assignments')
      .select(
        `
      id, sme_id, job_id,
      profiles!inner(id, name, organization, title),
      jobs!inner(id, company_id, active),
      reviews(id, status, submitted_at, last_saved_at, approved_at)
    `,
      )
      .eq('active', true)
      .eq('jobs.active', true);
    return companyId ? q.eq('jobs.company_id', companyId) : q;
  };

  const buildSmes = () => {
    const q = db
      .from('profiles')
      .select('id, name, organization, title, company_id')
      .eq('role', 'sme')
      .eq('active', true);
    return (companyId ? q.eq('company_id', companyId) : q).order('name');
  };

  const [assignments, smes] = await Promise.all([
    fetchAllPages('배정 현황 조회', buildAssignments),
    fetchAllPages('SME 목록 조회', buildSmes),
  ]);
  if (!assignments.ok) return assignments;
  if (!smes.ok) return smes;

  const byJob = new Map<string, AssignedSme[]>();
  for (const raw of assignments.data) {
    const r = raw as Row;
    const profile = one(r.profiles);
    const review = one(r.reviews);
    const jobId = str(r.job_id);
    if (!jobId) continue;
    const submittedAt = strOrNull(review.submitted_at);
    const lastSavedAt = strOrNull(review.last_saved_at);
    const status = cellStatusOf(
      (strOrNull(review.status) as ReviewStatus | null) ?? null,
      strOrNull(review.approved_at),
    );
    const list = byJob.get(jobId) ?? [];
    list.push({
      assignmentId: str(r.id),
      smeId: str(profile.id) || str(r.sme_id),
      name: str(profile.name),
      organization: str(profile.organization),
      title: str(profile.title),
      status,
      submittedAt,
      lastSavedAt,
      guard: assignmentGuardOf({ status, submittedAt, lastSavedAt }),
    });
    byJob.set(jobId, list);
  }
  for (const list of byJob.values()) list.sort((a, b) => byKorean(a.name, b.name));

  const jobs: JobAssignmentRow[] = jobList.data
    .map((j) => ({
      jobId: j.id,
      jobName: j.name,
      groupName: j.group_name,
      seriesName: j.series_name,
      companyId: j.company_id,
      companyName: j.company_name,
      smes: byJob.get(j.id) ?? [],
    }))
    // 직군 → 직렬 → 직무 순. 같은 직군의 직무가 한자리에 모여야 배정 편중이 눈에 들어온다.
    .sort(
      (a, b) =>
        byKorean(a.groupName, b.groupName) ||
        byKorean(a.seriesName, b.seriesName) ||
        byKorean(a.jobName, b.jobName),
    );

  return ok({
    jobs,
    smes: smes.data.map((raw) => {
      const p = raw as Row;
      return {
        id: str(p.id),
        name: str(p.name),
        organization: str(p.organization),
        title: str(p.title),
        companyId: strOrNull(p.company_id),
      };
    }),
  });
}

// ── 쓰기 ────────────────────────────────────────────────────────────

/**
 * 배정 추가. 같은 (SME, 직무) 배정이 내려가 있으면 다시 올린다.
 *
 * upsert를 쓰는 이유는 두 가지다. ① review_assignments에 unique(sme_id, job_id)가 있어
 * 단순 insert는 "이미 내려 둔 배정"에서 중복 오류로 죽는다. ② 관리자가 실수로 내린 배정을
 * 되살릴 경로가 이 화면 말고는 없다(link_sme_roster는 의도적으로 되살리지 않는다).
 * created_by는 되살릴 때 지금 관리자로 덮인다 — 배정을 다시 세운 사람이 기록으로 남는 편이 맞다.
 *
 * reviews 행은 만들지 않는다. SME가 검토 화면을 처음 열 때 reviewApi.getOrCreateReview가 만들며,
 * 배정만 있고 검토 행이 없는 상태는 관리자 화면들이 이미 '미시작'으로 세고 있다.
 */
export async function addAssignment(smeId: string, jobId: string): Promise<ApiResult<string>> {
  if (!supabase) return fail('배정 추가', NO_DB);
  if (!smeId || !jobId) return invalid('추가할 SME와 직무를 모두 골라 주세요.');

  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('review_assignments')
    .upsert(
      { sme_id: smeId, job_id: jobId, active: true, created_by: auth.user?.id ?? null },
      { onConflict: 'sme_id,job_id' },
    )
    .select('id')
    .maybeSingle();
  if (error) return fail('배정 추가', error.message);

  const assignmentId = str((data as Row | null)?.id);
  if (!assignmentId) {
    // RLS(assignments_admin_insert)가 막으면 오류 없이 0행이 돌아온다. 성공으로 보이면 안 된다.
    return invalid('배정을 추가하지 못했습니다. 관리자 권한으로 로그인했는지 확인한 뒤 다시 시도해 주세요.');
  }

  // 감사 로그 meta에는 이름·이메일을 넣지 않는다(mailApi·edgeApi와 같은 규칙). id만 남긴다.
  await logAudit('ASSIGNMENT_ADDED', 'review_assignments', assignmentId, { sme_id: smeId, job_id: jobId });
  return ok(assignmentId);
}

/**
 * 배정 해제 — 행을 지우지 않고 active = false 로 내린다.
 *
 * 해제 직전에 검토 상태를 다시 읽는다. 화면이 목록을 띄워 둔 사이에 SME가 제출했을 수 있고,
 * 그 상태에서 내리면 제출된 응답이 관리자 화면·산출물에서 조용히 사라진다.
 *
 * 다만 이 조회와 아래 UPDATE 사이도 무방비다 — 마지막 방어선은 서버에 있다.
 * review_assignments_guard_deactivate 트리거(supabase/migrations/20260902030000_...sql)가
 * 제출된 응답이 있는 배정의 해제를 42501로 거절하고, submit_review는 해제된 배정으로 들어온
 * 제출을 거부한다. 여기 판정은 그 전에 사유 문구를 보여 주고 화면과 API가 같은 규칙을 쓰게 한다.
 */
export async function deactivateAssignment(assignmentId: string): Promise<ApiResult<void>> {
  if (!supabase) return fail('배정 해제', NO_DB);
  if (!assignmentId) return invalid('해제할 배정을 찾지 못했습니다. 목록을 새로 고친 뒤 다시 시도해 주세요.');

  const { data, error } = await supabase
    .from('review_assignments')
    .select('id, sme_id, job_id, active, reviews(status, submitted_at, last_saved_at, approved_at)')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) return fail('배정 해제', error.message);
  if (!data) return invalid('해제할 배정을 찾지 못했습니다. 목록을 새로 고친 뒤 다시 시도해 주세요.');

  const row = data as Row;
  const review = one(row.reviews);
  const status = cellStatusOf(
    (strOrNull(review.status) as ReviewStatus | null) ?? null,
    strOrNull(review.approved_at),
  );
  const guard = assignmentGuardOf({
    status,
    submittedAt: strOrNull(review.submitted_at),
    lastSavedAt: strOrNull(review.last_saved_at),
  });
  if (guard.blocked) return invalid(guard.blocked);

  const { data: updated, error: updateError } = await supabase
    .from('review_assignments')
    .update({ active: false })
    .eq('id', assignmentId)
    .select('id');
  if (updateError) return fail('배정 해제', updateError.message);
  if (!updated || updated.length === 0) {
    // RLS(assignments_admin_update)가 막으면 오류 없이 0행이다. "해제됨"으로 보여 주지 않는다.
    return invalid('배정을 해제하지 못했습니다. 관리자 권한으로 로그인했는지 확인한 뒤 다시 시도해 주세요.');
  }

  await logAudit('ASSIGNMENT_DEACTIVATED', 'review_assignments', assignmentId, {
    sme_id: str(row.sme_id),
    job_id: str(row.job_id),
    review_status: status,
  });
  return ok(undefined);
}
