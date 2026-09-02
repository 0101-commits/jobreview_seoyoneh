// 소요 실측(R4) — review_sessions를 "직무당 소요" 통계로 집계한다.
// PLAN §6-1 「소요 실측(R4)」 · §11-2 Phase 5 2번 · §12 오픈이슈 1.
//
// 이 수치의 쓰임은 하나다: 착수보고 11면의 "현업 SME 1인당 예상 소요 — 직무당 약 ○○분(착수 후 확정)"을
// 파일럿 실측으로 채우는 것(§12 오픈이슈 1). 그래서 "그럴듯한 숫자"보다 "말할 수 있는 숫자"가 먼저다 —
// 표본이 모자라면 아래 MIN_SAMPLE 규칙대로 숫자를 내지 않는다.
//
// ── 관리자 전용 ──
// §6-1은 "화면에는 예상 소요 약 N분(관리자 설정값)만 표시하고, 실측치는 관리자 화면에서만
// 노출한다(SME 압박 방지)"라고 못박았다. 그래서 화면 분기에 기대지 않고 조회 자체를 역할로 막는다.
// SME 계정도 RLS상 본인 세션은 읽을 수 있으므로(20260901020000 review_sessions_access_select),
// 화면만 감추는 방식은 "안 보이는" 것일 뿐 "못 얻는" 것이 아니다.
//
// ── exportApi.ts(E5)와의 관계 · 왜 여기서 다시 세는가 ──
// 같은 계산이 exportApi.ts에 이미 있다(loadDurations = 검토별 분 합계, median). 다만 둘 다
// 모듈 안에서만 쓰는 비공개 함수이고 이번 작업에서 exportApi.ts는 수정 대상이 아니다.
// 밖에서 부를 수 있는 것은 collectE5(companyId) 하나인데,
//   ① audit_logs 전체·상태 전이 이력까지 끌어와 시트 3장을 만든다 — 대시보드 카드 한 장에는 과한 비용이고
//   ② review_sessions.step을 아예 조회하지 않아 단계별 중앙값을 낼 수 없다(§6-1 "부담 최소화"의 실측 근거).
// 그래서 이 파일이 세션을 한 번 읽어 직접 집계한다. 대신 규칙(①~③)·상한(SESSION_CAP_MINUTES)·
// 표본 기준(isComparableReview)은 exportApi와 같은 값을 쓴다 — 한쪽만 바꾸면 대시보드 숫자와
// E5 파일의 숫자가 갈리고, 그 순간 이 값은 근거가 아니라 분쟁거리가 된다.
// exportApi.ts를 손댈 수 있게 되면 loadDurations·median에 export만 붙여 여기서 import하는 편이 낫다.

import { supabase } from './supabase';
import { isComparableReview } from './adminApi';
import { fetchOperationSettings } from './settingsApi';
import { STEP_TITLES } from '@/pages/sme-review/copy';
import type { ApiResult } from './jobApi';
import type { ReviewStatus } from './reviewApi';

type Row = Record<string, unknown>;

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
/** 분은 소수 첫째 자리면 충분하다(exportApi의 round1과 같은 자릿수). */
const round1 = (v: number): number => Math.round(v * 10) / 10;

// ── 집계 규칙 상수 ──────────────────────────────────────────────────

/**
 * 한 세션 구간의 상한(분). 넘으면 버리지 않고 이 값으로 자른다.
 *
 * 기획안에 없는 값이라 근거를 적는다: §10 P3의 목표가 "직무당 총 소요 20~30분"이므로
 * 마법사 한 단계에 한 시간을 넘게 머무는 것은 작성이 아니라 화면을 켜 둔 채 자리를 비운 것으로 본다.
 * 버리지 않고 자르는 이유는, 그 구간을 통째로 버리면 실제로 오래 걸린 검토가 표본에서 사라져
 * 중앙값이 반대로 낮아지기 때문이다. 파일럿 실측으로 다시 볼 값이라 상수로 뺐다(§12 오픈이슈 1).
 * exportApi.ts의 SESSION_CAP_MINUTES와 같은 값이어야 한다.
 *
 * 모듈 안에서만 쓴다(밖에서 부르는 곳이 없다). 값을 밖에서 보여 줄 일이 생기면 그때 열면 된다.
 */
const SESSION_CAP_MINUTES = 60;

