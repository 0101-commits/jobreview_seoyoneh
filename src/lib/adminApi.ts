import { supabase } from './supabase';
import { fetchAllJobsResult, type ApiResult } from './jobApi';
import { fetchJobReviewFeedback, type ReviewStatus, type SmeReviewFeedback, type Suitability } from './reviewApi';
import type { FteTargetType, InquiryStatus } from './surveyApi';
import { SIGNAL_LABELS, WORKSHOP_REASONS, WORKSHOP_THRESHOLDS } from './workshopThresholds';

/*
 * 관리자 운영·검토 화면군(§6-3 ⓐⓑⓒ)이 공유하는 데이터 계층. 화면(JSX)은 이 파일에 없다.
 *
 * ── 규약: 실패를 던지지 않고 jobApi.ts의 ApiResult<T>(ok/error)로 돌려준다 ──
 * reviewApi.ts처럼 throw 하는 선택지도 있었지만 여기서는 ApiResult로 통일했다. 이유는 세 가지다.
 *   ① 이 파일 위에 관리자 화면 4개가 동시에 올라간다. throw 규약에서는 한 화면이 try/catch를
 *      하나 빠뜨리면 그 화면이 통째로 흰 화면이 된다. ApiResult는 타입 검사가 `if (r.ok)` 분기를
 *      강제하므로, "데이터 없음"과 "불러오지 못함"의 구분(jobApi.ts 상단 원칙)을 컴파일러가 지켜 준다.
 *   ② 관리자 화면은 한 화면에서 여러 조회를 동시에 띄운다(대시보드 4지표, 매트릭스+트리).
 *      일부만 실패했을 때 성공한 부분은 그대로 보여주고 실패한 칸에만 "불러오지 못했습니다"를
 *      띄우려면 실패가 값이어야 한다. 예외는 그 지점에서 나머지 조회를 함께 끊는다.
 *   ③ 관리자 화면이 이미 쓰고 있는 조회(fetchReviewStatusResult · fetchAllJobsResult ·
 *      fetchCompaniesResult)가 전부 ApiResult다. 같은 화면 안에서 두 규약이 섞이지 않는다.
 * 파일 안에서 섞지 않는다. 조회도 쓰기도 전부 ApiResult다.
 *
 * 유일한 규약 경계는 fetchJobComparison이 재사용하는 reviewApi.fetchJobReviewFeedback 한 곳이다.
 * 그 함수는 throw 규약이라 이 파일에서 try/catch로 받아 ApiResult로 바꾼다. 경계는 거기 한 곳뿐이다.
 *
 * ── 쿼리 수 ──
 * reviewApi.fetchJobReviewFeedback의 "쿼리 6회, SME 수와 무관"이 이 저장소의 기준이다.
 * 이 파일의 모든 함수도 쿼리 수가 SME 수·직무 수·조직 수에 비례하지 않는다(각 함수 주석에 회수를 적었다).
 */

/** 화면이 import 두 줄을 쓰지 않도록 결과 타입을 여기서 다시 내보낸다. 정의는 jobApi.ts에 있다. */
export type { ApiResult } from './jobApi';

// ── 내부 헬퍼 ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));

/** PostgREST가 1:1 관계를 객체로 줄 때와 배열로 줄 때를 모두 받아 준다(reviewApi.ts와 같은 헬퍼). */
function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row) || {};
  return (value as Row) || {};
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/**
 * 조회·쓰기 실패. 화면이 그대로 띄울 수 있도록 "무엇이" 실패했는지까지 문구에 담는다
 * (reviewApi.fail과 같은 형태 — 원인 메시지만 주면 화면마다 앞말을 따로 붙이게 된다).
 */
function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[adminApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

/** 서버에 보내기 전에 클라이언트가 먼저 막는 입력 오류. 서버 문구와 같은 말을 쓴다. */
function invalid<T>(message: string): ApiResult<T> {
  return { ok: false, error: message };
}

/** 로그인한 관리자 id. decided_by·answered_by 기록용이라 못 얻어도 저장 자체는 진행한다. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const byKorean = (a: string, b: string) => a.localeCompare(b, 'ko');

/** 오늘 자정(로컬)을 UTC 밀리초로. 두 함수가 같은 기준으로 날짜를 세게 한다. */
function todayLocal(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * 'YYYY-MM-DD'까지 남은 날짜 수. 오늘이면 0, 지났으면 음수. 형식이 다르면 null.
 * survey_settings.due_date처럼 시간대가 없는 date 컬럼 전용이다 — 시각이 붙은 값에는 daysSince를 쓴다.
 */
function daysUntil(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target - todayLocal()) / 86400000);
}

/**
 * 그날부터 오늘까지 지난 날짜 수(경과일). 못 읽으면 null.
 *
 * inquiries.created_at은 timestamptz라 '…T23:00:00+00:00' 같은 UTC 시각으로 온다.
 * 문자열 앞 10자를 자르면 UTC 날짜가 나오는데 비교 대상인 '오늘'은 로컬(KST) 달력이라,
 * 그대로 빼면 KST 00:00~09:00 접수분이 하루 더 지난 것으로 나온다(오늘 접수가 '미답 1일 경과').
 * 그래서 자르지 않고 시각을 파싱해 로컬 달력 날짜로 환산한 뒤 뺀다.
 */
