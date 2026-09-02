import { supabase } from './supabase';
import {
  CELL_STATUS_LABELS,
  cellStatusOf,
  computeJobSignals,
  fetchWorkshopFlags,
  isComparableReview,
  suggestionKey,
  UNKNOWN_ORG_LABEL,
  type JobSignalInput,
} from './adminApi';
import { fetchAllJobsResult, type ApiResult, type JobListItem } from './jobApi';
import { toSuitabilityLabel, type ReviewStatus, type Suitability } from './reviewApi';
import type { FteTargetType } from './surveyApi';
import {
  EXPORT_DEFINITIONS,
  type ExportId,
  type ExportRow,
  type ExportSheetData,
  type FteBasis,
} from './exportSchema';

/*
 * Export 5종(E1~E5)의 조회·집계 계층 — 행을 모으기만 한다.
 *
 * 근거: docs/PLAN.txt §9(Export 5종 = 계약 산출물 원천) · §10 P4 · §11-2 Phase 4,
 *       §2 R8(조직 단위 분석) · R10(적정 인력 산정의 원천 데이터), §6-3 ⓒ(FTE 분포·범위 종료선).
 *
 * ── 이 파일이 하는 일과 하지 않는 일 ──
 * 한다   : Supabase 조회 → 계약(src/lib/exportSchema.ts)이 정한 시트·열 이름·열 순서 그대로의 행 배열.
 * 안 한다: XLSX/CSV/JSON 파일 생성, 화면, 다운로드, 감사 로그 기록.
 *          Export 실행의 audit_logs 기록(§11-2 Phase 4 3항)은 실제로 파일을 내려 주는 쪽이 남긴다 —
 *          여기서 남기면 조회만 하고 파일을 만들지 않은 경우까지 "Export 했다"로 기록된다.
 * 열 이름은 절대 이 파일에서 새로 짓지 않는다. 전부 EXPORT_DEFINITIONS 에서 가져오고(sheetOf),
 * 계약에 없는 열 이름이 섞이면 그 자리에서 실패한다 — 조용히 어긋난 증빙 파일이 §12 검수 자리에
 * 올라가는 것보다 낫다.
 *
 * ── 실패 규약: ApiResult 하나로 통일 ──
 * 다섯 collect 함수는 전부 ApiResult<CollectedExport>(jobApi.ts 정의)를 돌려준다. adminApi.ts 와 같은
 * 이유다 — Export 센터 화면에 카드 5장이 동시에 올라가고, 한 장이 실패해도 나머지는 그려져야 한다.
 * 파일 안 내부 헬퍼는 QueryFailure 를 던지고 collect() 래퍼가 그것을 ApiResult 로 바꾼다.
 * 밖으로 나가는 규약은 ApiResult 하나뿐이다.
 *
 * 조회 실패를 "0건"으로 위장하지 않는다(§계약 상단). 실패는 error 로 올라가고, 호출부는 그때
 * 파일을 만들면 안 된다. 값이 없어서 비는 칸만 빈칸으로 둔다(0 으로 채우지 않는다).
 *
 * ── 쿼리 수 ──
 * reviewApi.fetchJobReviewFeedback 의 "쿼리 6회, SME 수와 무관"이 이 저장소의 기준이다.
 * 여기서도 쿼리 수는 직무 수·SME 수에 비례하지 않는다(함수마다 회수를 주석에 적었다).
 * 다만 두 가지는 데이터 양에 비례한다. 둘 다 의도한 것이고 이유를 아래에 적는다.
 *   ① in() 청크 — PostgREST 는 id 목록을 URL 쿼리스트링으로 보낸다. uuid 는 36자라
 *      1,000개를 넘기면 프록시의 헤더 길이 한계(nginx 기본 8KB)에 걸려 조회가 통째로 실패한다.
 *      그래서 IN_CHUNK(100개, 약 4KB)로 잘라 여러 번 부른다.
 *   ② 페이지 — PostgREST 는 한 응답의 행 수에 상한(db-max-rows)을 걸 수 있고, 그 경우 잘린 응답이
 *      오류 없이 온다. 잘린 줄 모르고 파일을 만들면 그게 곧 "조회 실패를 0건으로 위장"이다.
 *      그래서 PAGE(1,000행)씩 range()로 끝까지 읽는다. 페이지를 나눌 때는 반드시 정렬이 걸려야 한다 —
 *      이유와 규칙은 아래 PAGE_ORDER_KEY 주석에 적었다.
 * 두 경우 모두 회수는 "가져온 행 수"에 비례하지 "SME 수·직무 수"에 비례하지 않는다.
 *
 * ── 표준편차(E2·§9) ──
 * 표본표준편차(n-1, Excel 의 STDEV/STDEV.S 와 같은 정의)를 쓴다. 이 칸의 응답은 그 직무를 맡은
 * SME 전수가 아니라 "그중 응답한 1~2명"의 표본이고(R6), 검수 자리의 수기 검산도 Excel STDEV 로
 * 이뤄진다. 정의가 갈리면 검산이 어긋난다.
 * 응답이 1건이면 표준편차는 정의되지 않는다 — null 로 둔다. 0 으로 적으면 "편차가 없다"는 거짓이 된다.
 *
 * ── 소요 시간(E1 '소요 분' · E5 '소요 실측 요약') ──
 * SESSION_CAP_MINUTES / 아래 loadDurations 주석 참고.
 */

// ── 공개 타입 ───────────────────────────────────────────────────────

/** collect* 공통 옵션. */
export interface CollectOptions {
  /**
   * E2 전용(§9 E2 "승인 응답 기준/전체 기준 토글"). 기본값은 'APPROVED' —
   * §9 의 검수 기준이 "E2 Export의 직무×조직 피벗이 승인 응답 기준으로 산출 가능할 것"이라
   * 아무것도 고르지 않은 상태에서 나가는 파일은 그 기준이어야 한다.
   */
  basis?: FteBasis;
}

/** collect* 의 결과. 파일 생성 쪽은 sheets 를 그대로 XLSX/CSV/JSON 으로 옮기면 된다. */
export interface CollectedExport {
  id: ExportId;
  /** E2 만 채운다. '내보내기 정보' 시트의 '집계 기준' 행과 JSON 의 basis 가 이 값이다. */
  basis?: FteBasis;
  /** 계약의 시트 순서 그대로. columns 는 계약에서 복사한 열 순서다. */
  sheets: ExportSheetData[];
  /** 시트명 → 행 수. '내보내기 정보'의 '시트별 행 수' 행이 이 값이다. */
  rowCounts: Record<string, number>;
  /** 전 시트 행 수 합. 호출부가 EXPORT_ROW_WARNING 과 비교해 경고하면 된다. */
  totalRows: number;
}

/**
 * 이 행 수를 넘으면 호출부가 "파일이 큽니다. 계열사를 좁혀 주세요" 정도의 경고를 띄우길 권한다.
 * 막지는 않는다 — 막아야 할 만큼 큰 경우는 아래 EXPORT_MAX_REVIEWS 에서 미리 걸린다.
 */
export const EXPORT_ROW_WARNING = 50_000;

/**
 * 한 번의 Export 가 다룰 수 있는 검토(reviews) 수 상한.
 * 검토 1건이 항목 응답 수십 행으로 불어나므로(E1), 5,000건이면 시트 하나가 이미 20만 행 근처다.
 * 그 이상은 브라우저에서 XLSX 생성이 메모리로 무너진다. 넘으면 조용히 자르지 않고 실패로 알린다 —
 * 절반만 담긴 증빙 파일이 가장 나쁜 결과다(계약 상단).
 */
export const EXPORT_MAX_REVIEWS = 5_000;

// ── 내부: 실패 처리 ─────────────────────────────────────────────────

type Row = Record<string, unknown>;

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

/** 내부 전용 실패. collect() 가 잡아 ApiResult 로 바꾼다. 이 타입은 파일 밖으로 나가지 않는다. */
class QueryFailure extends Error {}

function qfail(what: string, message: string): never {
  throw new QueryFailure(`${what} 실패했습니다. ${message}`);
}