/**
 * 중앙값을 숫자로 말하기 위한 최소 표본 수. 이것도 기획안에 없는 값이라 근거를 적는다.
 *
 * 2건이면 "중앙값"은 두 값의 평균일 뿐이고, 그 수가 그대로 착수보고의 "직무당 약 ○○분"이 되면
 * 한 사람의 그날 컨디션이 계약 문구가 된다. 3건 미만이면 숫자 대신 "표본 부족"을 돌려준다
 * (lowSample=true). 파일럿 규모(내부 2~3인, §10 P5)에서는 이 경고가 기본 상태에 가깝다.
 */
export const MIN_SAMPLE = 3;

/**
 * review_sessions.step → 화면 이름. 0은 시작 가이드, 1~5는 §6-2 마법사 단계 이름이다.
 *
 * 1~5는 copy.ts의 STEP_TITLES에서 가져온다. 예전에는 같은 다섯 문장을 여기에 그대로 옮겨
 * 적어 두었는데, 그러면 §6-2 문언이 바뀔 때 마법사 화면만 바뀌고 이 카드의 단계 이름은
 * 옛 문장으로 남는다 — 화면과 실측 보고서가 서로 다른 단계 이름을 쓰게 된다.
 * copy.ts는 런타임 의존이 없는 문구 모음이라 lib에서 불러도 안전하다(그 파일 머리주석).
 * 0(시작 가이드)만 여기서 적는다 — 마법사 단계가 아니라 §6-1 가이드 화면이라 STEP_TITLES에 없다.
 *
 * 모듈 안에서만 쓴다. 밖에는 집계 결과(StepDuration.label)로만 나간다.
 */
const STEP_LABELS: Record<number, string> = {
  0: '시작 가이드',
  ...Object.fromEntries(STEP_TITLES.map((title, i) => [i + 1, title])),
};

// ── 공개 타입 ───────────────────────────────────────────────────────

/** 집계 대상 검토. 대시보드가 이미 들고 있는 검토 현황 행을 그대로 넘기면 된다. */
export interface DurationReviewRef {
  reviewId: string | null;
  /** reviews.status 원문. 표본 판정(isComparableReview)에만 쓴다. */
  status: string | null;
}

export interface StepDuration {
  step: number;
  label: string;
  /** 그 단계에 머문 시간의 중앙값(분). 기록이 없으면 null(0이 아니다). */
  medianMinutes: number | null;
  /** 그 단계에 기록이 남은 검토 수. */
  sampleSize: number;
}

/**
 * 운영 설정 「예상 소요」를 읽었는가. 셋을 구분한다 — 하나로 뭉치면 화면이 거짓말을 한다.
 *  - `LOADED`         읽었다. expectedMinutes가 값이면 설정값, null이면 관리자가 비워 둔 것이다.
 *  - `ALL_COMPANIES`  계열사 '전체'라 읽지 않았다. 회사마다 값이 달라 하나로 합칠 수 없다.
 *  - `FAILED`         읽으려다 실패했다. 조회 실패를 "설정이 비어 있음"으로 위장하지 않는다 —
 *                     관리자가 이미 넣어 둔 값을 화면이 "안 넣으셨습니다"로 되돌려 말하게 된다.
 */
export type ExpectedSource = 'LOADED' | 'ALL_COMPANIES' | 'FAILED';