function daysSince(timestamp: string): number | null {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const then = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((todayLocal() - then) / 86400000);
}

// ────────────────────────────────────────────────────────────────────
// 1. 조직 트리 (§6-3 ⓐ 진행 매트릭스의 행)
// ────────────────────────────────────────────────────────────────────

export interface OrgUnit {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  active: boolean;
}

/** 트리 노드. depth는 0부터(들여쓰기용). */
export interface OrgNode extends OrgUnit {
  children: OrgNode[];
  depth: number;
}

/**
 * parent_id가 가리키는 부모가 목록에 없거나(고아), 자기 자신이거나, 부모를 따라 올라가다
 * 자기에게 돌아오면(순환) 그 노드를 뿌리로 올린다. 업로드 실수 한 줄 때문에 그 아래 조직이
 * 통째로 사라지거나 렌더링이 무한히 도는 것을 막는다 — 데이터를 감추지 않고 위치만 바꾼다.
 */
export function buildOrgTree(units: OrgUnit[]): OrgNode[] {
  const byId = new Map<string, OrgNode>();
  for (const u of units) byId.set(u.id, { ...u, children: [], depth: 0 });

  const isAncestorOfSelf = (node: OrgNode, parent: OrgNode): boolean => {
    const seen = new Set<string>([node.id]);
    let cur: OrgNode | undefined = parent;
    while (cur) {
      if (seen.has(cur.id)) return true; // node로 되돌아왔거나, 부모들 사이에 이미 순환이 있다
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  const roots: OrgNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent.id === node.id || isAncestorOfSelf(node, parent)) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const walk = (node: OrgNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => byKorean(a.name, b.name));
    for (const child of node.children) walk(child, depth + 1);
  };
  roots.sort((a, b) => byKorean(a.name, b.name));
  for (const root of roots) walk(root, 0);
  return roots;
}

