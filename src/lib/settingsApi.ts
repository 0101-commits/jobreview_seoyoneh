import { supabase } from './supabase';
import { logAudit } from './auditApi';
import type { ApiResult } from './jobApi';
import type { SurveySettings } from './surveyApi';

/*
 * 운영 설정(/settings · §6-3 ⓒ "설정") 데이터 계층 — survey_settings 한 행의 조회·저장만 둔다.
 * 화면(JSX)은 src/pages/SettingsPage.tsx에 있다.
 *
 * ── 규약: adminApi.ts와 같이 ApiResult<T>로 실패를 값으로 돌려준다 ──
 * 이 화면은 저장 실패 사유를 그대로 보여 줘야 한다(빈 화면이나 "저장됨"으로 위장하면
 * 관리자가 마감일을 바꿨다고 믿은 채 SME 화면은 옛 값으로 도는 상황이 생긴다).
 * 실패가 값이면 `if (!res.ok) show(res.error)` 분기를 타입 검사가 강제한다.
 *
 * ── surveyApi.fetchSurveySettings를 그대로 쓰지 않는 이유 ──
 * 그 함수는 fte_required를 select 하지 않는다(SME 화면이 쓸 일 없는 컬럼이라 뺀 것이다).
 * 제출 게이트 스위치를 켜고 끄는 화면에서 그 한 컬럼만 두 번째 쿼리로 따로 읽을 이유가 없어
 * 여기서 한 번에 읽는다. 값 타입은 그쪽 SurveySettings를 넓혀 쓴다 — 두 파일이 같은 행을
 * 서로 다른 모양으로 부르지 않게 하기 위해서다.
 *
 * ── 쓰기 권한 ──
 * survey_settings의 INSERT·UPDATE 정책은 public.is_admin()이다(20260901020000 ⑦).
 * 관리자가 아닌 사용자의 저장은 서버가 거부하며, 화면도 컴포넌트에서 한 번 더 막는다.
 */

/** 화면이 import 두 줄을 쓰지 않도록 결과 타입을 여기서 다시 내보낸다. 정의는 jobApi.ts에 있다. */
export type { ApiResult } from './jobApi';

// ── 값 타입 ─────────────────────────────────────────────────────────

/**
 * 회사 1행의 운영 설정. surveyApi.SurveySettings에 제출 게이트 스위치를 더한 것이다.
 *
 * fte_required — §7-2 submit_review ③의 "FTE 합계 100%" 검사 스위치(회사 단위).
 * 꺼져 있으면 서버가 FTE_EMPTY·FTE_SUM 두 검사를 통째로 건너뛴다.
 */
export interface OperationSettings extends SurveySettings {
  fte_required: boolean;
  /** 리마인더 메일 제목 템플릿. 컬럼이 아직 없는 DB에서는 항상 ''(=기본 문구 사용). */
  reminder_subject: string;
  /** 리마인더 메일 본문 템플릿(마크다운 아님 — 치환 토큰이 든 평문). */
  reminder_body_md: string;
}

/** 저장 payload. 화면의 입력 상태와 같은 모양이다(company_id·updated_at은 저장 함수가 채운다). */
export interface OperationSettingsInput {
  /** 'YYYY-MM-DD' 또는 null(미설정). D-day 계산의 원점(§6-3 ⓐ). */
  due_date: string | null;
  /** 가이드 카드 ④ "약 N분"에 들어가는 값(§6-1). 미설정이면 null — 앱이 숫자를 지어내지 않는다. */
  expected_minutes: number | null;
  /** 가이드 추가 안내(마크다운 원문 그대로 보관). §6-1 고정 문언을 대체하지 않는다. */
  guide_md: string;
  /** 문의 화면에 노출할 담당자·연락 방법(§6-3 ⓒ). */
  inquiry_contact: string;
  fte_required: boolean;
  /** 리마인더 템플릿(§6-3 ⓒ). 둘 다 비면 mailApi.DEFAULT_TEMPLATES가 쓰인다. */
  reminder_subject: string;
  reminder_body_md: string;
}