/** 다섯 collect 함수의 공통 껍데기. 여기서만 예외 → ApiResult 로 바뀐다. */
async function collect(what: string, run: () => Promise<CollectedExport>): Promise<ApiResult<CollectedExport>> {
  if (!supabase) return { ok: false, error: `${what} 실패했습니다. ${NO_DB}` };
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    const message = e instanceof QueryFailure ? e.message : `${what} 실패했습니다. ${errorText(e)}`;
    console.error(`[exportApi] ${message}`);
    return { ok: false, error: message };
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** supabase 를 non-null 로 좁힌다. collect() 가 이미 확인했지만 타입은 그것을 모른다. */
function db() {
  if (!supabase) qfail('데이터베이스 연결 확인', NO_DB);
  return supabase;
}

// ── 내부: 조회 헬퍼(청크 + 페이지) ──────────────────────────────────

/** PostgREST 응답 한 장. supabase-js 의 빌더가 구조적으로 이 모양에 들어맞는다. */
interface Queryable {
  /** fetchAll 이 페이지를 나누기 전에 정렬 키를 덧붙인다. 아래 PAGE_ORDER_KEY 주석 참고. */
  order(column: string, options: { ascending: boolean }): Queryable;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** 한 번에 읽어 오는 행 수. 위 헤더 주석 ② 참고. */
const PAGE = 1000;
/** in() 한 번에 넘기는 id 수. 위 헤더 주석 ① 참고. */
const IN_CHUNK = 100;

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * 페이지를 나눌 때 마지막에 덧붙이는 정렬 키.
 *
 * ORDER BY 가 없는 LIMIT/OFFSET 의 행 순서는 PostgreSQL 도 PostgREST 도 보장하지 않는다.
 * 정렬 없이 range() 를 두 번 부르면 같은 행이 두 페이지에 오거나(중복) 어느 페이지에도 안 오고
 * 빠질 수 있다(누락). 특히 task_fte_allocations 는 SME 자동저장이 DELETE+INSERT 로 다시 쓰는 표라
 * 조사 기간 중 Export 를 뽑으면 튜플이 물리적으로 옮겨 다닌다.
 * 그렇게 어긋난 수치는 오류 없이 파일에 실려 §10 P4 DoD ②(원본 수기 검산 일치)를 조용히 깬다.
 *
 * 그래서 fetchAll 이 모든 조회에 기본 키 정렬을 강제한다. 표시 순서를 따로 잡아 둔 조회
 * (job_tasks 의 sort_order, review_history 의 created_at 등)는 그 정렬을 먼저 걸어 두면 되고,
 * 여기서 붙는 키는 뒤에 붙어 동률만 가르는 2차 키가 된다(supabase-js 의 order 는 이어 붙인다).
 * snapshotApi.ts 의 SnapshotTable.orderBy 와 같은 이유·같은 규칙이다.
 */
const PAGE_ORDER_KEY = 'id';

/**
 * 조회 결과를 끝까지 읽는다. build()는 매번 새 쿼리 빌더를 만들어야 한다
 * (supabase-js 빌더는 한 번 await 하면 재사용할 수 없다).
 * orderBy 는 페이지 경계를 고정하는 유일·불변 키여야 한다. 기본값은 기본 키(id)다.
 */
async function fetchAll(what: string, build: () => Queryable, orderBy: string = PAGE_ORDER_KEY): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build()
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) qfail(what, error.message);
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    // 마지막 장은 PAGE 보다 짧다. 정확히 PAGE 면 한 장 더 확인한다(빈 응답으로 끝난다).
    if (rows.length < PAGE) return out;
  }
}

/** id 목록으로 거르는 조회. 청크로 나눠 부르고 결과를 합친다. 빈 목록이면 왕복하지 않는다. */
async function fetchByIds(
  what: string,
  ids: string[],
  build: (chunkIds: string[]) => Queryable,
  orderBy: string = PAGE_ORDER_KEY,
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const out: Row[] = [];
  for (const part of chunk(ids, IN_CHUNK)) out.push(...(await fetchAll(what, () => build(part), orderBy)));
  return out;
}

// ── 내부: 값 변환 ───────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/** 소수 둘째 자리까지(pct 가 numeric(5,2)라 그 이상은 원본에 없는 자릿수다). */
const round2 = (v: number): number => Math.round(v * 100) / 100;
/** 비율·분처럼 소수 첫째 자리면 충분한 값. */
const round1 = (v: number): number => Math.round(v * 10) / 10;

const byKorean = (a: string, b: string) => a.localeCompare(b, 'ko');

/** 짝수 개면 가운데 두 값의 평균. 홀수 개면 가운데 값. 빈 배열이면 null(0 이 아니다). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 표본표준편차(n-1). 응답 1건이면 정의되지 않으므로 null. 파일 상단 주석 참고. */
function sampleStdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ── 내부: 계약 대조 ─────────────────────────────────────────────────

/**
 * 계약(exportSchema.ts)에서 시트의 열 이름·순서를 가져와 시트 한 장을 만든다.
 * 행에 계약에 없는 열 이름이 섞이면 그 자리에서 실패한다 — 열 이름 오탈자는 조용히 빈 열이 되고,
 * 그 파일은 §9 가 말한 "검수 기준 그대로의 증빙"이 되지 못한다.
 */
function sheetOf(id: ExportId, sheetName: string, rows: ExportRow[]): ExportSheetData {
  const definition = EXPORT_DEFINITIONS.find((d) => d.id === id);
  const sheet = definition?.sheets.find((s) => s.name === sheetName);
  if (!sheet) qfail(`${id} 시트 구성 확인`, `계약(exportSchema.ts)에 '${sheetName}' 시트가 없습니다.`);

  const columns = sheet.columns.map((c) => c.name);
  const allowed = new Set(columns);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) {
        qfail(`${id} '${sheetName}' 시트 생성`, `계약에 없는 열 '${key}'이(가) 섞였습니다.`);
      }
    }
  }
  return { name: sheetName, columns, rows };
}

function packed(id: ExportId, sheets: ExportSheetData[], basis?: FteBasis): CollectedExport {
  const rowCounts: Record<string, number> = {};
  let totalRows = 0;
  for (const s of sheets) {
    rowCounts[s.name] = s.rows.length;
    totalRows += s.rows.length;
  }
  return { id, basis, sheets, rowCounts, totalRows };
}

// ────────────────────────────────────────────────────────────────────
// 공통 로더 — 다섯 Export 가 나눠 쓴다
// ────────────────────────────────────────────────────────────────────

/** 배정 1건 = SME × 직무. 검토 행이 아직 없는 배정(미시작)도 포함한다. */
interface ScopeRow {
  /** reviews 행이 아직 없으면 ''. 그 배정은 '미시작'이고 항목 응답도 없다. */
  reviewId: string;
  jobId: string;
  smeId: string;
  smeName: string;
  smeEmail: string;
  smeTitle: string;
  /** profiles.org_unit_id. 비어 있으면 null — 버리지 않고 '조직 미지정'으로 모은다(§10 P4 DoD ②). */
  orgUnitId: string | null;
  status: ReviewStatus | null;
  startedAt: string;
  lastSavedAt: string;
  submittedAt: string;
  approvedAt: string;
  rejectedReason: string;
}

/**
 * 이번 Export 범위의 배정·SME·검토. 쿼리 1회(페이지 제외), SME 수와 무관하다.
 *
 * 검토 행이 없는 배정을 버리지 않는 이유: 그 배정은 §6-3 ⓐ 진행 매트릭스에서 '미시작'으로 세어진다.
 * E1 에서만 빼면 같은 회사의 두 산출물이 서로 다른 인원을 말하게 된다.
 */
async function loadScope(companyId: string | null): Promise<ScopeRow[]> {
  const rows = await fetchAll('업무조사 응답 범위 조회', () => {
    let q = db()
      .from('review_assignments')
      .select(
        `
        id, sme_id, job_id,
        profiles!inner(id, name, email, title, org_unit_id),
        jobs!inner(id, company_id, active),
        reviews(id, status, started_at, last_saved_at, submitted_at, approved_at, rejected_reason)
      `,
      )
      .eq('active', true)
      .eq('jobs.active', true);
    if (companyId) q = q.eq('jobs.company_id', companyId);
    return q;
  });

  if (rows.length > EXPORT_MAX_REVIEWS) {
    qfail(
      '업무조사 응답 범위 조회',
      `대상 검토가 ${rows.length.toLocaleString()}건으로 한 번에 다룰 수 있는 상한(${EXPORT_MAX_REVIEWS.toLocaleString()}건)을 넘습니다. 계열사를 선택해 범위를 좁혀 주세요.`,
    );
  }

  return rows.map((raw) => {
    const profile = one(raw.profiles);
    const review = one(raw.reviews);
    return {
      reviewId: str(review.id),
      jobId: str(raw.job_id) || str(one(raw.jobs).id),
      smeId: str(profile.id) || str(raw.sme_id),
      smeName: str(profile.name),
      smeEmail: str(profile.email),
      smeTitle: str(profile.title),
      orgUnitId: str(profile.org_unit_id) || null,
      status: (str(review.status) as ReviewStatus) || null,
      startedAt: str(review.started_at),
      lastSavedAt: str(review.last_saved_at),
      submittedAt: str(review.submitted_at),
      approvedAt: str(review.approved_at),
      rejectedReason: str(review.rejected_reason),
    } satisfies ScopeRow;
  });
}

/** PostgREST 가 1:1 관계를 객체로 줄 때와 배열로 줄 때를 모두 받아 준다(reviewApi·adminApi 와 같은 헬퍼). */
function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row) || {};
  return (value as Row) || {};
}

interface OrgLabel {
  code: string;
  name: string;
}

/** org_unit_id → 조직코드·조직명. 쿼리 1회. */
async function loadOrgUnits(companyId: string | null): Promise<Map<string, OrgLabel>> {
  const rows = await fetchAll('조직 목록 조회', () => {
    let q = db().from('org_units').select('id, code, name');
    if (companyId) q = q.eq('company_id', companyId);
    return q;
  });
  return new Map(rows.map((r) => [str(r.id), { code: str(r.code), name: str(r.name) }]));
}