/** 트리를 화면 행 순서(부모 → 자식)로 편다. 진행 매트릭스의 행 순서가 이것이다. */
export function flattenOrgTree(roots: OrgNode[]): OrgNode[] {
  const out: OrgNode[] = [];
  const walk = (node: OrgNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/**
 * 조직 트리. 진행 매트릭스(§6-3 ⓐ)의 행과 조직 선택 UI가 쓴다.
 * 쿼리 1회. active=false 조직도 함께 준다 — 숨기면 그 조직 소속 SME의 응답이 화면에서 사라진다.
 * 화면이 active를 보고 회색 처리하거나 접으면 된다.
 */
export async function fetchOrgTree(companyId?: string | null): Promise<ApiResult<OrgNode[]>> {
  if (!supabase) return fail('조직 트리 조회', NO_DB);
  let query = supabase.from('org_units').select('id, parent_id, code, name, active').order('name');
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  if (error) return fail('조직 트리 조회', error.message);

  const units: OrgUnit[] = (data || []).map((raw) => {
    const r = raw as Row;
    return {
      id: str(r.id),
      parentId: str(r.parent_id) || null,
      code: str(r.code),
      name: str(r.name),
      active: r.active !== false,
    };
  });
  return ok(buildOrgTree(units));
}

// ────────────────────────────────────────────────────────────────────
// 2. 진행 매트릭스 (§6-3 ⓐ)
// ────────────────────────────────────────────────────────────────────

/** 셀 상태. §6-3 ⓐ의 "미시작/작성 중/제출/승인/반려" 그대로다. */
export type CellStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** 색만으로 상태를 알리지 않기 위해 화면이 함께 쓰는 한국어 라벨(§6-3 ⓐ 문언). */
export const CELL_STATUS_LABELS: Record<CellStatus, string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '작성 중',
  SUBMITTED: '제출',
  APPROVED: '승인',
  REJECTED: '반려',
};

export type StatusCounts = Record<CellStatus, number>;

const emptyCounts = (): StatusCounts => ({
  NOT_STARTED: 0,
  IN_PROGRESS: 0,
  SUBMITTED: 0,
  APPROVED: 0,
  REJECTED: 0,
});

/**
 * 검토 한 건의 셀 상태.
 * 승인은 별도 status가 아니라 reviews.approved_at으로 표현된다(20260901030000 주석 참조).
 * 반려는 status='REVIEW_REQUESTED'이며, 이때 approved_at은 서버가 비운다.
 */
export function cellStatusOf(status: ReviewStatus | null, approvedAt: string | null): CellStatus {
  if (approvedAt) return 'APPROVED';
  if (status === 'REVIEW_REQUESTED') return 'REJECTED';
  if (status === 'SUBMITTED' || status === 'RESUBMITTED') return 'SUBMITTED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** 조직 × 직무 한 칸. */
export interface ProgressCell {
  jobId: string;
  jobName: string;
  orgUnitId: string | null;
  orgName: string;
  /** 이 칸에 배정된 SME 수. R6(직무별 1~2명) 준수 여부 점검용이다. */
  assignedSme: number;
  counts: StatusCounts;
  /** 이 칸에서 가장 최근 저장 시각. 아무도 손대지 않았으면 null. */
  lastSavedAt: string | null;
  /** 셀 클릭 → 검토로 이동(§6-3 ⓐ). 화면이 이 목록으로 이동 대상을 고른다. */
  reviews: ProgressCellReview[];
}

export interface ProgressCellReview {
  reviewId: string | null;
  smeId: string;
  smeName: string;
  status: CellStatus;
}

export interface ProgressRow {
  orgUnitId: string | null;
  orgName: string;
  depth: number;
}

export interface ProgressMatrix {
  /** 행 렌더링용 트리(들여쓰기·접기). rows와 같은 조직을 가리킨다. */
  orgRoots: OrgNode[];
  /** 행. 트리 순서 → 트리에 없는 조직 → 마지막에 "조직 미지정". */
  rows: ProgressRow[];
  /** 열. 이름 순. */
  jobs: { id: string; name: string }[];
  /** 셀. 키는 progressCellKey(orgUnitId, jobId). 배정이 없는 칸은 아예 없다. */
  cells: Map<string, ProgressCell>;
}

export function progressCellKey(orgUnitId: string | null, jobId: string): string {
  return `${orgUnitId ?? ''}::${jobId}`;
}

/** profiles.org_unit_id가 비어 있는 SME를 모으는 행(§6-3 ⓐ). 감추지 않고 한 행으로 보여 준다. */
export const UNASSIGNED_ORG_LABEL = '조직 미지정';
/** 다른 계열사 조직처럼 이번 조회 범위에서 이름을 찾지 못한 org_unit_id. */
export const UNKNOWN_ORG_LABEL = '알 수 없는 조직';

/**
 * 진행 매트릭스(§6-3 ⓐ). 행=조직, 열=직무, 셀=상태 집계.
 * 쿼리 3회(조직 트리 1 + 직무 목록 1 + 배정·프로필·직무·검토 1). SME 수·직무 수와 무관하다 —
 * 배정 한 번에 profiles·jobs·reviews를 함께 embed 해서 가져오고 집계는 브라우저에서 한다.
 *
 * 조직은 profiles.org_unit_id 기준이다. 아직 비어 있는 계정이 많으므로 org_unit_id가 없는 SME는
 * "조직 미지정" 행으로 모은다. 배정이 하나도 없는 조직도 행으로 남긴다(빈 조직을 숨기려면 화면이 접는다).
 *
 * 열도 같은 이유로 배정과 따로 조회한다. 배정 행에서만 열을 만들면 SME가 한 명도 배정되지 않은
 * 직무는 표에 아예 나타나지 않아, §6-3 ⓐ가 이 화면에 맡긴 R6(직무별 1~2명) 점검 중 가장 심한
 * 위반인 "배정 0명"을 영영 볼 수 없다. 그 칸은 셀이 없으므로 화면에서 '–'로 그려진다.
 */
export async function fetchProgressMatrix(companyId?: string | null): Promise<ApiResult<ProgressMatrix>> {
  if (!supabase) return fail('진행 현황 조회', NO_DB);

  const [tree, jobList] = await Promise.all([fetchOrgTree(companyId), fetchAllJobsResult(companyId)]);
  if (!tree.ok) return tree;
  if (!jobList.ok) return jobList;

  let query = supabase
    .from('review_assignments')
    .select(
      `
      id, sme_id, job_id,
      profiles!inner(id, name, org_unit_id),
      jobs!inner(id, name, company_id, active),
      reviews(id, status, last_saved_at, approved_at)
    `,
    )
    .eq('active', true)
    .eq('jobs.active', true);
  if (companyId) query = query.eq('jobs.company_id', companyId);

  const { data, error } = await query;
  if (error) return fail('진행 현황 조회', error.message);

  const orgNodes = flattenOrgTree(tree.data);
  const orgNameById = new Map(orgNodes.map((n) => [n.id, n.name]));

  const cells = new Map<string, ProgressCell>();
  /** 열은 활성 직무 전체다. 배정이 있는 직무만 담으면 "배정 0명"이 화면에서 사라진다. */
  const jobs = new Map<string, string>(jobList.data.map((j) => [j.id, j.name]));
  /** 트리에 없는 org_unit_id도 행으로 남긴다. 값이 있는데 화면에서 사라지는 편이 더 위험하다. */
  const extraOrgIds = new Set<string>();
  let hasUnassigned = false;

  for (const raw of data || []) {
    const r = raw as Row;
    const profile = one(r.profiles);
    const job = one(r.jobs);
    const review = one(r.reviews);

    const jobId = str(job.id) || str(r.job_id);
    if (!jobId) continue;
    jobs.set(jobId, str(job.name));

    const orgUnitId = str(profile.org_unit_id) || null;
    if (!orgUnitId) hasUnassigned = true;
    else if (!orgNameById.has(orgUnitId)) extraOrgIds.add(orgUnitId);

    const key = progressCellKey(orgUnitId, jobId);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        jobId,
        jobName: str(job.name),
        orgUnitId,
        orgName: orgUnitId ? orgNameById.get(orgUnitId) ?? UNKNOWN_ORG_LABEL : UNASSIGNED_ORG_LABEL,
        assignedSme: 0,
        counts: emptyCounts(),
        lastSavedAt: null,
        reviews: [],
      };
      cells.set(key, cell);
    }

    const status = cellStatusOf((str(review.status) as ReviewStatus) || null, str(review.approved_at) || null);
    cell.assignedSme += 1;
    cell.counts[status] += 1;
    cell.reviews.push({
      reviewId: str(review.id) || null,
      smeId: str(profile.id) || str(r.sme_id),
      smeName: str(profile.name),
      status,
    });

    const savedAt = str(review.last_saved_at);
    if (savedAt && (!cell.lastSavedAt || savedAt > cell.lastSavedAt)) cell.lastSavedAt = savedAt;
  }

  const rows: ProgressRow[] = orgNodes.map((n) => ({ orgUnitId: n.id, orgName: n.name, depth: n.depth }));
  for (const id of [...extraOrgIds].sort()) {
    rows.push({ orgUnitId: id, orgName: UNKNOWN_ORG_LABEL, depth: 0 });
  }
  if (hasUnassigned) rows.push({ orgUnitId: null, orgName: UNASSIGNED_ORG_LABEL, depth: 0 });

  return ok({
    orgRoots: tree.data,
    rows,
    jobs: [...jobs.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => byKorean(a.name, b.name)),
    cells,
  });
}

