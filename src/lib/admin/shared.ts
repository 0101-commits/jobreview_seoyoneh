/*
 * 관리자 API 공용 계층 — 화면 조회 함수들이 함께 쓰는 실패 처리·값 변환 (v2 D5 파일 분해).
 *
 * 원래 adminApi.ts 한 파일(1,409줄)에 조직 트리·진행 매트릭스·신호 계산·제출 큐·비교·승인/반려·
 * 워크숍 플래그·문의·대시보드 지표가 모두 있었다. 한 화면을 고칠 때 나머지 여덟 화면의 코드를
 * 함께 읽어야 했다. 그래서 주제별로 나누고 공통 조각만 이 파일에 남겼다.
 *
 * 이 모듈의 export는 폴더 안에서만 쓰는 내부 공용이다.
 * 화면이 쓰는 공개 API는 src/lib/adminApi.ts(배럴)가 정한다.
 */
import { supabase } from '../supabase';
import type { ApiResult } from '../jobApi';

/*
 * 폴더 안 재수출 — 주제별 파일이 import 경로를 두 벌 갖지 않게 한다.
 * 밖(화면)에서 쓸 것은 배럴(src/lib/adminApi.ts)이 정한다.
 */
export { supabase } from '../supabase';
export { fetchAllPages, fetchPagesByIds } from '../paging';
export { fetchAllJobsResult } from '../jobApi';
export { fetchJobReviewFeedback } from '../reviewApi';
export type { ReviewStatus, SmeReviewFeedback, Suitability } from '../reviewApi';
export type { FteTargetType, InquiryStatus } from '../surveyApi';
export { SIGNAL_LABELS, WORKSHOP_REASONS, WORKSHOP_THRESHOLDS } from '../workshopThresholds';

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
export type { ApiResult } from '../jobApi';

// ── 내부 헬퍼 ───────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));

/** PostgREST가 1:1 관계를 객체로 줄 때와 배열로 줄 때를 모두 받아 준다(reviewApi.ts와 같은 헬퍼). */
export function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row) || {};
  return (value as Row) || {};
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/**
 * 조회·쓰기 실패. 화면이 그대로 띄울 수 있도록 "무엇이" 실패했는지까지 문구에 담는다
 * (reviewApi.fail과 같은 형태 — 원인 메시지만 주면 화면마다 앞말을 따로 붙이게 된다).
 */
export function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[adminApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

/** 서버에 보내기 전에 클라이언트가 먼저 막는 입력 오류. 서버 문구와 같은 말을 쓴다. */
export function invalid<T>(message: string): ApiResult<T> {
  return { ok: false, error: message };
}

/** 로그인한 관리자 id. decided_by·answered_by 기록용이라 못 얻어도 저장 자체는 진행한다. */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export const byKorean = (a: string, b: string) => a.localeCompare(b, 'ko');

/** 오늘 자정(로컬)을 UTC 밀리초로. 두 함수가 같은 기준으로 날짜를 세게 한다. */
export function todayLocal(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * 'YYYY-MM-DD'까지 남은 날짜 수. 오늘이면 0, 지났으면 음수. 형식이 다르면 null.
 * survey_settings.due_date처럼 시간대가 없는 date 컬럼 전용이다 — 시각이 붙은 값에는 daysSince를 쓴다.
 */
export function daysUntil(date: string): number | null {
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
export function daysSince(timestamp: string): number | null {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const then = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((todayLocal() - then) / 86400000);
}