interface TaskRow {
  id: string;
  jobId: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

/**
 * 직무의 주요과업. active=false 도 함께 가져온다 — 이미 저장된 FTE 배분이 그 과업을 가리키고 있으면
 * 이름을 풀지 못해 E1·E2 의 '과업' 칸이 통째로 비기 때문이다. 화면용 목록(E3)에서만 active 로 거른다.
 * 쿼리 1회(직무 id 청크당).
 */
async function loadTasks(jobIds: string[]): Promise<TaskRow[]> {
  const rows = await fetchByIds('주요과업 조회', jobIds, (ids) =>
    db().from('job_tasks').select('id, job_id, name, sort_order, active').in('job_id', ids).order('sort_order'),
  );
  return rows.map((r) => ({
    id: str(r.id),
    jobId: str(r.job_id),
    name: str(r.name),
    sortOrder: num(r.sort_order),
    active: r.active !== false,
  }));
}

/** 신규 제안 과업(new_task_suggestions). 검토 id 로 조회한다. */
async function loadTaskSuggestions(reviewIds: string[]): Promise<Row[]> {
  return fetchByIds('신규 과업 제안 조회', reviewIds, (ids) =>
    db()
      .from('new_task_suggestions')
      .select('id, review_id, name, description, reason')
      .in('review_id', ids)
      .order('created_at'),
  );
}

/** FTE 배분 한 줄을 "어느 검토의 · 어느 과업에 대한" 사실로 푼 것. */
interface FteFact {
  reviewId: string;
  /** 'task:<id>'(기존) · suggestionKey(이름)(신규 제안). adminApi 와 같은 키 체계다. */
  taskKey: string;
  taskName: string;
  targetType: FteTargetType;
  pct: number;
}

/**
 * FTE 배분을 과업 이름까지 풀어서 돌려준다. 쿼리 1회(검토 id 청크당).
 *
 * 신규 제안은 SME 마다 행 id 가 다르므로 이름으로 같은 과업을 맞춘다(adminApi.suggestionKey).
 * 이름을 풀지 못한 행도 버리지 않는다 — 버리면 그 SME 의 합계가 100% 에 못 미치게 되어
 * §10 P4 DoD ②(원본 수기 검산 일치)가 깨진다.
 */
async function loadFteFacts(
  reviewIds: string[],
  taskNameById: Map<string, string>,
  suggestionNameById: Map<string, string>,
): Promise<FteFact[]> {
  const rows = await fetchByIds('투입 비중 조회', reviewIds, (ids) =>
    db()
      .from('task_fte_allocations')
      .select('review_id, target_type, task_id, suggestion_id, pct')
      .in('review_id', ids),
  );

  return rows.map((r) => {
    const suggested = str(r.target_type) === 'SUGGESTED';
    const name = suggested
      ? suggestionNameById.get(str(r.suggestion_id)) ?? '(사라진 제안)'
      : taskNameById.get(str(r.task_id)) ?? '(삭제된 과업)';
    return {
      reviewId: str(r.review_id),
      taskKey: suggested ? suggestionKey(name) : `task:${str(r.task_id)}`,
      taskName: name,
      targetType: (suggested ? 'SUGGESTED' : 'EXISTING') satisfies FteTargetType,
      pct: num(r.pct),
    };
  });
}

/**
 * 검토별 소요(분). review_sessions 의 구간 합이다(§9 E5 · R4).
 *
 * 규칙 세 가지 — 중앙값이 오염되지 않게 하는 최소 장치다.
 *  ① ended_at 이 없는 세션(브라우저를 그냥 닫은 경우)은 그 구간을 세지 않는다.
 *     "지금까지"로 채우면 어제 열어 둔 탭이 수천 분으로 잡히고, 0 으로 채우면 실제 작업 시간이 사라진다.
 *     한 검토의 모든 세션이 열린 채면 그 검토는 소요 기록이 없는 것으로 본다(빈칸, 0 아님).
 *  ② 한 구간이 SESSION_CAP_MINUTES 를 넘으면 그 값으로 자른다(버리지 않는다).
 *     마법사 한 단계에 그만큼 머무는 것은 화면을 켜 둔 채 자리를 비운 것으로 본다. 그대로 더하면
 *     §9 E5 의 "직무당 중앙값 N분"이 착수보고 11면의 "○○분"과 무관한 숫자가 된다.
 *     상한값 자체는 §12 오픈이슈 1(파일럿 실측으로 확정)에서 다시 볼 값이라 상수로 뺐다.
 *  ③ ended_at < started_at(기기 시계 어긋남)인 구간은 버린다. 음수 소요는 사실이 아니다.
 *
 * 쿼리 1회(검토 id 청크당).
 */
const SESSION_CAP_MINUTES = 60;

async function loadDurations(reviewIds: string[]): Promise<Map<string, number>> {
  const rows = await fetchByIds('검토 소요 조회', reviewIds, (ids) =>
    db().from('review_sessions').select('review_id, started_at, ended_at').in('review_id', ids),
  );

  const minutesByReview = new Map<string, number>();
  for (const r of rows) {
    const startedAt = Date.parse(str(r.started_at));
    const endedAt = Date.parse(str(r.ended_at));
    if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) continue; // ①
    const minutes = (endedAt - startedAt) / 60000;
    if (minutes < 0) continue; // ③
    const capped = Math.min(minutes, SESSION_CAP_MINUTES); // ②
    const reviewId = str(r.review_id);
    minutesByReview.set(reviewId, (minutesByReview.get(reviewId) ?? 0) + capped);
  }
  return minutesByReview;
}

/** 직무 메타(직군·직렬·직무명). fetchAllJobsResult 를 그대로 쓴다(이름 순 정렬도 그대로). */
async function loadJobs(companyId: string | null): Promise<JobListItem[]> {
  const result = await fetchAllJobsResult(companyId);
  if (!result.ok) qfail('직무 목록 조회', result.error);
  return result.data;
}

/** profiles.id → 이름. 감사 로그·상태 전이 이력의 '행위자' 열이 쓴다. */
async function loadProfileNames(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
  const rows = await fetchByIds('사용자 이름 조회', ids, (part) =>
    db().from('profiles').select('id, name, email').in('id', part),
  );
  return new Map(rows.map((r) => [str(r.id), { name: str(r.name), email: str(r.email) }]));
}

// ── 내부: 공통 라벨 ─────────────────────────────────────────────────

/** E1 '항목 구분' — job_feedback.section 의 한국어 이름(계약 E1 항목 응답 열 주석 그대로). */
const SECTION_LABELS: Record<string, string> = {
  NAME: '직무명',
  DEFINITION: '직무정의',
  REQ_EDUCATION: '요구 학력',
  REQ_MAJOR: '관련 전공',
  REQ_CERTIFICATIONS: '관련 자격증·면허',
};

const ITEM_TASK = '주요과업';
const ITEM_SKILL = 'Skill';
const ITEM_NEW_TASK = '신규 과업 제안';
const ITEM_NEW_SKILL = '신규 Skill 제안';

/** E2·E3 '과업 구분'. */
const TARGET_LABELS: Record<FteTargetType, string> = {
  EXISTING: '기존',
  SUGGESTED: '신규 제안',
};

// ────────────────────────────────────────────────────────────────────
// E1 업무조사 응답 원본 — 계약 1-(2) · 1-(3) · 23면 현황진단 행
// ────────────────────────────────────────────────────────────────────

/**
 * E1(§9). 시트 2장: '검토 목록'(검토 1건 = 1행) · '항목 응답'(항목 1개 = 1행), 검토 ID 로 잇는다.
 *
 * 쿼리 10종(+페이지·청크): 직무 1 · 배정 1 · 조직 1 · 과업 1 · Skill 1 · 피드백 3 · 제안 2 · FTE 1 · 세션 1.
 * SME 수·직무 수와 무관하다.
 *
 * 승인 여부로 거르지 않는다 — E1 은 "응답 원본"이라 작성 중·반려된 응답까지 그대로 담아야
 * 23면 현황진단의 근거가 된다. 승인 기준으로 좁힌 산출물은 E2·E3 다.
 */