/**
 * 예상 소요 입력 상한(분). **기획안에 없어 새로 정한 값이다.**
 * §12 오픈이슈 1번이 "파일럿 실측 중앙값으로 확정"이라 확정값이 아직 없다. 상한을 두는 이유는
 * 오타 방어 하나뿐이다 — 30을 300으로 잘못 치면 가이드 카드 ④가 "약 300분"으로 SME 전원에게
 * 나간다. 10시간(600분)은 어떤 실측 중앙값도 넘지 않을 선이라 정상값을 막지 않는다.
 */
export const EXPECTED_MINUTES_MAX = 600;

/**
 * 리마인더 템플릿 컬럼(reminder_subject · reminder_body_md)은
 * supabase/migrations/20260901050000_phase4_settings_columns.sql 에서 추가된다.
 *
 * **그 SQL이 아직 적용되지 않은 DB가 있을 수 있다.** 없는 컬럼을 select 목록에 넣으면 PostgREST가
 * 요청 전체를 42703으로 거절하므로, 마감일·문의 담당까지 못 읽는 빈 설정 화면이 된다.
 * 그래서 처음 조회 때 한 번 실패를 보고 컬럼 유무를 판정한 뒤, 없으면 나머지 컬럼만 읽는다
 * (App.tsx가 must_change_password·guide_completed_at을 다루는 방식과 같은 태도다 —
 *  마이그레이션 미적용이 화면 전체를 죽이지 않게 한다).
 *
 * 판정 결과는 모듈에 한 번만 기억한다. 스키마는 세션 도중에 바뀌지 않는다.
 *   null  아직 조회한 적 없음        true  컬럼 있음        false  컬럼 없음(SQL 미적용)
 */
let reminderColumnsPresent: boolean | null = null;

/** 화면이 리마인더 입력을 열지 말지 판단하는 값. 조회 전에는 null이다. */
export function reminderTemplateSupported(): boolean | null {
  return reminderColumnsPresent;
}

/** 미적용 DB에 붙일 안내 — 화면이 그대로 보여 준다. */
export const REMINDER_TEMPLATE_MISSING_NOTE =
  '리마인더 템플릿을 저장할 컬럼이 이 데이터베이스에 아직 없습니다. supabase/APPLY_2026-09-01_phase4.sql 을 적용하면 입력이 열립니다. 그때까지 리마인더 문구는 발송 화면의 기본 문구로 나갑니다.';

const REMINDER_COLUMNS = 'reminder_subject, reminder_body_md';

/** PostgREST의 "그런 컬럼 없음"(42703)인가. 다른 오류를 이걸로 삼키면 안 된다. */
function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42703') return true;
  return /reminder_(subject|body_md)/.test(err.message || '') && /does not exist|찾을 수 없/.test(err.message || '');
}

// ── 내부 헬퍼 ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

/** select 목록. 조회와 저장이 같은 컬럼을 읽어야 저장 직후 화면과 재조회 화면이 어긋나지 않는다. */
const SETTINGS_COLUMNS_BASE =
  'company_id, due_date, expected_minutes, guide_md, inquiry_contact, fte_required, updated_at';