// ────────────────────────────────────────────────────────────────────
// 3. 이견 신호·워크숍 자동 규칙 (§6-3 ⓑ) — 제출 큐와 비교 뷰가 함께 쓰는 계산
// ────────────────────────────────────────────────────────────────────

/*
 * 제출 큐의 "이견 신호 배지 수"와 비교 뷰의 하이라이트는 같은 수여야 한다.
 * 두 곳에서 따로 세면 목록에는 2건인데 열어 보면 3건인 화면이 나온다.
 * 그래서 계산은 이 순수 함수 하나에만 둔다. 조회 함수는 입력을 모아 주기만 한다.
 */

/**
 * 신호 계산에 넣을 "제출된" 검토인가. 제출 큐와 비교 뷰가 반드시 같은 답을 내야 하므로
 * 판정은 이 함수 하나뿐이다 — 계산(computeJobSignals)을 한곳에 모아도 입력 집합이 갈리면
 * 목록에는 2건인데 열어 보면 3건인 화면이 그대로 나온다.
 *
 * submitted_at은 보지 않는다. decide_review·request_rereview는 반려해도 submitted_at을
 * 지우지 않으므로(20260901030000 "submitted_at 은 지우지 않는다") 그 값으로 거르면
 * 반려되어 지금 SME가 다시 편집 중인 초안이 제출본으로 비교에 섞인다.
 */
export function isComparableReview(status: ReviewStatus | null): boolean {
  return status === 'SUBMITTED' || status === 'RESUBMITTED';
}

export type JobSignalKind = 'SUITABILITY' | 'FTE_GAP' | 'NEW_TASK';

export interface JobSignal {
  kind: JobSignalKind;
  /** 비교 뷰에서 하이라이트할 행 키. 'job:NAME' · 'task:<id>' · 'skill:<id>' · 'new:<이름>'. */
  key: string;
  /** 행 이름(과업명 등). 목록 화면이 배지 옆에 그대로 쓴다. */
  name: string;
  label: string;
}

/** computeJobSignals의 입력. 조회 함수가 raw 행을 이 모양으로 정리해서 넘긴다. */
export interface JobSignalInput {
  /** 이 직무의 "제출된" 검토 id. 신호는 제출된 응답끼리만 비교한다(작성 중 초안 비교는 잡음이다). */
  reviewIds: string[];
  /** 적합성 판정. key = 'job:NAME' · 'task:<id>' · 'skill:<id>'. */
  suitability: { key: string; name: string; reviewId: string; value: Suitability | null }[];
  /** FTE 배분. key = 'task:<id>'(기존) · 'new:<이름>'(신규 제안). */
  fte: { key: string; name: string; targetType: FteTargetType; reviewId: string; pct: number }[];
  /** 신규 제안 Task 이름(검토별). 같은 이름은 자동 규칙 ③에서 1건으로 센다. */
  newTasks: { reviewId: string; name: string }[];
}

/** 비교 뷰의 FTE 행 하나(그림 6-B의 한 줄). */
export interface FteRow {
  key: string;
  name: string;
  targetType: FteTargetType;
  /**
   * reviewId → 비중. null은 두 경우다 — 신규 제안인데 그 SME가 제안하지 않았거나("－ 미제안"),
   * 그 SME가 FTE를 한 줄도 내지 않았거나("－ 미응답"). 둘 다 0%와 구분해야 한다.
   */
  pct: Record<string, number | null>;
  /** 응답 간 최대 비중 차(%p). */
  maxGap: number;
  /** maxGap ≥ WORKSHOP_THRESHOLDS.ftePointGap. */
  gapFlagged: boolean;
  /** 신규 제안인데 일부 SME만 제안한 행. */
  proposalMismatch: boolean;
}