export async function collectE1(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E1 업무조사 응답 원본 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const jobIds = jobs.map((j) => j.id);
    const reviewIds = scope.map((s) => s.reviewId).filter(Boolean);

    const [orgUnits, tasks, skills, jobFb, taskFb, skillFb, taskSuggestions, skillSuggestions, durations] =
      await Promise.all([
        loadOrgUnits(companyId),
        loadTasks(jobIds),
        fetchByIds('필요 Skill 조회', jobIds, (ids) =>
          db().from('job_skills').select('id, job_id, name, skill_type, description, sort_order, active').in('job_id', ids),
        ),
        fetchByIds('직무 항목 응답 조회', reviewIds, (ids) =>
          db().from('job_feedback').select('review_id, section, suitability, comment, suggestion').in('review_id', ids),
        ),
        fetchByIds('과업 응답 조회', reviewIds, (ids) =>
          db()
            .from('task_feedback')
            .select('review_id, task_id, suitability, comment, suggestion, delete_requested')
            .in('review_id', ids),
        ),
        fetchByIds('Skill 응답 조회', reviewIds, (ids) =>
          db()
            .from('skill_feedback')
            .select('review_id, skill_id, suitability, comment, suggestion, delete_requested')
            .in('review_id', ids),
        ),
        loadTaskSuggestions(reviewIds),
        fetchByIds('신규 Skill 제안 조회', reviewIds, (ids) =>
          db()
            .from('new_skill_suggestions')
            .select('id, review_id, name, description, reason')
            .in('review_id', ids)
            .order('created_at'),
        ),
        loadDurations(reviewIds),
      ]);

    const taskNameById = new Map(tasks.map((t) => [t.id, t.name]));
    const skillNameById = new Map(skills.map((s) => [str(s.id), str(s.name)]));
    const suggestionNameById = new Map(taskSuggestions.map((s) => [str(s.id), str(s.name)]));
    const fteFacts = await loadFteFacts(reviewIds, taskNameById, suggestionNameById);

    // ── 시트 1: 검토 목록 ──
    const reviewRows: ExportRow[] = scope
      .slice()
      .sort(
        (a, b) =>
          byKorean(jobById.get(a.jobId)?.name ?? '', jobById.get(b.jobId)?.name ?? '') ||
          byKorean(a.smeName, b.smeName),
      )
      .map((s) => {
        const job = jobById.get(s.jobId);
        const org = s.orgUnitId ? orgUnits.get(s.orgUnitId) : undefined;
        const minutes = durations.get(s.reviewId);
        return {
          '검토 ID': s.reviewId,
          직군: job?.group_name ?? '',
          직렬: job?.series_name ?? '',
          직무: job?.name ?? '',
          'SME 성명': s.smeName,
          'SME 이메일': s.smeEmail,
          // 조직 미지정·이름을 찾지 못한 조직은 빈칸으로 둔다(계약 E1 '소속 조직명' 주석).
          '소속 조직코드': org?.code ?? '',
          '소속 조직명': org?.name ?? '',
          직급: s.smeTitle,
          상태: CELL_STATUS_LABELS[cellStatusOf(s.status, s.approvedAt || null)],
          '시작 일시': s.startedAt,
          '최종 저장 일시': s.lastSavedAt,
          '제출 일시': s.submittedAt,
          '승인 일시': s.approvedAt,
          '반려 사유': s.rejectedReason,
          // 기록이 없으면 빈칸이다. 0 분은 "즉시 끝냈다"는 거짓이 된다.
          '소요 분': minutes === undefined ? null : round1(minutes),
        } satisfies ExportRow;
      });

    // ── 시트 2: 항목 응답 ──
    const byReview = new Map(scope.filter((s) => s.reviewId).map((s) => [s.reviewId, s]));
    const items = new Map<string, ExportRow[]>();
    const push = (reviewId: string, row: ExportRow) => {
      const list = items.get(reviewId);
      if (list) list.push(row);
      else items.set(reviewId, [row]);
    };

    /** 이 검토의 공통 앞 3열. 시트 하나만 따로 봐도 읽히도록 매 행에 반복한다(계약 주석). */
    const head = (reviewId: string) => {
      const s = byReview.get(reviewId);
      return {
        '검토 ID': reviewId,
        직무: s ? jobById.get(s.jobId)?.name ?? '' : '',
        'SME 성명': s?.smeName ?? '',
      };
    };

    /** (검토, 과업) → FTE 비중. 항목 응답 행에 비중을 붙이는 데 쓴다. */
    const pctByReviewTask = new Map<string, number>();
    for (const f of fteFacts) pctByReviewTask.set(`${f.reviewId}|${f.taskKey}`, f.pct);

    for (const r of jobFb) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': SECTION_LABELS[str(r.section)] ?? str(r.section),
        항목명: '', // 직무정의처럼 이름이 없는 항목(계약 E1 '항목명' 주석)
        '적합성 판정': toSuitabilityLabel(str(r.suitability) as Suitability | null),
        의견: str(r.comment),
        '수정 제안': str(r.suggestion),
        '삭제 제안': '',
        'FTE 비중(%)': null,
      });
    }

    /** 배분은 있는데 판정 행이 없는 과업을 뒤에 채우기 위한 표시. */
    const feedbackTaskKeys = new Set<string>();

    for (const r of taskFb) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      const taskId = str(r.task_id);
      const key = `${reviewId}|task:${taskId}`;
      feedbackTaskKeys.add(key);
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_TASK,
        항목명: taskNameById.get(taskId) ?? '(삭제된 과업)',
        '적합성 판정': toSuitabilityLabel(str(r.suitability) as Suitability | null),
        의견: str(r.comment),
        '수정 제안': str(r.suggestion),
        '삭제 제안': r.delete_requested === true ? 'Y' : '',
        'FTE 비중(%)': pctByReviewTask.get(key) ?? null,
      });
    }

    /*
     * 판정 없이 비중만 배분된 과업. STEP 3(FTE)만 채우고 STEP 2(적합성)를 비워 둔 응답에서 나온다.
     * 이 행을 빼면 E1 의 비중 합계가 E2·서버 제출 게이트(합계 100%)와 어긋나
     * §10 P4 DoD ②(원본 수기 검산 일치)가 깨진다.
     */
    for (const f of fteFacts) {
      if (f.targetType !== 'EXISTING') continue; // 신규 제안은 아래 제안 행에서 비중을 싣는다
      const key = `${f.reviewId}|${f.taskKey}`;
      if (feedbackTaskKeys.has(key)) continue;
      if (!byReview.has(f.reviewId)) continue;
      push(f.reviewId, {
        ...head(f.reviewId),
        '항목 구분': ITEM_TASK,
        항목명: f.taskName,
        '적합성 판정': '',
        의견: '',
        '수정 제안': '',
        '삭제 제안': '',
        'FTE 비중(%)': f.pct,
      });
    }

    for (const r of skillFb) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_SKILL,
        항목명: skillNameById.get(str(r.skill_id)) ?? '(삭제된 Skill)',
        '적합성 판정': toSuitabilityLabel(str(r.suitability) as Suitability | null),
        의견: str(r.comment),
        '수정 제안': str(r.suggestion),
        '삭제 제안': r.delete_requested === true ? 'Y' : '',
        'FTE 비중(%)': null,
      });
    }

    // 신규 제안 행: 항목명=제안명 · 의견=제안 사유 · 수정 제안=설명(계약 E1 시트 주석 그대로).
    for (const r of taskSuggestions) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      const name = str(r.name);
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_NEW_TASK,
        항목명: name,
        '적합성 판정': '', // 판정 대상이 아니다
        의견: str(r.reason),
        '수정 제안': str(r.description),
        '삭제 제안': '',
        'FTE 비중(%)': pctByReviewTask.get(`${reviewId}|${suggestionKey(name)}`) ?? null,
      });
    }
    for (const r of skillSuggestions) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_NEW_SKILL,
        항목명: str(r.name),
        '적합성 판정': '',
        의견: str(r.reason),
        '수정 제안': str(r.description),
        '삭제 제안': '',
        'FTE 비중(%)': null,
      });
    }

    // 검토 목록 시트와 같은 순서로 이어 붙인다. 두 시트를 나란히 놓고 읽을 수 있어야 한다.
    const itemRows: ExportRow[] = [];
    for (const row of reviewRows) {
      const reviewId = String(row['검토 ID'] ?? '');
      itemRows.push(...(items.get(reviewId) ?? []));
    }

    return packed('E1', [sheetOf('E1', '검토 목록', reviewRows), sheetOf('E1', '항목 응답', itemRows)]);
  });
}

// ────────────────────────────────────────────────────────────────────
// E2 직무·조직별 투입 비중 분포 — 계약 1-(4) · 3-(4) 원천 · 16면 (R8 · R10)
// ────────────────────────────────────────────────────────────────────

/** 한 칸(직무×과업×조직 또는 직무×과업)의 응답 묶음. */
interface FteCell {
  jobId: string;
  taskKey: string;
  taskName: string;
  targetType: FteTargetType;
  orgUnitId: string | null;
  /** 조직 이름을 찾지 못한 org_unit_id 인지. 조직 미지정과 섞이면 안 된다. */
  orgUnknown: boolean;
  values: number[];
}

/**
 * E2(§9). 시트 2장: '직무×과업×조직 피벗' · '직무×과업 집계'.
 * 이 Phase 의 핵심 산출물이다 — 계약 1-(4)·3-(4)의 원천이고 §10 P4 DoD ②의 검산 대상이다.
 *
 * 쿼리 6종(+페이지·청크): 직무 1 · 배정 1 · 조직 1 · 과업 1 · 신규 제안 1 · FTE 1.
 *
 * 기준(§9 "승인 응답 기준/전체 기준 토글")
 *   'APPROVED' — reviews.approved_at IS NOT NULL 인 검토만. 기본값이자 §9 의 검수 기준이다.
 *   'ALL'      — 제출된 검토 전체(SUBMITTED·RESUBMITTED). 작성 중인 초안은 어느 기준에도 넣지 않는다.
 *                제출 전 값은 SME 가 아직 고치는 중이라 "응답"이 아니다.
 *   승인된 검토도 status 는 SUBMITTED·RESUBMITTED 그대로다(decide_review 는 approved_at 만 찍는다).
 *   그래서 APPROVED ⊂ ALL 이고, 두 기준의 차이는 "관리자가 확인했는가" 하나다.
 *
 * 조직축은 profiles.org_unit_id 다. 값이 비어 있는 SME 의 응답을 버리지 않고 조직코드·조직명이 빈
 * 행으로 모은다(계약 E2 피벗 시트 주석). 버리면 조직 피벗의 합계가 '직무×과업 집계'와 어긋나
 * §10 P4 DoD ②의 수기 검산이 실패한다.
 */