/** 컬럼이 없다고 판정된 뒤에는 리마인더 두 컬럼을 빼고 읽는다. */
function settingsColumns(): string {
  return reminderColumnsPresent === false ? SETTINGS_COLUMNS_BASE : `${SETTINGS_COLUMNS_BASE}, ${REMINDER_COLUMNS}`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v) || null;

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/** 조회·저장 실패. adminApi.fail과 같은 형태다 — 화면이 앞말을 따로 붙이지 않아도 되게 한다. */
function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[settingsApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

/** 서버에 보내기 전에 먼저 막는 입력 오류. */
function invalid<T>(message: string): ApiResult<T> {
  return { ok: false, error: message };
}

function toSettings(r: Row): OperationSettings {
  return {
    company_id: str(r.company_id),
    due_date: str(r.due_date) || null,
    expected_minutes: numOrNull(r.expected_minutes),
    guide_md: str(r.guide_md),
    inquiry_contact: str(r.inquiry_contact),
    // 컬럼은 NOT NULL DEFAULT false다. 값이 안 왔을 때 true로 보면 "켜져 있다"고 잘못 표시된다.
    fte_required: r.fte_required === true,
    // 컬럼이 없는 DB에서는 값이 오지 않는다. 빈 문자열 = "저장된 템플릿 없음"이고, 그때는 기본 문구가 나간다.
    reminder_subject: str(r.reminder_subject),
    reminder_body_md: str(r.reminder_body_md),
    updated_at: str(r.updated_at) || null,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 조회 ────────────────────────────────────────────────────────────

/**
 * 회사 1행의 운영 설정. 쿼리 1회.
 *
 * 아직 저장한 적이 없으면 data가 null이다 — **오류가 아니다.** 그 상태의 회사는
 * submit_review가 fte_required를 COALESCE(…, false)로 읽어 FTE 검사를 하지 않는다
 * (20260901030000의 ③ 블록). 화면은 이 둘을 구분해서 표시해야 한다.
 */
export async function fetchOperationSettings(companyId: string): Promise<ApiResult<OperationSettings | null>> {
  if (!supabase) return fail('운영 설정 조회', NO_DB);
  if (!companyId) return invalid('어느 회사의 설정인지 먼저 선택해 주세요.');

  const db = supabase;
  const read = () => db.from('survey_settings').select(settingsColumns()).eq('company_id', companyId).maybeSingle();

  let { data, error } = await read();

  // 리마인더 컬럼이 아직 없는 DB — 그 두 컬럼만 빼고 한 번 더 읽는다.
  // PostgREST는 행이 0건이어도 select 목록을 스키마와 대조하므로, 이 판정은 행 유무와 무관하게 선다.
  if (error && reminderColumnsPresent !== false && isMissingColumn(error)) {
    reminderColumnsPresent = false;
    console.warn(
      '[settingsApi] 리마인더 템플릿 컬럼이 없다. supabase/APPLY_2026-09-01_phase4.sql 미적용 — 나머지 설정만 읽는다.',
    );
    ({ data, error } = await read());
  } else if (!error) {
    reminderColumnsPresent = reminderColumnsPresent ?? true;
  }

  if (error) return fail('운영 설정 조회', error.message);
  return ok(data ? toSettings(data as unknown as Row) : null);
}

// ── 저장 ────────────────────────────────────────────────────────────

/**
 * 회사 1행 upsert. 행이 없으면 만들고, 있으면 갱신한다(company_id가 PK다). 쿼리 1회.
 *
 * previous는 저장 직전에 화면이 들고 있던 값이다(없으면 null = 아직 행이 없는 회사).
 * 감사 기록에 "무엇이 무엇으로 바뀌었는지"를 남기기 위해서만 쓴다 — 이 값을 서버에서 다시
 * 읽어 오면 쿼리가 한 번 더 늘 뿐, 그 사이 다른 관리자가 바꿨을 가능성은 어차피 남는다.
 *
 * ponytail: 동시 편집은 나중 저장이 이긴다(upsert 그대로). 설정 화면은 관리자 한두 명이
 * 가끔 여는 자리라 지금은 이걸로 충분하다. 충돌이 실제로 문제가 되면 updated_at 조건부
 * update로 올린다.
 */
export async function saveOperationSettings(
  companyId: string,
  input: OperationSettingsInput,
  previous: OperationSettings | null,
): Promise<ApiResult<OperationSettings>> {
  if (!supabase) return fail('운영 설정 저장', NO_DB);
  if (!companyId) return invalid('어느 회사의 설정인지 먼저 선택해 주세요.');

  // 입력 검증 — 서버가 거절할 값을 미리 같은 말로 막는다.
  if (input.due_date !== null && !DATE_RE.test(input.due_date)) {
    return invalid('마감일은 달력에서 날짜를 골라 주세요(YYYY-MM-DD).');
  }
  if (input.expected_minutes !== null) {
    if (!Number.isInteger(input.expected_minutes) || input.expected_minutes < 1) {
      return invalid('예상 소요는 1 이상의 정수(분)로 입력해 주세요. 비워 두면 가이드에서 소요 문장이 빠집니다.');
    }
    if (input.expected_minutes > EXPECTED_MINUTES_MAX) {
      return invalid(`예상 소요는 ${EXPECTED_MINUTES_MAX}분을 넘길 수 없습니다. 자릿수를 확인해 주세요.`);
    }
  }

  const payload: Row = {
    company_id: companyId,
    due_date: input.due_date,
    expected_minutes: input.expected_minutes,
    // 빈 문자열도 그대로 저장한다. 관리자가 지운 것과 처음부터 없던 것을 굳이 나눌 필요가 없다.
    guide_md: input.guide_md,
    inquiry_contact: input.inquiry_contact,
    fte_required: input.fte_required,
    // 이 저장소에는 updated_at 자동 갱신 트리거가 없다. 갱신 주체가 직접 쓰는 것이 관례다.
    updated_at: new Date().toISOString(),
  };
  // 컬럼이 있다고 **확인된** 경우에만 싣는다. 없는 컬럼을 보내면 이 요청 전체가 거절돼
  // 마감일까지 저장되지 않는다. 확인 전(null)에도 싣지 않는다 — 화면은 그 상태에서
  // 리마인더 입력을 비활성으로 두므로 관리자가 친 글이 조용히 버려지는 일은 없다.
  if (reminderColumnsPresent === true) {
    payload.reminder_subject = input.reminder_subject;
    payload.reminder_body_md = input.reminder_body_md;
  }

  const { data, error } = await supabase
    .from('survey_settings')
    .upsert(payload, { onConflict: 'company_id' })
    .select(settingsColumns())
    .maybeSingle();

  if (error) return fail('운영 설정 저장', error.message);
  if (!data) {
    // upsert는 성공했는데 돌려받은 행이 없는 경우(RLS로 select가 막힌 상황 등).
    // "저장됨"으로 넘어가면 화면이 저장되지 않은 값을 저장된 것처럼 보여 준다.
    return fail('운영 설정 저장', '저장 결과를 확인하지 못했습니다. 화면을 새로고침해 값을 확인해 주세요.');
  }
  const saved = toSettings(data as unknown as Row);

  // 감사 기록(§9 E5 "관리자 행위 로그"). logAudit은 실패해도 던지지 않는다 —
  // 저장은 이미 끝났고, 여기서 실패로 되돌리면 관리자가 같은 저장을 두 번 하게 된다.
  const changed = (Object.keys(input) as (keyof OperationSettingsInput)[]).filter((k) =>
    previous ? previous[k] !== input[k] : true,
  );
  await logAudit('SURVEY_SETTINGS_SAVED', 'survey_settings', companyId, {
    created: previous === null,
    changed,
  });

  // 제출 게이트 스위치는 별도 행위로 한 줄 더 남긴다. meta를 펼쳐 보지 않아도
  // E5의 "행위" 열만으로 "언제 누가 FTE 검사를 껐는지"가 보여야 하기 때문이다.
  if (!previous || previous.fte_required !== saved.fte_required) {
    await logAudit(
      saved.fte_required ? 'FTE_REQUIRED_ON' : 'FTE_REQUIRED_OFF',
      'survey_settings',
      companyId,
      { from: previous ? previous.fte_required : null, to: saved.fte_required },
    );
  }

  return ok(saved);
}
