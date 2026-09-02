/*
 * Export 공용 계층 — E1~E5가 함께 쓰는 조회·변환·계약 대조 (v2 D5 파일 분해).
 *
 * 원래 exportApi.ts 한 파일(1,518줄)에 E1~E5 수집기와 이 헬퍼들이 함께 있었다.
 * 산출물 하나를 고칠 때마다 파일 전체를 읽어야 했고, 다섯 수집기가 같은 헬퍼를 쓰는지
 * 눈으로 확인할 방법이 없었다. 그래서 헬퍼를 이 파일로 모으고 수집기를 E별 파일로 나눴다.
 *
 * 이 모듈의 export는 "같은 폴더 안에서만 쓰는 내부 공용"이다.
 * 화면이 쓰는 공개 API는 src/lib/exportApi.ts(배럴)가 정한다 — 그쪽 목록이 계약이다.
 */
import { supabase } from '../supabase';
import { suggestionKey } from '../adminApi';
import { fetchAllJobsResult, type ApiResult, type JobListItem } from '../jobApi';
import type { ReviewStatus } from '../reviewApi';
import type { FteTargetType } from '../surveyApi';
import {
  EXPORT_DEFINITIONS,
  type ExportId,
  type ExportRow,
  type ExportSheetData,
  type FteBasis,
} from '../exportSchema';

/*
 * 폴더 안 재수출 — E별 파일이 import 경로를 두 벌(../adminApi 등 + ./shared) 갖지 않게 한다.
 * 밖(화면)에서 쓸 것은 여기가 아니라 배럴(src/lib/exportApi.ts)이 정한다.
 */
export {
  CELL_STATUS_LABELS,
  cellStatusOf,
  computeJobSignals,
  fetchWorkshopFlags,
  isComparableReview,
  suggestionKey,
  UNKNOWN_ORG_LABEL,
} from '../adminApi';
export type { JobSignalInput } from '../adminApi';
export { fetchAllJobsResult } from '../jobApi';
export type { ApiResult, JobListItem } from '../jobApi';
export { toSuitabilityLabel } from '../reviewApi';
export type { ReviewStatus, Suitability } from '../reviewApi';
export type { FteTargetType } from '../surveyApi';
export { EXPORT_DEFINITIONS } from '../exportSchema';
export type { ExportId, ExportRow, ExportSheetData, FteBasis } from '../exportSchema';

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

export type Row = Record<string, unknown>;

export const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

/** 내부 전용 실패. collect() 가 잡아 ApiResult 로 바꾼다. 이 타입은 파일 밖으로 나가지 않는다. */
export class QueryFailure extends Error {}

export function qfail(what: string, message: string): never {
  throw new QueryFailure(`${what} 실패했습니다. ${message}`);
}