export async function collectE2(companyId: string | null, opts: CollectOptions = {}): Promise<ApiResult<CollectedExport>> {
  const basis: FteBasis = opts.basis ?? 'APPROVED';

  return collect('E2 직무·조직별 투입 비중 분포 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const included = scope.filter((s) => {
      if (!s.reviewId) return false;
      return basis === 'APPROVED' ? Boolean(s.approvedAt) : isComparableReview(s.status);
    });
    const reviewIds = included.map((s) => s.reviewId);
    const scopeByReview = new Map(included.map((s) => [s.reviewId, s]));

    const [orgUnits, tasks, suggestions] = await Promise.all([
      loadOrgUnits(companyId),
      loadTasks(jobs.map((j) => j.id)),
      loadTaskSuggestions(reviewIds),
    ]);
    const facts = await loadFteFacts(
      reviewIds,
      new Map(tasks.map((t) => [t.id, t.name])),
      new Map(suggestions.map((s) => [str(s.id), str(s.name)])),
    );

    // ── 칸 모으기 ──
    const pivot = new Map<string, FteCell>();
    const byJob = new Map<string, FteCell>();

    for (const f of facts) {
      const s = scopeByReview.get(f.reviewId);
      if (!s) continue; // 기준 밖 검토(작성 중·미승인)
      const org = s.orgUnitId ? orgUnits.get(s.orgUnitId) : undefined;
      const orgUnknown = Boolean(s.orgUnitId) && !org;

      const pivotKey = `${s.jobId}|${f.taskKey}|${s.orgUnitId ?? ''}`;
      let cell = pivot.get(pivotKey);
      if (!cell) {
        cell = {
          jobId: s.jobId,
          taskKey: f.taskKey,
          taskName: f.taskName,
          targetType: f.targetType,
          orgUnitId: s.orgUnitId,
          orgUnknown,
          values: [],
        };
        pivot.set(pivotKey, cell);
      }
      cell.values.push(f.pct);

      const jobKey = `${s.jobId}|${f.taskKey}`;
      let jobCell = byJob.get(jobKey);
      if (!jobCell) {
        jobCell = {
          jobId: s.jobId,
          taskKey: f.taskKey,
          taskName: f.taskName,
          targetType: f.targetType,
          orgUnitId: null,
          orgUnknown: false,
          values: [],
        };
        byJob.set(jobKey, jobCell);
      }
      jobCell.values.push(f.pct);
    }

    const jobName = (id: string) => jobById.get(id)?.name ?? '';
    const sortCells = (a: FteCell, b: FteCell) =>
      byKorean(jobName(a.jobId), jobName(b.jobId)) || byKorean(a.taskName, b.taskName);

    // ── 시트 1: 직무×과업×조직 피벗 ──
    const pivotRows: ExportRow[] = [...pivot.values()]
      .sort((a, b) => sortCells(a, b) || byKorean(orgNameOf(a, orgUnits), orgNameOf(b, orgUnits)))
      .map((cell) => {
        const job = jobById.get(cell.jobId);
        const org = cell.orgUnitId ? orgUnits.get(cell.orgUnitId) : undefined;
        const sd = sampleStdev(cell.values);
        return {
          직군: job?.group_name ?? '',
          직렬: job?.series_name ?? '',
          직무: job?.name ?? '',
          '과업 구분': TARGET_LABELS[cell.targetType],
          과업: cell.taskName,
          // 조직 미지정은 빈칸(계약 주석). 이름만 못 찾은 조직은 '알 수 없는 조직'으로 남긴다 —
          // 미지정과 한 칸에 섞으면 서로 다른 조직의 응답이 한 줄로 합쳐진다.
          조직코드: org?.code ?? '',
          조직명: org?.name ?? (cell.orgUnknown ? UNKNOWN_ORG_LABEL : ''),
          'SME 평균 비중(%)': round2(mean(cell.values) ?? 0),
          '표준편차(%p)': sd === null ? null : round2(sd),
          '응답 수': cell.values.length,
        } satisfies ExportRow;
      });

    // ── 시트 2: 직무×과업 집계(+순위) ──
    const jobCells = [...byJob.values()].sort(sortCells);
    /** 직무 안에서 평균 비중이 큰 순서(§6-3 ⓒ "상위 과업 순위"). 동점은 같은 순위를 준다. */
    const rankByKey = new Map<string, number>();
    const groupedByJob = new Map<string, FteCell[]>();
    for (const cell of jobCells) {
      const list = groupedByJob.get(cell.jobId);
      if (list) list.push(cell);
      else groupedByJob.set(cell.jobId, [cell]);
    }
    for (const [jobId, cells] of groupedByJob) {
      const ordered = [...cells].sort((a, b) => (mean(b.values) ?? 0) - (mean(a.values) ?? 0) || byKorean(a.taskName, b.taskName));
      let rank = 0;
      let previous: number | null = null;
      ordered.forEach((cell, index) => {
        const avg = round2(mean(cell.values) ?? 0);
        // 동점이면 앞 행과 같은 순위, 다음 순위는 건너뛴다(1,2,2,4).
        if (previous === null || avg !== previous) rank = index + 1;
        previous = avg;
        rankByKey.set(`${jobId}|${cell.taskKey}`, rank);
      });
    }

    const byJobRows: ExportRow[] = jobCells.map((cell) => {
      const job = jobById.get(cell.jobId);
      const sd = sampleStdev(cell.values);
      return {
        직군: job?.group_name ?? '',
        직렬: job?.series_name ?? '',
        직무: job?.name ?? '',
        '과업 구분': TARGET_LABELS[cell.targetType],
        과업: cell.taskName,
        'SME 평균 비중(%)': round2(mean(cell.values) ?? 0),
        '표준편차(%p)': sd === null ? null : round2(sd),
        '응답 수': cell.values.length,
        순위: rankByKey.get(`${cell.jobId}|${cell.taskKey}`) ?? null,
      } satisfies ExportRow;
    });

    return packed(
      'E2',
      [sheetOf('E2', '직무×과업×조직 피벗', pivotRows), sheetOf('E2', '직무×과업 집계', byJobRows)],
      basis,
    );
  });
}

function orgNameOf(cell: FteCell, orgUnits: Map<string, OrgLabel>): string {
  if (!cell.orgUnitId) return '';
  return orgUnits.get(cell.orgUnitId)?.name ?? UNKNOWN_ORG_LABEL;
}

// ────────────────────────────────────────────────────────────────────
// E3 직무기술서 원천 4시트 — 계약 2-(2) JD · 23면 직무기술서 구성항목
// ────────────────────────────────────────────────────────────────────

/**
 * E3(§9). 시트 4장(job_description / task_activity / skill / requirements) — 시트명은 §9 문언 그대로 영문.
 *
 * "검토 반영(승인) 기준"이라 FTE 비중은 항상 승인된 검토(approved_at IS NOT NULL)만으로 집계한다.
 * E2 와 달리 기준 토글이 없다(계약 hasBasisToggle=false).
 * 승인 검토가 없는 직무도 행은 남기고 비중·응답 수만 빈칸으로 둔다 — 행을 빼면 받는 쪽이
 * "그 직무가 없는 것"과 "아직 승인 전인 것"을 구분할 수 없다(계약 E3 주석).
 *
 * 쿼리 8종(+페이지·청크): 직무 1 · 배정 1 · 과업 1 · 세부활동 1 · Skill 1 · 수행요건 1 · 신규 제안 1 · FTE 1.
 */