export interface JobSignalResult {
  smeCount: number;
  fteRows: FteRow[];
  /** reviewId → 1위 과업 키. 배분이 하나도 없으면 null. */
  topTaskByReview: Record<string, string | null>;
  /** 자동 규칙 ② — SME 간 FTE 1위 과업 불일치. */
  topTaskMismatch: boolean;
  /** 자동 규칙 ① 분자/분모. 판정이 하나도 없으면 0. */
  unsuitableRatio: number;
  /** 자동 규칙 ③ — 이름이 다른 신규 제안 Task 수. */
  newTaskCount: number;
  /** 이견 신호(행 단위). 배지 수 = signals.length. */
  signals: JobSignal[];
  /** 자동 규칙에 지금 걸리는 사유. job_workshop_flags.reasons에 그대로 넣는다. */
  workshopReasons: string[];
}

/** 신규 제안은 SME마다 id가 다르므로 이름으로 같은 과업을 맞춘다. 공백·대소문자 차이는 무시한다. */
export function suggestionKey(name: string): string {
  return `new:${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * 이견 신호와 워크숍 자동 규칙을 한곳에서 계산한다(§6-3 ⓑ).
 *
 * 이견 신호는 "행 단위 하이라이트"만 센다 — 적합성 판정이 갈린 항목, 비중 차가 임계값 이상인 행,
 * 일부 SME만 제안한 신규 과업 행. FTE 1위 불일치는 행이 아니라 직무 전체의 성질이므로
 * 배지가 아니라 워크숍 자동 규칙 ②로만 잡는다(그림 6-B의 "이견 신호 2건"이 이 셈법이다).
 */
export function computeJobSignals(input: JobSignalInput): JobSignalResult {
  const reviewIds = input.reviewIds;
  const smeCount = reviewIds.length;
  const signals: JobSignal[] = [];

  // ── 적합성 판정 불일치 ──
  const suitabilityByKey = new Map<string, { name: string; values: Map<string, Suitability> }>();
  let judged = 0;
  let unsuitable = 0;
  for (const row of input.suitability) {
    if (!row.value) continue;
    judged += 1;
    if (row.value === 'UNSUITABLE') unsuitable += 1;
    let entry = suitabilityByKey.get(row.key);
    if (!entry) {
      entry = { name: row.name, values: new Map() };
      suitabilityByKey.set(row.key, entry);
    }
    entry.values.set(row.reviewId, row.value);
  }
  for (const [key, entry] of suitabilityByKey) {
    if (new Set(entry.values.values()).size > 1) {
      signals.push({ kind: 'SUITABILITY', key, name: entry.name, label: SIGNAL_LABELS.suitabilityMismatch });
    }
  }

  // ── FTE 행 ──
  const fteByKey = new Map<string, { name: string; targetType: FteTargetType; pct: Map<string, number> }>();
  for (const row of input.fte) {
    let entry = fteByKey.get(row.key);
    if (!entry) {
      entry = { name: row.name, targetType: row.targetType, pct: new Map() };
      fteByKey.set(row.key, entry);
    }
    // 같은 검토에 같은 대상이 두 줄일 수 없다(부분 unique 인덱스). 그래도 들어오면 큰 쪽을 남긴다.
    entry.pct.set(row.reviewId, Math.max(entry.pct.get(row.reviewId) ?? 0, row.pct));
  }

  /*
   * FTE를 한 줄도 내지 않은 검토는 FTE 비교에서 통째로 뺀다.
   * 배분 0행은 "모든 과업에 0%를 썼다"가 아니라 "FTE를 아직 답하지 않았다"이다 —
   * survey_settings.fte_required가 꺼진 회사(20260901040000 3항)와 그 플래그를 켜기 전
   * 제출분에서 실제로 생긴다. 0으로 채우면 상대가 20%p 이상 배분한 모든 행이 거짓으로
   * 하이라이트되고 그 직무가 이견 신호 수 순으로 제출 큐 맨 위에 올라간다.
   * 아래 1위 과업 계산이 배분 없는 검토를 이미 null로 빼는 것과 같은 취급이다.
   */
  const answeredFte = new Set(input.fte.map((f) => f.reviewId));
  const fteReviewCount = reviewIds.filter((id) => answeredFte.has(id)).length;

  const fteRows: FteRow[] = [];
  for (const [key, entry] of fteByKey) {
    const pct: Record<string, number | null> = {};
    const values: number[] = [];
    for (const reviewId of reviewIds) {
      const v = entry.pct.get(reviewId);
      if (v !== undefined) {
        pct[reviewId] = v;
        values.push(v);
      } else if (!answeredFte.has(reviewId)) {
        // FTE 자체를 내지 않은 응답. 0도 아니고 미제안도 아니라 비교에서 뺀다.
        pct[reviewId] = null;
      } else if (entry.targetType === 'SUGGESTED') {
        // 제안하지 않은 것과 0%를 배분한 것은 다르다. 0으로 채우면 "미제안"이 사라진다.
        pct[reviewId] = null;
      } else {
        // 확정 과업인데 배분이 없으면 "이 과업에 시간을 쓰지 않는다"는 응답이다.
        pct[reviewId] = 0;
        values.push(0);
      }
    }
    const maxGap = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    // 분모는 smeCount가 아니라 FTE를 낸 검토 수다 — 답하지 않은 사람을 "제안하지 않은 사람"으로 세지 않는다.
    const proposalMismatch =
      entry.targetType === 'SUGGESTED' &&
      fteReviewCount > 1 &&
      entry.pct.size > 0 &&
      entry.pct.size < fteReviewCount;
    const gapFlagged = maxGap >= WORKSHOP_THRESHOLDS.ftePointGap;
    fteRows.push({ key, name: entry.name, targetType: entry.targetType, pct, maxGap, gapFlagged, proposalMismatch });

    if (gapFlagged) {
      signals.push({ kind: 'FTE_GAP', key, name: entry.name, label: SIGNAL_LABELS.fteGap });
    } else if (proposalMismatch) {
      // 같은 행을 두 번 세지 않는다. 배지 수가 행 수보다 많아지면 화면과 목록이 어긋난다.
      signals.push({ kind: 'NEW_TASK', key, name: entry.name, label: SIGNAL_LABELS.newTaskMismatch });
    }
  }
  fteRows.sort((a, b) => byKorean(a.name, b.name));

  // ── FTE 1위 과업 ──
  const topTaskByReview: Record<string, string | null> = {};
  for (const reviewId of reviewIds) {
    let topKey: string | null = null;
    let topPct = -1;
    // 동점이면 키 순으로 고정한다. 새로고침할 때마다 1위가 바뀌면 근거가 되지 못한다.
    for (const key of [...fteByKey.keys()].sort()) {
      const v = fteByKey.get(key)?.pct.get(reviewId);
      if (v !== undefined && v > topPct) {
        topPct = v;
        topKey = key;
      }
    }
    topTaskByReview[reviewId] = topKey;
  }
  const topKeys = reviewIds.map((id) => topTaskByReview[id]).filter((k): k is string => !!k);
  const topTaskMismatch = topKeys.length > 1 && new Set(topKeys).size > 1;

  // ── 신규 제안 Task 수(이름 기준 중복 제거) ──
  const newTaskCount = new Set(input.newTasks.map((t) => suggestionKey(t.name))).size;

  const unsuitableRatio = judged > 0 ? unsuitable / judged : 0;

  const workshopReasons: string[] = [];
  if (unsuitableRatio >= WORKSHOP_THRESHOLDS.unsuitableRatio) workshopReasons.push(WORKSHOP_REASONS.unsuitableRatio);
  if (topTaskMismatch) workshopReasons.push(WORKSHOP_REASONS.fteTopMismatch);
  if (newTaskCount >= WORKSHOP_THRESHOLDS.newTaskSuggestions) workshopReasons.push(WORKSHOP_REASONS.newTaskSuggestions);
  if (smeCount > 0 && smeCount < WORKSHOP_THRESHOLDS.minSmeForCrossCheck) {
    workshopReasons.push(WORKSHOP_REASONS.singleSme);
  }

  return {
    smeCount,
    fteRows,
    topTaskByReview,
    topTaskMismatch,
    unsuitableRatio,
    newTaskCount,
    signals,
    workshopReasons,
  };
}

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

  // 신호 계산용 원본. 제출된 검토가 없으면 조회를 건너뛴다(.in([])은 무의미한 왕복이다).
  const empty = { data: [] as unknown[], error: null as { message: string } | null };
  const [jobFb, taskFb, skillFb, fte, suggestions, flags] = await Promise.all([
    reviewIds.length
      ? supabase.from('job_feedback').select('review_id, section, suitability').in('review_id', reviewIds)
      : Promise.resolve(empty),
    reviewIds.length
      ? supabase.from('task_feedback').select('review_id, task_id, suitability').in('review_id', reviewIds)
      : Promise.resolve(empty),
    reviewIds.length
      ? supabase.from('skill_feedback').select('review_id, skill_id, suitability').in('review_id', reviewIds)
      : Promise.resolve(empty),
    reviewIds.length
      ? supabase
          .from('task_fte_allocations')
          .select('review_id, target_type, task_id, suggestion_id, pct')
          .in('review_id', reviewIds)
      : Promise.resolve(empty),
    reviewIds.length
      ? supabase.from('new_task_suggestions').select('id, review_id, name').in('review_id', reviewIds)
      : Promise.resolve(empty),
    fetchWorkshopFlags(companyId),
  ]);

  const firstError = [jobFb, taskFb, skillFb, fte, suggestions].find((r) => r.error)?.error;
  if (firstError) return fail('제출 큐 조회', firstError.message);
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
  for (const raw of suggestions.data || []) {
    const r = raw as Row;
    suggestionName.set(str(r.id), str(r.name));
    inputOf(str(r.review_id))?.newTasks.push({ reviewId: str(r.review_id), name: str(r.name) });
  }
  for (const raw of jobFb.data || []) {
    const r = raw as Row;
    inputOf(str(r.review_id))?.suitability.push({
      key: `job:${str(r.section)}`,
      name: str(r.section),
      reviewId: str(r.review_id),
      value: (str(r.suitability) as Suitability) || null,
    });
  }
  for (const raw of taskFb.data || []) {
    const r = raw as Row;
    inputOf(str(r.review_id))?.suitability.push({
      key: `task:${str(r.task_id)}`,
      name: '',
      reviewId: str(r.review_id),
      value: (str(r.suitability) as Suitability) || null,
    });
  }
  for (const raw of skillFb.data || []) {
    const r = raw as Row;
    inputOf(str(r.review_id))?.suitability.push({
      key: `skill:${str(r.skill_id)}`,
      name: '',
      reviewId: str(r.review_id),
      value: (str(r.suitability) as Suitability) || null,
    });
  }
  for (const raw of fte.data || []) {
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

  const empty = { data: [] as unknown[], error: null as { message: string } | null };
  const [tasks, suggestions, fte] = await Promise.all([
    supabase.from('job_tasks').select('id, name').eq('job_id', jobId).eq('active', true),
    reviewIds.length
      ? supabase.from('new_task_suggestions').select('id, review_id, name').in('review_id', reviewIds)
      : Promise.resolve(empty),
    reviewIds.length
      ? supabase
          .from('task_fte_allocations')
          .select('review_id, target_type, task_id, suggestion_id, pct')
          .in('review_id', reviewIds)
      : Promise.resolve(empty),
  ]);

  const firstError = [tasks, suggestions, fte].find((r) => r.error)?.error;
  if (firstError) return fail('SME 응답 비교 조회', firstError.message);

  const taskName = new Map<string, string>();
  for (const raw of tasks.data || []) {
    const r = raw as Row;
    taskName.set(str(r.id), str(r.name));
  }
  const suggestionName = new Map<string, string>();
  for (const raw of suggestions.data || []) {
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

  for (const raw of fte.data || []) {
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

// ────────────────────────────────────────────────────────────────────
// 6. 승인 / 반려 (§6-3 ⓑ · §7-2 decide_review)
// ────────────────────────────────────────────────────────────────────

export type ReviewVerdict = 'APPROVED' | 'REJECTED';

export interface ReviewDecision {
  reviewId: string;
  status: ReviewStatus;
  approvedAt: string | null;
  rejectedReason: string | null;
  submittedAt: string | null;
}

/**
 * 승인/반려(§6-3 ⓑ). 워크벤치의 승인·반려 버튼이 쓴다.
 * decide_review RPC 한 번(=한 트랜잭션)으로 상태·사유·이력·감사 기록이 함께 남는다.
 * reviews의 status·approved_at·rejected_reason은 컬럼 잠금 트리거가 걸려 있어
 * 클라이언트에서 직접 update 할 수 없다 — 이 경로가 유일하다.
 *
 * 반려 사유는 서버가 최종 판정을 하지만(빈 사유면 예외) 여기서 먼저 막는다.
 * 왕복 한 번을 아끼려는 게 아니라, 같은 상황에서 같은 문구를 즉시 보여 주기 위해서다.
 */
export async function decideReview(
  reviewId: string,
  verdict: ReviewVerdict,
  reason = '',
): Promise<ApiResult<ReviewDecision>> {
  if (!supabase) return fail('검토 판정', NO_DB);
  const trimmed = reason.trim();
  if (verdict === 'REJECTED' && !trimmed) {
    return invalid('반려 사유를 입력해 주세요. SME가 무엇을 고쳐야 하는지 알 수 없습니다.');
  }

  const { data, error } = await supabase.rpc('decide_review', {
    p_review_id: reviewId,
    p_verdict: verdict,
    p_reason: trimmed,
  });
  if (error) return fail(verdict === 'APPROVED' ? '검토 승인' : '검토 반려', error.message);

  const r = (Array.isArray(data) ? data[0] : data) as Row | null;
  if (!r) return fail('검토 판정', '서버가 판정 결과를 돌려주지 않았습니다.');
  return ok({
    reviewId: str(r.review_id) || reviewId,
    status: (str(r.status) as ReviewStatus) || 'SUBMITTED',
    approvedAt: str(r.approved_at) || null,
    rejectedReason: str(r.rejected_reason) || null,
    submittedAt: str(r.submitted_at) || null,
  });
}

// ────────────────────────────────────────────────────────────────────
// 7. 워크숍 플래그 (§6-3 ⓑ · job_workshop_flags)
// ────────────────────────────────────────────────────────────────────

export type WorkshopFlagSource = 'AUTO' | 'MANUAL';

export interface WorkshopFlag {
  jobId: string;
  jobName: string;
  flagged: boolean;
  source: WorkshopFlagSource;
  reasons: string[];
  decidedBy: string | null;
  updatedAt: string | null;
}

export interface WorkshopFlagInput {
  flagged: boolean;
  source: WorkshopFlagSource;
  reasons: string[];
  /**
   * true면 이미 저장된 사유에 이번 사유를 합쳐 넣는다(중복 제거).
   * §7-1 ⑤ "자동 규칙이 다시 돌면 같은 줄을 갱신한다(사유는 reasons에 누적)"와
   * §10 P3 DoD ③ "자동 플래그 사유가 reasons 배열에 축적"이 이것이다.
   * 수동 지정(MANUAL)은 관리자가 사유를 다시 쓰는 것이므로 기본값(false = 교체)을 쓴다.
   */
  mergeReasons?: boolean;
}

/**
 * 회사의 워크숍 플래그 전체(§6-3 ⓑ). 제출 큐 배지와 워크숍 대상 목록(§9 E4)이 쓴다.
 * job_workshop_flags에는 company_id가 없으므로 jobs를 inner join 해서 좁힌다. 쿼리 1회.
 */
export async function fetchWorkshopFlags(companyId?: string | null): Promise<ApiResult<WorkshopFlag[]>> {
  if (!supabase) return fail('워크숍 플래그 조회', NO_DB);
  let query = supabase
    .from('job_workshop_flags')
    .select('job_id, flagged, source, reasons, decided_by, updated_at, jobs!inner(id, name, company_id, active)')
    .eq('jobs.active', true);
  if (companyId) query = query.eq('jobs.company_id', companyId);

  const { data, error } = await query;
  if (error) return fail('워크숍 플래그 조회', error.message);

  return ok(
    (data || []).map((raw) => {
      const r = raw as Row;
      const job = one(r.jobs);
      return {
        jobId: str(r.job_id),
        jobName: str(job.name),
        flagged: r.flagged !== false,
        source: str(r.source) === 'MANUAL' ? 'MANUAL' : 'AUTO',
        reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).map(str).filter(Boolean) : [],
        decidedBy: str(r.decided_by) || null,
        updatedAt: str(r.updated_at) || null,
      } satisfies WorkshopFlag;
    }),
  );
}

/**
 * 워크숍 플래그 저장(§6-3 ⓑ). 자동 규칙 실행과 수동 지정 버튼이 함께 쓴다.
 * 직무당 한 줄(job_id가 PK)이라 upsert 한 번이다.
 *
 * ponytail: mergeReasons=true일 때만 기존 사유를 읽어 합치므로 그 경우 쿼리 2회이고
 * 두 호출 사이에 다른 관리자가 같은 직무를 고치면 나중 것이 이긴다. 관리자 화면 하나에서
 * 순차로 도는 작업이라 지금은 이걸로 충분하다. 동시 실행이 생기면 배열 병합을 RPC로 내린다.
 */
export async function upsertWorkshopFlag(jobId: string, input: WorkshopFlagInput): Promise<ApiResult<void>> {
  if (!supabase) return fail('워크숍 대상 지정', NO_DB);

  let reasons = input.reasons.map((r) => r.trim()).filter(Boolean);
  if (input.mergeReasons) {
    const { data, error } = await supabase
      .from('job_workshop_flags')
      .select('reasons')
      .eq('job_id', jobId)
      .maybeSingle();
    if (error) return fail('워크숍 대상 지정', error.message);
    const before = Array.isArray((data as Row | null)?.reasons)
      ? ((data as Row).reasons as unknown[]).map(str).filter(Boolean)
      : [];
    reasons = [...new Set([...before, ...reasons])];
  }

  const { error } = await supabase.from('job_workshop_flags').upsert(
    {
      job_id: jobId,
      flagged: input.flagged,
      source: input.source,
      reasons,
      decided_by: await currentUserId(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' },
  );
  if (error) return fail('워크숍 대상 지정', error.message);
  return ok(undefined);
}

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

  let assignmentQuery = supabase
    .from('review_assignments')
    .select('sme_id, jobs!inner(company_id, active), reviews(status)')
    .eq('active', true)
    .eq('jobs.active', true);
  if (companyId) assignmentQuery = assignmentQuery.eq('jobs.company_id', companyId);

  let inquiryQuery = supabase
    .from('inquiries')
    .select('id, profiles!inner(company_id)', { count: 'exact', head: true })
    .eq('status', 'OPEN');
  if (companyId) inquiryQuery = inquiryQuery.eq('profiles.company_id', companyId);

  const [assignments, settings, inquiries] = await Promise.all([
    assignmentQuery,
    companyId
      ? supabase.from('survey_settings').select('due_date').eq('company_id', companyId).maybeSingle()
      : Promise.resolve({ data: null as Row | null, error: null as { message: string } | null }),
    inquiryQuery,
  ]);

  if (assignments.error) return fail('대시보드 지표 조회', assignments.error.message);
  if (settings.error) return fail('마감일 조회', settings.error.message);
  if (inquiries.error) return fail('미답 문의 수 조회', inquiries.error.message);

  let assignedCount = 0;
  let submittedCount = 0;
  /** smeId → 하나라도 시작(NOT_STARTED가 아님)했는가. */
  const startedBySme = new Map<string, boolean>();

  for (const raw of assignments.data || []) {
    const r = raw as Row;
    const review = one(r.reviews);
    const status = (str(review.status) as ReviewStatus) || 'NOT_STARTED';
    assignedCount += 1;
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
  });
}