/** 다섯 collect 함수의 공통 껍데기. 여기서만 예외 → ApiResult 로 바뀐다. */
export async function collect(what: string, run: () => Promise<CollectedExport>): Promise<ApiResult<CollectedExport>> {
  if (!supabase) return { ok: false, error: `${what} 실패했습니다. ${NO_DB}` };
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    const message = e instanceof QueryFailure ? e.message : `${what} 실패했습니다. ${errorText(e)}`;
    console.error(`[exportApi] ${message}`);
    return { ok: false, error: message };
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** supabase 를 non-null 로 좁힌다. collect() 가 이미 확인했지만 타입은 그것을 모른다. */
export function db() {
  if (!supabase) qfail('데이터베이스 연결 확인', NO_DB);
  return supabase;
}

// ── 내부: 조회 헬퍼(청크 + 페이지) ──────────────────────────────────

/** PostgREST 응답 한 장. supabase-js 의 빌더가 구조적으로 이 모양에 들어맞는다. */
export interface Queryable {
  /** fetchAll 이 페이지를 나누기 전에 정렬 키를 덧붙인다. 아래 PAGE_ORDER_KEY 주석 참고. */
  order(column: string, options: { ascending: boolean }): Queryable;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** 한 번에 읽어 오는 행 수. 위 헤더 주석 ② 참고. */
export const PAGE = 1000;
/** in() 한 번에 넘기는 id 수. 위 헤더 주석 ① 참고. */
export const IN_CHUNK = 100;

export function chunk<T>(values: T[], size: number): T[][] {
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
export const PAGE_ORDER_KEY = 'id';

/**
 * 조회 결과를 끝까지 읽는다. build()는 매번 새 쿼리 빌더를 만들어야 한다
 * (supabase-js 빌더는 한 번 await 하면 재사용할 수 없다).
 * orderBy 는 페이지 경계를 고정하는 유일·불변 키여야 한다. 기본값은 기본 키(id)다.
 */
export async function fetchAll(what: string, build: () => Queryable, orderBy: string = PAGE_ORDER_KEY): Promise<Row[]> {
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
export async function fetchByIds(
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

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/** 소수 둘째 자리까지(pct 가 numeric(5,2)라 그 이상은 원본에 없는 자릿수다). */
export const round2 = (v: number): number => Math.round(v * 100) / 100;
/** 비율·분처럼 소수 첫째 자리면 충분한 값. */
export const round1 = (v: number): number => Math.round(v * 10) / 10;

export const byKorean = (a: string, b: string) => a.localeCompare(b, 'ko');

/** 짝수 개면 가운데 두 값의 평균. 홀수 개면 가운데 값. 빈 배열이면 null(0 이 아니다). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 표본표준편차(n-1). 응답 1건이면 정의되지 않으므로 null. 파일 상단 주석 참고. */
export function sampleStdev(values: number[]): number | null {
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
export function sheetOf(id: ExportId, sheetName: string, rows: ExportRow[]): ExportSheetData {
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

export function packed(id: ExportId, sheets: ExportSheetData[], basis?: FteBasis): CollectedExport {
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
export interface ScopeRow {
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
export async function loadScope(companyId: string | null): Promise<ScopeRow[]> {
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
export function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row) || {};
  return (value as Row) || {};
}

export interface OrgLabel {
  code: string;
  name: string;
}

/** org_unit_id → 조직코드·조직명. 쿼리 1회. */
export async function loadOrgUnits(companyId: string | null): Promise<Map<string, OrgLabel>> {
  const rows = await fetchAll('조직 목록 조회', () => {
    let q = db().from('org_units').select('id, code, name');
    if (companyId) q = q.eq('company_id', companyId);
    return q;
  });
  return new Map(rows.map((r) => [str(r.id), { code: str(r.code), name: str(r.name) }]));
}

export interface TaskRow {
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
export async function loadTasks(jobIds: string[]): Promise<TaskRow[]> {
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
export async function loadTaskSuggestions(reviewIds: string[]): Promise<Row[]> {
  return fetchByIds('신규 과업 제안 조회', reviewIds, (ids) =>
    db()
      .from('new_task_suggestions')
      .select('id, review_id, name, description, reason')
      .in('review_id', ids)
      .order('created_at'),
  );
}

/** FTE 배분 한 줄을 "어느 검토의 · 어느 과업에 대한" 사실로 푼 것. */
export interface FteFact {
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
export async function loadFteFacts(
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
export const SESSION_CAP_MINUTES = 60;

export async function loadDurations(reviewIds: string[]): Promise<Map<string, number>> {
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
export async function loadJobs(companyId: string | null): Promise<JobListItem[]> {
  const result = await fetchAllJobsResult(companyId);
  if (!result.ok) qfail('직무 목록 조회', result.error);
  return result.data;
}

/** profiles.id → 이름. 감사 로그·상태 전이 이력의 '행위자' 열이 쓴다. */
export async function loadProfileNames(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
  const rows = await fetchByIds('사용자 이름 조회', ids, (part) =>
    db().from('profiles').select('id, name, email').in('id', part),
  );
  return new Map(rows.map((r) => [str(r.id), { name: str(r.name), email: str(r.email) }]));
}

// ── 내부: 공통 라벨 ─────────────────────────────────────────────────

/** E1 '항목 구분' — job_feedback.section 의 한국어 이름(계약 E1 항목 응답 열 주석 그대로). */
export const SECTION_LABELS: Record<string, string> = {
  NAME: '직무명',
  DEFINITION: '직무정의',
  REQ_EDUCATION: '요구 학력',
  REQ_MAJOR: '관련 전공',
  REQ_CERTIFICATIONS: '관련 자격증·면허',
};

export const ITEM_TASK = '주요과업';
export const ITEM_SKILL = 'Skill';
export const ITEM_NEW_TASK = '신규 과업 제안';
export const ITEM_NEW_SKILL = '신규 Skill 제안';

/** E2·E3 '과업 구분'. */
export const TARGET_LABELS: Record<FteTargetType, string> = {
  EXISTING: '기존',
  SUGGESTED: '신규 제안',
};

// ────────────────────────────────────────────────────────────────────