export async function collectE3(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E3 직무기술서 원천 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobIds = jobs.map((j) => j.id);

    const approved = scope.filter((s) => s.reviewId && s.approvedAt);
    const approvedReviewIds = approved.map((s) => s.reviewId);
    const jobByReview = new Map(approved.map((s) => [s.reviewId, s.jobId]));

    const tasks = await loadTasks(jobIds);
    const activeTaskIds = tasks.filter((t) => t.active).map((t) => t.id);

    const [activities, skills, requirements, suggestions, activityNotes] = await Promise.all([
      fetchByIds('세부활동 조회', activeTaskIds, (ids) =>
        db()
          .from('task_activities')
          .select('id, job_task_id, activity_name, sort_order')
          .in('job_task_id', ids)
          .eq('active', true)
          .order('sort_order'),
      ),
      fetchByIds('필요 Skill 조회', jobIds, (ids) =>
        db()
          .from('job_skills')
          .select('job_id, name, skill_type, description, sort_order')
          .in('job_id', ids)
          .eq('active', true)
          .order('sort_order'),
      ),
      fetchByIds('수행요건 조회', jobIds, (ids) =>
        db().from('job_requirements').select('job_id, education, major, certifications').in('job_id', ids),
      ),
      loadTaskSuggestions(approvedReviewIds),
      // 세부활동 의견(결정 D2). 승인된 검토의 것만 싣는다 — E3의 다른 열과 같은 모집단이다.
      fetchByIds('세부활동 의견 조회', approvedReviewIds, (ids) =>
        db().from('activity_feedback').select('activity_id, comment, delete_requested').in('review_id', ids),
      ),
    ]);

    const suggestionNameById = new Map(suggestions.map((s) => [str(s.id), str(s.name)]));
    const facts = await loadFteFacts(approvedReviewIds, new Map(tasks.map((t) => [t.id, t.name])), suggestionNameById);

    // 승인 응답의 비중을 (직무, 과업키)로 모은다. E2 '직무×과업 집계'의 승인 기준 값과 같은 수다.
    const pctByJobTask = new Map<string, number[]>();
    for (const f of facts) {
      const jobId = jobByReview.get(f.reviewId);
      if (!jobId) continue;
      const key = `${jobId}|${f.taskKey}`;
      const list = pctByJobTask.get(key);
      if (list) list.push(f.pct);
      else pctByJobTask.set(key, [f.pct]);
    }

    // 승인 검토 수·최종 승인 일시.
    const approvedCount = new Map<string, number>();
    const lastApprovedAt = new Map<string, string>();
    for (const s of approved) {
      approvedCount.set(s.jobId, (approvedCount.get(s.jobId) ?? 0) + 1);
      const previous = lastApprovedAt.get(s.jobId) ?? '';
      if (s.approvedAt > previous) lastApprovedAt.set(s.jobId, s.approvedAt);
    }

    // ── 시트 1: job_description ──
    const descriptionRows: ExportRow[] = jobs.map((job) => ({
      '직무 ID': job.id,
      직군: job.group_name,
      직렬: job.series_name,
      직무: job.name,
      직무정의: '', // 아래에서 채운다(fetchAllJobsResult 에는 definition 이 없다)
      '승인 검토 수': approvedCount.get(job.id) ?? 0,
      '최종 승인 일시': lastApprovedAt.get(job.id) ?? '',
    }));

    // definition 은 jobs 테이블에서 따로 읽는다. 쿼리 1회.
    const definitions = await fetchByIds('직무정의 조회', jobIds, (ids) =>
      db().from('jobs').select('id, definition').in('id', ids),
    );
    const definitionById = new Map(definitions.map((d) => [str(d.id), str(d.definition)]));
    for (const row of descriptionRows) row['직무정의'] = definitionById.get(String(row['직무 ID'])) ?? '';

    // ── 시트 2: task_activity ──
    const activitiesByTask = new Map<string, { id: string; name: string }[]>();
    for (const a of activities) {
      const taskId = str(a.job_task_id);
      const entry = { id: str(a.id), name: str(a.activity_name) };
      const list = activitiesByTask.get(taskId);
      if (list) list.push(entry);
      else activitiesByTask.set(taskId, [entry]);
    }

    /*
      세부활동 의견(결정 D2). 여러 SME가 같은 줄에 의견을 남길 수 있으므로 문장을 이어 붙이고,
      삭제 제안은 앞에 표시를 붙인다. 배분 값은 건드리지 않는다 — 배분 단위는 여전히 과업이다.
    */
    const notesByActivity = new Map<string, string[]>();
    for (const n of activityNotes) {
      const id = str(n.activity_id);
      const text = str(n.comment).trim();
      const parts: string[] = [];
      if (n.delete_requested === true) parts.push('[삭제 제안]');
      if (text) parts.push(text);
      if (parts.length === 0) continue;
      const list = notesByActivity.get(id) ?? [];
      list.push(parts.join(' '));
      notesByActivity.set(id, list);
    }

    const tasksByJob = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.active) continue;
      const list = tasksByJob.get(t.jobId);
      if (list) list.push(t);
      else tasksByJob.set(t.jobId, [t]);
    }

    /** 승인 검토에서 나온 신규 제안 과업. 이름이 같으면 한 과업으로 본다(§9 E3 "신규 제안이 반영된 과업"). */
    const suggestedByJob = new Map<string, Map<string, string>>();
    for (const s of suggestions) {
      const jobId = jobByReview.get(str(s.review_id));
      if (!jobId) continue;
      const name = str(s.name);
      const map = suggestedByJob.get(jobId) ?? new Map<string, string>();
      map.set(suggestionKey(name), name);
      suggestedByJob.set(jobId, map);
    }

    const taskRows: ExportRow[] = [];
    const fteCell = (jobId: string, taskKey: string) => {
      const values = pctByJobTask.get(`${jobId}|${taskKey}`);
      return {
        // 승인 응답이 없으면 빈칸이다. 0% 로 적으면 "그 과업에 시간을 쓰지 않는다"는 다른 사실이 된다.
        'FTE 비중(%)': values && values.length ? round2(mean(values) ?? 0) : null,
        '응답 수': values && values.length ? values.length : null,
      };
    };

    for (const job of jobs) {
      for (const task of tasksByJob.get(job.id) ?? []) {
        const cells = fteCell(job.id, `task:${task.id}`);
        const activityList = activitiesByTask.get(task.id) ?? [];
        // 세부활동이 여러 개면 과업 단위 비중이 같은 값으로 반복된다 — 합산하지 말 것(계약 시트 주석).
        const list = activityList.length ? activityList : [{ id: '', name: '' }];
        for (const activity of list) {
          taskRows.push({
            '직무 ID': job.id,
            직군: job.group_name,
            직렬: job.series_name,
            직무: job.name,
            주요과업: task.name,
            세부활동: activity.name,
            '세부활동 의견': (notesByActivity.get(activity.id) ?? []).join(' / '),
            '과업 구분': TARGET_LABELS.EXISTING,
            ...cells,
          });
        }
      }
      for (const [key, name] of suggestedByJob.get(job.id) ?? []) {
        taskRows.push({
          '직무 ID': job.id,
          직군: job.group_name,
          직렬: job.series_name,
          직무: job.name,
          주요과업: name,
          세부활동: '', // 신규 제안에는 아직 세부활동이 없다
          '세부활동 의견': '',
          '과업 구분': TARGET_LABELS.SUGGESTED,
          ...fteCell(job.id, key),
        });
      }
    }

    // ── 시트 3: skill ──
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const skillRows: ExportRow[] = [];
    for (const s of skills) {
      const job = jobById.get(str(s.job_id));
      if (!job) continue;
      skillRows.push({
        '직무 ID': job.id,
        직군: job.group_name,
        직렬: job.series_name,
        직무: job.name,
        'Skill 구분': str(s.skill_type),
        Skill: str(s.name),
        'Skill 설명': str(s.description),
      });
    }
    skillRows.sort((a, b) => byKorean(String(a['직무']), String(b['직무'])));

    // ── 시트 4: requirements ──
    const requirementByJob = new Map(requirements.map((r) => [str(r.job_id), r]));
    const requirementRows: ExportRow[] = jobs.map((job) => {
      const r = requirementByJob.get(job.id);
      return {
        '직무 ID': job.id,
        직군: job.group_name,
        직렬: job.series_name,
        직무: job.name,
        '요구 학력': str(r?.education),
        '관련 전공': str(r?.major),
        '관련 자격증/면허': str(r?.certifications),
      };
    });

    return packed('E3', [
      sheetOf('E3', 'job_description', descriptionRows),
      sheetOf('E3', 'task_activity', taskRows),
      sheetOf('E3', 'skill', skillRows),
      sheetOf('E3', 'requirements', requirementRows),
    ]);
  });
}

// ────────────────────────────────────────────────────────────────────
// E4 워크숍 대상 직무 목록 — 13면
// ────────────────────────────────────────────────────────────────────

/** 저장된 결정 없이 자동 규칙에만 걸린 직무의 '플래그 여부' 값(계약 E4 · workshopRules 의 AUTO_PENDING). */
const AUTO_PENDING_LABEL = '자동 후보(지정 전)';

/**
 * E4(§9). 시트 1장. 저장된 플래그가 있는 직무(수동 해제 포함) + 자동 규칙에 지금 걸린 직무 —
 * "대상 최소화"(13면)를 어떻게 판단했는지의 이력과 아직 판단하지 않은 후보가 함께 근거가 된다.
 *
 * 저장된 플래그만 실으면 이 목록은 "관리자가 워크벤치에서 저장을 누른 직무"가 된다. 자동 규칙에
 * 걸려 있어도 비교 뷰를 한 번도 열지 않은 직무는 job_workshop_flags 에 줄이 없어 통째로 빠지고,
 * 그러면 §6-3 ⓑ 가 말한 전수 판별 근거가 아니다. 그래서 회사의 직무 전체를 훑어 자동 규칙을
 * 실측하고, 저장 전 직무는 '자동 후보(지정 전)'로 남긴다(workshopRules 의 AUTO_PENDING 과 같은 상태).
 *
 * 지표 4열은 §6-3 ⓑ 자동 규칙 ①~④와 1:1이다. 계산은 adminApi.computeJobSignals 를 그대로 쓴다 —
 * 제출 큐·비교 뷰·이 Export 가 서로 다른 수를 말하면 그 순간 근거가 아니라 분쟁거리가 된다.
 * 임계값은 workshopThresholds.ts 에 있고 §12 에서 조정될 수 있으므로 값을 여기 적지 않는다.
 *
 * 쿼리 8종(+페이지·청크): 직무 1 · 플래그 1 · 배정 1 · 판정 3 · FTE 1 · 신규 제안 1 · 지정자 이름 1.
 */