export interface DurationStats {
  /** 직무당(=검토 한 건당) 소요 중앙값(분). 기록이 없으면 null. */
  medianMinutes: number | null;
  /** 소요 기록이 남은 완료 검토 수. 중앙값의 분모다. */
  sampleSize: number;
  /** sampleSize < MIN_SAMPLE. 참이면 medianMinutes를 확정 수치로 쓰면 안 된다. */
  lowSample: boolean;
  /** 완료로 판정됐으나 세션 기록이 없어 분모에서 빠진 검토 수(§ 규칙 ①). */
  missingRecordCount: number;
  /** 단계별 중앙값. 기록이 하나도 없는 단계도 자리를 지킨다(0~5 전부). */
  steps: StepDuration[];
  /**
   * 운영 설정(survey_settings.expected_minutes)의 "예상 소요 N분".
   * expectedSource가 `LOADED`일 때만 뜻이 있다 — 그 외에는 늘 null이고, 그 null은
   * "설정이 비었다"가 아니라 "읽지 않았다/읽지 못했다"이다.
   */
  expectedMinutes: number | null;
  /** 위 값을 어디서 얻었는가. 화면은 이 값으로 안내 문구를 가른다. */
  expectedSource: ExpectedSource;
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[durationApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

// ── 내부: 조회 ──────────────────────────────────────────────────────

/** 한 번에 읽어 오는 행 수(PostgREST 기본 상한과 같은 값). */
const PAGE = 1000;
/** in() 한 번에 넘기는 id 수. URL 길이 때문에 나눈다. */
const IN_CHUNK = 100;

/**
 * 관리자인가. profiles.role을 직접 확인한다.
 *
 * 서버의 is_admin()과 같은 원천(profiles.role)을 보되, 여기서 막는 것은 권한이 아니라 노출이다 —
 * 권한은 RLS가 이미 막고 있고, 이 함수가 막는 것은 "SME에게 실측치를 보여 주지 않는다"는 §6-1 규칙이다.
 */
async function isAdminViewer(): Promise<boolean> {
  const client = supabase;
  if (!client) return false;
  const { data: auth } = await client.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return false;
  const { data, error } = await client.from('profiles').select('role').eq('id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  return str((data as Row | null)?.role) === 'admin';
}

/**
 * 대상 검토의 세션 전부. 청크(in)와 페이지(range)를 모두 나눈다.
 *
 * 페이지를 나누는 이유: PostgREST는 상한을 넘겨도 오류 없이 앞부분만 준다. 한 검토가 단계마다
 * 여러 번 드나들면(자동 저장·재진입) 세션 행은 검토 수의 몇 배가 되므로, 페이지를 나누지 않으면
 * 조용히 잘린 표본으로 중앙값을 내게 된다. 정렬(id) 없이 range를 나누면 중복·누락이 생기므로
 * 정렬을 반드시 건다(exportApi.PAGE_ORDER_KEY와 같은 이유).
 */
async function loadSessions(reviewIds: string[]): Promise<Row[]> {
  const client = supabase;
  if (!client) throw new Error(NO_DB);
  const out: Row[] = [];
  for (let i = 0; i < reviewIds.length; i += IN_CHUNK) {
    const part = reviewIds.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('review_sessions')
        .select('review_id, step, started_at, ended_at')
        .in('review_id', part)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data as Row[] | null) ?? [];
      out.push(...rows);
      // 마지막 장은 PAGE보다 짧다. 정확히 PAGE면 한 장 더 확인한다(빈 응답으로 끝난다).
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

// ── 내부: 집계 ──────────────────────────────────────────────────────

/** 짝수 개면 가운데 두 값의 평균, 홀수 개면 가운데 값. 빈 배열이면 null(0이 아니다). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 세션 행 → 검토별·(검토,단계)별 소요 합계(분).
 *
 * 규칙 세 가지 — exportApi.loadDurations와 같은 규칙이다. 중앙값이 오염되지 않게 하는 최소 장치다.
 *  ① ended_at이 없는 구간(브라우저를 그냥 닫은 경우)은 세지 않는다. "지금까지"로 채우면 어제 열어 둔
 *     탭이 수천 분으로 잡히고, 0으로 채우면 실제 작업 시간이 사라진다. 한 검토의 모든 세션이 열린 채면
 *     그 검토는 소요 기록이 없는 것으로 보고 분모에서도 뺀다(빈칸, 0 아님).
 *  ② 한 구간이 SESSION_CAP_MINUTES를 넘으면 그 값으로 자른다(버리지 않는다). 근거는 위 상수 주석.
 *  ③ ended_at < started_at(기기 시계 어긋남)인 구간은 버린다. 음수 소요는 사실이 아니다.
 *
 * 한 검토가 같은 단계를 여러 번 드나든 경우는 그 단계 안에서 더한다 — SME가 체감하는 "그 단계에
 * 쓴 시간"은 방문 횟수가 아니라 합계다.
 *
 * 순수 함수로 떼어 둔다(조회와 분리). 이 파일에서 사실이 만들어지는 곳은 여기 한 군데뿐이다.
 * 밖에서 부르는 곳은 없다 — 이 파일이 내보내는 것은 집계가 끝난 DurationStats 하나다.
 */
function sumSessions(rows: Row[]): {
  byReview: Map<string, number>;
  byReviewStep: Map<string, Map<number, number>>;
} {
  const byReview = new Map<string, number>();
  const byReviewStep = new Map<string, Map<number, number>>();

  for (const r of rows) {
    const reviewId = str(r.review_id);
    if (!reviewId) continue;
    const startedAt = Date.parse(str(r.started_at));
    const endedAt = Date.parse(str(r.ended_at));
    if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) continue; // ①
    const minutes = (endedAt - startedAt) / 60000;
    if (minutes < 0) continue; // ③
    const capped = Math.min(minutes, SESSION_CAP_MINUTES); // ②

    byReview.set(reviewId, (byReview.get(reviewId) ?? 0) + capped);

    const step = int(r.step);
    if (!Number.isInteger(step)) continue; // 단계를 모르면 단계별 집계에서만 뺀다(총합에는 남는다)
    let steps = byReviewStep.get(reviewId);
    if (!steps) {
      steps = new Map<number, number>();
      byReviewStep.set(reviewId, steps);
    }
    steps.set(step, (steps.get(step) ?? 0) + capped);
  }

  return { byReview, byReviewStep };
}

// ── 공개 함수 ───────────────────────────────────────────────────────

/**
 * 직무당 소요 통계. 관리자가 아니면 data=null을 돌려준다(오류가 아니라 "볼 값이 없다"이다).
 *
 * reviews는 대시보드가 이미 조회해 둔 검토 현황을 그대로 넘긴다 — 같은 범위(계열사 필터)를
 * 두 번 조회하지 않기 위해서다. 실제 왕복은 역할 확인 1회 + 세션 조회(청크·페이지) + 설정 1회다.
 *
 * 표본은 "끝까지 마친 검토"만이다(isComparableReview — 승인은 status를 SUBMITTED/RESUBMITTED로
 * 그대로 두므로 이 판정에 이미 포함된다). E5 '소요 실측 요약' 시트와 같은 기준이다. 작성 중 검토를
 * 섞으면 STEP 1만 열어 본 6분짜리가 중앙값을 끌어내려 착수보고 11면의 "○○분"과 무관한 값이 된다.
 * 반려(REVIEW_REQUESTED)도 빠진다 — 재작성 대기 중이라 아직 끝나지 않은 검토다.
 */
export async function fetchDurationStats(
  reviews: DurationReviewRef[],
  companyId: string | null,
): Promise<ApiResult<DurationStats | null>> {
  if (!supabase) return fail('소요 실측 조회', NO_DB);

  try {
    if (!(await isAdminViewer())) return ok(null);

    const completedIds = reviews
      .filter((r) => r.reviewId && isComparableReview((r.status as ReviewStatus | null) ?? null))
      .map((r) => r.reviewId as string);

    const { byReview, byReviewStep } = sumSessions(await loadSessions(completedIds));

    const totals: number[] = [];
    const stepValues = new Map<number, number[]>();
    let missingRecordCount = 0;

    for (const reviewId of completedIds) {
      const total = byReview.get(reviewId);
      if (total === undefined) {
        missingRecordCount += 1; // 규칙 ① — 기록이 없는 검토는 분모에서도 뺀다
        continue;
      }
      totals.push(total);
      for (const [step, minutes] of byReviewStep.get(reviewId) ?? []) {
        const list = stepValues.get(step);
        if (list) list.push(minutes);
        else stepValues.set(step, [minutes]);
      }
    }

    const steps: StepDuration[] = Object.keys(STEP_LABELS)
      .map(Number)
      .sort((a, b) => a - b)
      .map((step) => {
        const values = stepValues.get(step) ?? [];
        const med = median(values);
        return {
          step,
          label: STEP_LABELS[step],
          medianMinutes: med === null ? null : round1(med),
          sampleSize: values.length,
        };
      });

    // 운영 설정은 회사 1행이다. 계열사 '전체'에서는 회사마다 값이 다르므로 하나로 합치지 않고
    // 읽지 않는다(대시보드 마감일 D-day가 같은 이유로 '전체'에서 비는 것과 같은 규칙).
    let expectedMinutes: number | null = null;
    let expectedSource: ExpectedSource = 'ALL_COMPANIES';
    if (companyId) {
      const settings = await fetchOperationSettings(companyId);
      if (settings.ok) {
        expectedMinutes = settings.data?.expected_minutes ?? null;
        expectedSource = 'LOADED';
      } else {
        // 설정 조회가 실패해도 실측치는 살린다(비교만 못 한다). 다만 실패를 '전체 선택'이나
        // '설정 비어 있음'과 같은 상태로 돌려주지는 않는다 — 화면이 엉뚱한 안내를 하게 된다.
        expectedSource = 'FAILED';
      }
    }

    const total = median(totals);
    return ok({
      medianMinutes: total === null ? null : round1(total),
      sampleSize: totals.length,
      lowSample: totals.length < MIN_SAMPLE,
      missingRecordCount,
      steps,
      expectedMinutes,
      expectedSource,
    });
  } catch (e) {
    return fail('소요 실측 조회', e instanceof Error ? e.message : String(e));
  }
}