export async function collectE4(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E4 워크숍 대상 직무 목록 조회', async () => {
    const [jobs, flagResult] = await Promise.all([loadJobs(companyId), fetchWorkshopFlags(companyId)]);
    if (!flagResult.ok) qfail('워크숍 플래그 조회', flagResult.error);
    const flags = flagResult.data;
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const flagByJob = new Map(flags.map((f) => [f.jobId, f]));
    // 훑을 범위 = 이 회사의 직무 전체 + 목록에 없는 플래그 직무(비활성화된 직무의 이력도 남긴다).
    const scanJobIds = [...new Set([...jobs.map((j) => j.id), ...flags.map((f) => f.jobId)])];

    // 제출된 검토만 신호 계산에 넣는다(adminApi.isComparableReview 와 같은 판정).
    const assignments = await fetchByIds('워크숍 후보 검토 조회', scanJobIds, (ids) =>
      db().from('review_assignments').select('job_id, reviews(id, status)').eq('active', true).in('job_id', ids),
    );

    const reviewToJob = new Map<string, string>();
    const reviewIdsByJob = new Map<string, string[]>();
    for (const a of assignments) {
      const review = one(a.reviews);
      const reviewId = str(review.id);
      const jobId = str(a.job_id);
      if (!reviewId || !jobId) continue;
      if (!isComparableReview((str(review.status) as ReviewStatus) || null)) continue;
      reviewToJob.set(reviewId, jobId);
      const list = reviewIdsByJob.get(jobId);
      if (list) list.push(reviewId);
      else reviewIdsByJob.set(jobId, [reviewId]);
    }
    const reviewIds = [...reviewToJob.keys()];
    // 범위를 직무 전체로 넓혔으므로 다른 Export 와 같은 상한을 여기에도 건다(조용히 자르지 않는다).
    if (reviewIds.length > EXPORT_MAX_REVIEWS) {
      qfail(
        '워크숍 후보 검토 조회',
        `대상 검토가 ${reviewIds.length.toLocaleString()}건으로 한 번에 다룰 수 있는 상한(${EXPORT_MAX_REVIEWS.toLocaleString()}건)을 넘습니다. 계열사를 선택해 범위를 좁혀 주세요.`,
      );
    }

    const [jobFb, taskFb, skillFb, fte, suggestions, decidedBy] = await Promise.all([
      fetchByIds('직무 판정 조회', reviewIds, (ids) =>
        db().from('job_feedback').select('review_id, section, suitability').in('review_id', ids),
      ),
      fetchByIds('과업 판정 조회', reviewIds, (ids) =>
        db().from('task_feedback').select('review_id, task_id, suitability').in('review_id', ids),
      ),
      fetchByIds('Skill 판정 조회', reviewIds, (ids) =>
        db().from('skill_feedback').select('review_id, skill_id, suitability').in('review_id', ids),
      ),
      fetchByIds('투입 비중 조회', reviewIds, (ids) =>
        db()
          .from('task_fte_allocations')
          .select('review_id, target_type, task_id, suggestion_id, pct')
          .in('review_id', ids),
      ),
      loadTaskSuggestions(reviewIds),
      loadProfileNames([...new Set(flags.map((f) => f.decidedBy).filter((id): id is string => Boolean(id)))]),
    ]);

    const inputs = new Map<string, JobSignalInput>();
    for (const jobId of scanJobIds) {
      inputs.set(jobId, { reviewIds: reviewIdsByJob.get(jobId) ?? [], suitability: [], fte: [], newTasks: [] });
    }
    const inputOf = (reviewId: string) => {
      const jobId = reviewToJob.get(reviewId);
      return jobId ? inputs.get(jobId) : undefined;
    };

    const suggestionNameById = new Map<string, string>();
    for (const s of suggestions) {
      suggestionNameById.set(str(s.id), str(s.name));
      inputOf(str(s.review_id))?.newTasks.push({ reviewId: str(s.review_id), name: str(s.name) });
    }
    const pushSuitability = (rows: Row[], keyOf: (r: Row) => string) => {
      for (const r of rows) {
        inputOf(str(r.review_id))?.suitability.push({
          key: keyOf(r),
          name: '',
          reviewId: str(r.review_id),
          value: (str(r.suitability) as Suitability) || null,
        });
      }
    };
    pushSuitability(jobFb, (r) => `job:${str(r.section)}`);
    pushSuitability(taskFb, (r) => `task:${str(r.task_id)}`);
    pushSuitability(skillFb, (r) => `skill:${str(r.skill_id)}`);

    for (const r of fte) {
      const suggested = str(r.target_type) === 'SUGGESTED';
      const name = suggested ? suggestionNameById.get(str(r.suggestion_id)) ?? '' : '';
      inputOf(str(r.review_id))?.fte.push({
        key: suggested ? suggestionKey(name) : `task:${str(r.task_id)}`,
        name,
        targetType: suggested ? 'SUGGESTED' : 'EXISTING',
        reviewId: str(r.review_id),
        pct: num(r.pct),
      });
    }

    /*
     * 실을 행 = 저장된 플래그가 있는 직무 + 자동 규칙에 지금 걸린 직무.
     * 자동 판정은 computeJobSignals 의 workshopReasons 를 그대로 쓴다 — 제출 큐·비교 뷰·이 Export 가
     * 서로 다른 수를 말하지 않게 셈법을 하나로 둔다(임계값은 workshopThresholds.ts).
     * 제출된 검토가 하나도 없는 직무는 사유가 만들어지지 않아 여기 들어오지 않는다(판정 불가 ≠ 후보).
     */
    const candidates = scanJobIds
      .map((jobId) => {
        const input = inputs.get(jobId) ?? { reviewIds: [], suitability: [], fte: [], newTasks: [] };
        return { jobId, flag: flagByJob.get(jobId), input, signals: computeJobSignals(input) };
      })
      .filter((c) => c.flag || c.signals.workshopReasons.length > 0);

    const nameOf = (jobId: string, fallback: string) => jobById.get(jobId)?.name ?? fallback;
    const rows: ExportRow[] = candidates
      .sort((a, b) => byKorean(nameOf(a.jobId, a.flag?.jobName ?? ''), nameOf(b.jobId, b.flag?.jobName ?? '')))
      .map(({ jobId, flag, input, signals }) => {
        const job = jobById.get(jobId);
        // computeJobSignals 는 판정이 하나도 없을 때도 비율 0 을 준다. 0% 와 "판정 없음"은 다른 사실이라
        // 판정 수를 여기서 따로 세어 빈칸과 구분한다.
        const judged = input.suitability.filter((s) => s.value).length;
        const maxGap = signals.fteRows.length ? Math.max(...signals.fteRows.map((r) => r.maxGap)) : null;
        return {
          '직무 ID': jobId,
          직군: job?.group_name ?? '',
          직렬: job?.series_name ?? '',
          직무: job?.name ?? flag?.jobName ?? '',
          // 저장된 결정이 없는 행은 '자동 후보(지정 전)'. '대상'과 섞으면 아직 아무도 판단하지 않은 직무가
          // 이미 확정된 워크숍 대상으로 읽힌다.
          '플래그 여부': flag ? (flag.flagged ? '대상' : '해제') : AUTO_PENDING_LABEL,
          '지정 구분': flag ? (flag.source === 'MANUAL' ? '수동' : '자동') : '',
          // 저장된 사유가 있으면 그것을, 없으면 지금 실측한 자동 규칙 사유를 적는다.
          '플래그 사유': (flag ? flag.reasons : signals.workshopReasons).join(' · '),
          'SME 응답 수': signals.smeCount,
          '부적합 판정 비율(%)': judged > 0 ? round1(signals.unsuitableRatio * 100) : null,
          'FTE 1위 과업 불일치': signals.topTaskMismatch ? 'Y' : '',
          '최대 FTE 비중 차(%p)': maxGap === null ? null : round2(maxGap),
          '신규 제안 과업 수': signals.newTaskCount,
          // 자동 지정이면 decided_by 가 비어 있다(계약 '지정자' 주석).
          지정자: flag?.decidedBy ? decidedBy.get(flag.decidedBy)?.name ?? flag.decidedBy : '',
          '최종 갱신 일시': flag?.updatedAt ?? '',
        } satisfies ExportRow;
      });

    return packed('E4', [sheetOf('E4', '워크숍 대상 직무', rows)]);
  });
}

// ────────────────────────────────────────────────────────────────────
// E5 검토 이력·감사 로그 — 검수 대응 · 11면 ○○분 확정 근거
// ────────────────────────────────────────────────────────────────────

/** review_history.action → §9 E5 '행위' 열의 한국어. RPC 가 넣는 값 그대로를 옮긴다. */
const HISTORY_ACTION_LABELS: Record<string, string> = {
  SUBMITTED: '제출',
  RESUBMITTED: '재제출',
  REVIEW_REQUESTED: '재검토 요청',
  APPROVED: '승인',
  REJECTED: '반려',
};

/** 소요 실측 요약 마지막 행의 직무 칸(§9 E5 "직무당 중앙값 N분"의 전 직무 값). */
const DURATION_TOTAL_LABEL = '전체';

/**
 * 소요 실측 요약 '구분' 열. 마지막 합계 행이 데이터 행 사이에 섞여 있어, 표시가 없으면
 * CSV·JSON 을 받은 쪽이 '응답 수'를 그냥 더해 실제 검토 수의 두 배를 얻는다(빈 직무 ID 는
 * 사람 눈에만 단서다). 시트 주석은 파일에 실리지 않으므로 열로 싣는다.
 */
const DURATION_KIND_JOB = '직무';
const DURATION_KIND_TOTAL = '합계';

/**
 * E5(§9). 시트 3장: '상태 전이 이력' · '관리자 행위 로그' · '소요 실측 요약'.
 *
 * 반려 사유는 별도 시트로 떼지 않는다 — review_history.note 가 곧 반려 사유이고(decide_review 가
 * 그렇게 적는다), 전이와 떼면 어느 반려의 사유인지 다시 이어 붙여야 한다(계약 E5 주석).
 *
 * 감사 로그(audit_logs)에는 회사 구분 컬럼이 없다. 그래서 이 시트에는 계열사 필터가 걸리지 않고
 * 관리자가 볼 수 있는 기록 전체가 실린다. 회사별로 나눠 담은 척하지 않는다 —
 * §8 S5 의 감사 기록은 본래 전사 단위 증빙이다.
 * 그 사실은 코드 주석으로 끝내지 않는다: exportSchema 의 E5_AUDIT_SCOPE_NOTE 가 화면 카드와
 * 파일 첫 시트('대상 회사' 값)에 함께 실려, 받는 쪽이 라벨만 보고 단일 계열사 자료로 읽지 않게 한다.
 *
 * 쿼리 6종(+페이지·청크): 직무 1 · 배정 1 · 상태 전이 1 · 감사 로그 1 · 행위자 이름 1 · 세션 1.
 */
export async function collectE5(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E5 검토 이력·감사 로그 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const withReview = scope.filter((s) => s.reviewId);
    const reviewIds = withReview.map((s) => s.reviewId);
    const scopeByReview = new Map(withReview.map((s) => [s.reviewId, s]));

    const [history, audit, durations] = await Promise.all([
      fetchByIds('상태 전이 이력 조회', reviewIds, (ids) =>
        db()
          .from('review_history')
          .select('review_id, actor_id, action, note, created_at')
          .in('review_id', ids)
          .order('created_at'),
      ),
      fetchAll('관리자 행위 로그 조회', () =>
        db()
          .from('audit_logs')
          .select('actor_id, action, entity, entity_id, meta, created_at')
          .order('created_at', { ascending: false }),
      ),
      loadDurations(reviewIds),
    ]);

    const actorIds = [
      ...new Set([...history, ...audit].map((r) => str(r.actor_id)).filter(Boolean)),
    ];
    const actors = await loadProfileNames(actorIds);

    // ── 시트 1: 상태 전이 이력 ──
    const transitionRows: ExportRow[] = history
      .slice()
      .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))
      .map((h) => {
        const s = scopeByReview.get(str(h.review_id));
        const actorId = str(h.actor_id);
        const action = str(h.action);
        return {
          '발생 일시': str(h.created_at),
          '검토 ID': str(h.review_id),
          직무: s ? jobById.get(s.jobId)?.name ?? '' : '',
          'SME 성명': s?.smeName ?? '',
          // 아는 값만 옮긴다. 모르는 action 은 원문을 그대로 남긴다 — 지우면 이력이 사라진다.
          행위: HISTORY_ACTION_LABELS[action] ?? action,
          '사유·메모': str(h.note),
          행위자: actorId ? actors.get(actorId)?.name ?? actorId : '',
        } satisfies ExportRow;
      });

    // ── 시트 2: 관리자 행위 로그 ──
    const auditRows: ExportRow[] = audit.map((a) => {
      const actorId = str(a.actor_id);
      const actor = actorId ? actors.get(actorId) : undefined;
      return {
        '발생 일시': str(a.created_at),
        행위: str(a.action),
        대상: str(a.entity),
        '대상 ID': str(a.entity_id),
        // 이름을 못 찾으면 id 라도 남긴다. 지우면 "누가 했는지 모르는 기록"이 아니라 "아무도 안 한 기록"이 된다.
        행위자: actorId ? (actor ? `${actor.name} · ${actor.email}` : actorId) : '',
        상세: a.meta && typeof a.meta === 'object' ? JSON.stringify(a.meta) : '',
      } satisfies ExportRow;
    });

    // ── 시트 3: 소요 실측 요약 ──
    // 끝까지 마친 검토만 센다. 작성 중(IN_PROGRESS)인 검토는 STEP 1 만 열어 본 6분짜리도 섞여 들어와
    // 중앙값을 아래로 끌어내리는데, 이 시트의 '전체' 행은 착수보고 11면 "직무당 약 ○○분"
    // (§12 오픈이슈 1)의 확정 근거이므로 "완료까지 걸린 시간"이어야 한다.
    // 판정은 E2·E4 와 같은 것을 쓴다(adminApi.isComparableReview + 승인 시각).
    // 반려(REVIEW_REQUESTED)는 뺀다 — 재작성 대기 중이라 아직 끝나지 않은 검토이고, 재작성 시간이
    // 얹히면 이번에는 반대로 위로 부풀린다.
    const completed = withReview.filter((s) => isComparableReview(s.status) || Boolean(s.approvedAt));

    const minutesByJob = new Map<string, number[]>();
    const allMinutes: number[] = [];
    for (const s of completed) {
      const minutes = durations.get(s.reviewId);
      if (minutes === undefined) continue; // 기록이 없는 검토는 분모에서도 뺀다
      const list = minutesByJob.get(s.jobId);
      if (list) list.push(minutes);
      else minutesByJob.set(s.jobId, [minutes]);
      allMinutes.push(minutes);
    }

    const durationRows: ExportRow[] = jobs.map((job) => {
      const values = minutesByJob.get(job.id) ?? [];
      const med = median(values);
      const avg = mean(values);
      return {
        '직무 ID': job.id,
        직군: job.group_name,
        직렬: job.series_name,
        직무: job.name,
        '응답 수': values.length,
        '소요 중앙값(분)': med === null ? null : round1(med),
        '소요 평균(분)': avg === null ? null : round1(avg),
        구분: DURATION_KIND_JOB,
      } satisfies ExportRow;
    });

    // 마지막 행 = 전 직무 합산. 직무별 중앙값의 중앙값이 아니라 검토 전체의 중앙값이다 —
    // 착수보고 11면의 "SME 1인당 직무당 약 ○○분"은 SME 한 사람의 경험이지 직무의 평균이 아니다.
    const totalMedian = median(allMinutes);
    const totalMean = mean(allMinutes);
    durationRows.push({
      '직무 ID': '',
      직군: '',
      직렬: '',
      직무: DURATION_TOTAL_LABEL,
      '응답 수': allMinutes.length,
      '소요 중앙값(분)': totalMedian === null ? null : round1(totalMedian),
      '소요 평균(분)': totalMean === null ? null : round1(totalMean),
      구분: DURATION_KIND_TOTAL,
    });

    return packed('E5', [
      sheetOf('E5', '상태 전이 이력', transitionRows),
      sheetOf('E5', '관리자 행위 로그', auditRows),
      sheetOf('E5', '소요 실측 요약', durationRows),
    ]);
  });
}

// ── 한 곳에서 부르기 ────────────────────────────────────────────────

/**
 * Export ID → 조회 함수. 화면이 카드 5장을 같은 방식으로 다루게 한다.
 * opts 를 실제로 보는 것은 E2 하나뿐이라(§9 에서 토글이 있는 Export 가 E2 뿐이다) 나머지 넷은
 * 인자를 하나만 받는다 — 넘겨도 무시된다.
 */
export const EXPORT_COLLECTORS: Record<
  ExportId,
  (companyId: string | null, opts?: CollectOptions) => Promise<ApiResult<CollectedExport>>
> = {
  E1: collectE1,
  E2: collectE2,
  E3: collectE3,
  E4: collectE4,
  E5: collectE5,
};

/*
 * buildExport(id, {companyId, basis}) 어댑터는 두었다가 지웠다.
 * 두 화면 모두 EXPORT_COLLECTORS 를 직접 부른다 — 시트만 돌려주는 어댑터로는 rowCounts·totalRows 가
 * 버려져서, 대용량 확인(EXPORT_ROW_WARNING)과 완료 표시의 행 수를 화면이 다시 세야 했기 때문이다.
 * 아무도 부르지 않는데 "화면이 쓰는 유일한 진입점"이라 적힌 주석만 남으면 다음 사람이 그 말을 믿는다.
 */
