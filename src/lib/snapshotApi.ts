import { supabase } from './supabase';
import { logAudit } from './auditApi';
import { exportFileName, saveBlob } from './exportFile';
import type { ApiResult } from './jobApi';

/*
 * 수동 스냅샷 — 주요 테이블 JSON 일괄 내려받기(ADMIN).
 * 근거: §8 S7(백업 — "주요 테이블 수동 스냅샷 Export(관리자 버튼)") · §11-2 Phase 4 4번 · §12 오픈이슈 8.
 *
 * ── 이것은 백업이지 산출물이 아니다 ──
 * §9 Export 5종(E1~E5)은 계약 산출물의 원천이라 열 이름·시트 구성이 계약으로 고정돼 있다
 * (src/lib/exportSchema.ts). 스냅샷은 그 반대다 — 사람이 읽는 표가 아니라 "이 시점의 DB를
 * 그대로 되살릴 수 있는가"만 본다. 그래서 열을 고르거나 이름을 바꾸지 않고 테이블을 통째로 담는다.
 * 열을 예쁘게 고른 백업은 복원 시점에 반드시 모자란다.
 *
 * ── 계열사로 나누지 않는다 ──
 * 회사 필터를 받지 않는다. reviews·*_feedback·task_fte_allocations 에는 company_id 가 없어
 * 회사로 자르려면 jobs → reviews → feedback 을 따라가며 걸러야 하는데, 한 군데라도 어긋나면
 * 참조가 끊긴 채 "복원되지 않는 백업"이 만들어진다. 백업은 전부이거나 아니거나다.
 *
 * ── 실패를 0건으로 위장하지 않는다 ──
 * 한 테이블이라도 조회에 실패하면 파일을 만들지 않고 실패를 그대로 돌려준다.
 * 절반짜리 백업은 백업이 아니라 오해다.
 */

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[snapshotApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

// ── 개인정보 판단(§8 S6 ↔ S7) ───────────────────────────────────────

/**
 * profiles 를 스냅샷에 넣는가 — 넣는다. 그 판단의 근거를 여기 남긴다.
 *
 * 충돌 지점: S6(개인정보 최소화)는 "필요 없는 개인정보를 두지 말라"고 하고,
 * S7(백업)은 "주요 테이블을 스냅샷으로 남기라"고 한다.
 *
 * 넣는 쪽을 택한 이유: 응답 데이터(reviews · *_feedback · task_fte_allocations · review_sessions)는
 * 전부 profiles.id(uuid)로만 사람을 가리킨다. profiles 를 빼면 남는 것은 uuid 뿐이라
 * "누가 어느 직무를 검토했는가"를 복원할 수 없다. 그 상태의 파일은 백업이 아니라 uuid 더미이고,
 * §9 E1(SME 성명·이메일이 열로 들어간다)·E5(행위자)의 재생성도 불가능하다.
 * S6 이 금지하는 것은 '불필요한 수집'이지 '이미 수집한 것의 백업'이 아니다.
 *
 * 대신 두 가지를 지킨다.
 *   ① 열을 최소로 자른다 — 아래 PROFILE_COLUMNS. S6 이 허용한 수집 항목(성명·이메일·조직·직급)과
 *      참조에 필요한 키만 담는다. 비밀번호 해시는 auth.users 에 있고 여기서 건드리지 않는다.
 *   ② 파일명과 화면 안내에 '개인정보 포함'을 반드시 붙인다 — 받는 사람이 이 파일을 메신저나
 *      공용 폴더에 아무렇게나 두지 않도록. 파기 시점은 §12 오픈이슈 6에서 정한다.
 *
 * "개인정보 없는 버전"을 옵션으로 두지 않았다. 두 파일이 같은 이름 모양으로 굴러다니면
 * 정작 복원이 필요한 날 사람이 uuid 뿐인 파일을 집어 든다. 백업은 한 종류만 있어야 한다.
 */
export const SNAPSHOT_INCLUDES_PERSONAL_DATA = true;

/** 화면·파일명에 붙일 경고. 화면은 이 문구를 그대로 보여 준다. */
export const PERSONAL_DATA_WARNING =
  '이 파일에는 개인정보(성명·이메일·소속·직급)가 포함됩니다. 사내 보관 규정에 따라 다루고, 공용 저장소·메신저에 두지 마세요.';

/** S6 이 허용한 수집 항목 + 참조 키만. profiles 에서 이 열들만 담는다. */
const PROFILE_COLUMNS =
  'id, email, name, organization, title, role, active, company_id, employee_number, org_unit_id, ' +
  'assigned_group_id, assigned_series_id, assigned_job_id, must_change_password, guide_completed_at, created_at, updated_at';

// ── 대상 테이블 ─────────────────────────────────────────────────────

interface SnapshotTable {
  name: string;
  /** 조회할 열. '*' 이면 전부(백업이므로 기본이 전부다). profiles 만 예외로 열을 자른다. */
  columns: string;
  /**
   * 페이지 나눔의 기준 열. PostgREST 의 range 는 정렬이 없으면 페이지 사이에 순서가 흔들려
   * 같은 행이 두 번 오거나 빠질 수 있다. 기본 키를 쓴다.
   */
  orderBy: string;
  /** 왜 이 표가 백업 대상인가. */
  note: string;
}

/**
 * 스냅샷 대상. 순서 = 복원 순서다(부모 먼저). 참조가 있는 표를 먼저 넣으면 되살릴 때 FK 가 걸린다.
 *
 * 뺀 것: auth.users(Supabase 관리 영역이라 이 클라이언트로 읽을 수 없다 — 계정 자체의 복구는
 * Supabase 프로젝트 백업의 일이다), 뷰·함수·정책(마이그레이션 파일이 원천이다).
 */
/*
 * 화이트리스트다. 새 표를 자동으로 담지 않는다 — 그래서 account_password_vault(비밀번호 암호문)는
 * 여기 없고, 앞으로도 넣지 않는다. 스냅샷은 브라우저로 내려받아 파일로 남는 산출물이라,
 * 그 안에 들어간 값은 DB 권한 바깥으로 나간다.
 */
export const SNAPSHOT_TABLES: SnapshotTable[] = [
  // ── 마스터: 업로드로 들어온 원본. 이게 없으면 응답이 무엇에 대한 응답인지 알 수 없다.
  { name: 'companies', columns: '*', orderBy: 'id', note: '계열사 마스터' },
  { name: 'org_units', columns: '*', orderBy: 'id', note: '조직 트리(§7-1 ① · R8 조직별 분석의 원천)' },
  { name: 'job_groups', columns: '*', orderBy: 'id', note: '직군' },
  { name: 'job_series', columns: '*', orderBy: 'id', note: '직렬' },
  { name: 'jobs', columns: '*', orderBy: 'id', note: '직무' },
  { name: 'job_tasks', columns: '*', orderBy: 'id', note: '주요과업 — FTE 배분의 대상' },
  { name: 'task_activities', columns: '*', orderBy: 'id', note: '세부활동' },
  { name: 'job_skills', columns: '*', orderBy: 'id', note: 'Skill' },
  { name: 'job_requirements', columns: '*', orderBy: 'id', note: '수행요건(학력·전공·자격증)' },

  // ── 사람·배정: 응답을 사람에 잇는 고리. 개인정보가 여기 들어 있다.
  { name: 'profiles', columns: PROFILE_COLUMNS, orderBy: 'id', note: '계정(개인정보 포함 — 위 판단 근거 참조)' },
  { name: 'review_assignments', columns: '*', orderBy: 'id', note: 'SME ↔ 직무 배정(R6 1~2명 규칙의 기록)' },

  // ── 응답 원본: 이 프로젝트의 산출물 전부가 여기서 나온다(§9 E1~E3).
  { name: 'reviews', columns: '*', orderBy: 'id', note: '검토 1건(5상태 · 제출·승인 시각)' },
  { name: 'job_feedback', columns: '*', orderBy: 'id', note: '직무명·정의·수행요건 적합성 응답' },
  { name: 'task_feedback', columns: '*', orderBy: 'id', note: '과업 적합성 응답' },
  { name: 'skill_feedback', columns: '*', orderBy: 'id', note: 'Skill 적합성 응답' },
  { name: 'new_task_suggestions', columns: '*', orderBy: 'id', note: '신규 과업 제안(워크숍 자동 규칙 ③의 원천)' },
  { name: 'new_skill_suggestions', columns: '*', orderBy: 'id', note: '신규 Skill 제안' },
  { name: 'task_fte_allocations', columns: '*', orderBy: 'id', note: '투입 비중 배분(§9 E2 · 계약 1-(4)의 원천)' },

  // ── 운영·이력: 검수 자리에서 "언제 무엇이 있었는가"를 답하는 표들(§9 E5).
  { name: 'review_history', columns: '*', orderBy: 'id', note: '상태 전이 이력(반려 사유 포함)' },
  { name: 'review_sessions', columns: '*', orderBy: 'id', note: '소요 실측(§9 E5 직무당 중앙값의 원천)' },
  { name: 'inquiries', columns: '*', orderBy: 'id', note: '문의·답변' },
  { name: 'job_workshop_flags', columns: '*', orderBy: 'job_id', note: '워크숍 대상 지정과 사유(§9 E4)' },
  { name: 'survey_settings', columns: '*', orderBy: 'company_id', note: '운영 설정(마감일·예상 소요·가이드 문구)' },
  { name: 'upload_history', columns: '*', orderBy: 'id', note: '업로드 이력' },
  { name: 'mail_logs', columns: '*', orderBy: 'id', note: '메일 발송 이력(시뮬레이션 여부 포함)' },
  { name: 'audit_logs', columns: '*', orderBy: 'id', note: '감사 로그' },
];

/** PostgREST 한 번 조회의 기본 상한이 1000행이다. 그보다 큰 표는 나눠 읽는다. */
const PAGE_SIZE = 1000;

/**
 * 표 하나의 상한. 넘으면 자르지 않고 실패로 돌린다 —
 * 조용히 잘린 백업은 없는 백업보다 나쁘다(복원할 때까지 아무도 모른다).
 * 이 한도에 닿았다면 브라우저 다운로드가 아니라 Supabase 프로젝트 백업으로 가야 할 규모다.
 */
const MAX_ROWS_PER_TABLE = 50_000;

// ── 결과 타입 ───────────────────────────────────────────────────────

export interface SnapshotFile {
  /** 이 파일의 형식 판(version). 대상 표가 바뀌면 올린다. */
  snapshot_version: string;
  generated_at: string;
  /** 만든 사람(profiles.id). 모르면 null. */
  generated_by: string | null;
  /** true면 개인정보가 들어 있다. 받는 쪽이 파일만 보고도 알 수 있어야 한다. */
  contains_personal_data: boolean;
  personal_data_notice: string;
  /** 표별 행 수. 복원 후 대조용이다. */
  row_counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

export const SNAPSHOT_VERSION = '1.0';

// ── 조회 ────────────────────────────────────────────────────────────

/** 표 하나를 끝까지 읽는다. 1000행 상한에 걸려 조용히 잘리지 않도록 페이지를 돌린다. */
async function fetchAllRows(table: SnapshotTable): Promise<ApiResult<Record<string, unknown>[]>> {
  if (!supabase) return fail(`${table.name} 조회`, NO_DB);

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table.name)
      .select(table.columns)
      .order(table.orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return fail(`${table.name} 조회`, error.message);

    const page = (data || []) as unknown as Record<string, unknown>[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    if (rows.length >= MAX_ROWS_PER_TABLE)
      return fail(
        `${table.name} 조회`,
        `행이 ${MAX_ROWS_PER_TABLE.toLocaleString('ko-KR')}건을 넘어 브라우저에서 내려받을 수 없습니다. Supabase 프로젝트 백업을 이용해 주세요.`,
      );
  }
  return ok(rows);
}

/**
 * 스냅샷 한 덩어리를 만든다. 파일로 저장하지는 않는다(그건 downloadSnapshot 이 한다).
 * 표 하나라도 실패하면 그 자리에서 멈추고 실패를 돌려준다.
 *
 * ponytail: 표를 순차로 읽는다(26회 왕복). 병렬로 던지면 빠르지만 실패한 표만 골라내기가
 * 지저분해지고, 스냅샷은 하루 몇 번 누르는 버튼이다. 느려지면 그때 Promise.all 로 바꾼다.
 */
export async function createSnapshot(generatedBy?: string | null): Promise<ApiResult<SnapshotFile>> {
  if (!supabase) return fail('스냅샷 생성', NO_DB);

  const tables: Record<string, Record<string, unknown>[]> = {};
  const rowCounts: Record<string, number> = {};

  for (const table of SNAPSHOT_TABLES) {
    const result = await fetchAllRows(table);
    if (!result.ok) return { ok: false, error: `스냅샷을 만들지 못했습니다. ${result.error}` };
    tables[table.name] = result.data;
    rowCounts[table.name] = result.data.length;
  }

  return ok({
    snapshot_version: SNAPSHOT_VERSION,
    generated_at: new Date().toISOString(),
    generated_by: generatedBy ?? null,
    contains_personal_data: SNAPSHOT_INCLUDES_PERSONAL_DATA,
    personal_data_notice: PERSONAL_DATA_WARNING,
    row_counts: rowCounts,
    tables,
  });
}

// ── 저장 ────────────────────────────────────────────────────────────

/**
 * 파일명. '개인정보포함'을 파일명에 박는다 — 파일을 받은 사람이 열어 보기 전에 알아야 한다.
 * 자리 규칙은 §9 산출물과 같게 exportFile.exportFileName 을 그대로 쓴다
 * (서연이화_스냅샷_개인정보포함_20260901.json).
 */
export function snapshotFileName(at: Date): string {
  return exportFileName(SNAPSHOT_INCLUDES_PERSONAL_DATA ? '스냅샷_개인정보포함' : '스냅샷', 'json', at);
}

/**
 * 화면이 부르는 진입점 — 만들고, 내려받고, 감사 로그를 남긴다. 만든 파일 이름을 돌려준다.
 * 실패하면 파일을 만들지 않는다.
 */
export async function downloadSnapshot(generatedBy?: string | null): Promise<ApiResult<string>> {
  const snapshot = await createSnapshot(generatedBy);
  if (!snapshot.ok) return snapshot;

  const fileName = snapshotFileName(new Date());
  saveBlob(JSON.stringify(snapshot.data, null, 2), 'application/json;charset=utf-8', fileName);

  // 감사 기록은 부수 기록이라 실패해도 던지지 않는다(auditApi 의 규약 그대로).
  // 파일에 개인정보가 들어갔다는 사실 자체를 기록에 남긴다 — 나중에 "누가 언제 받아 갔는가"를 묻는다.
  await logAudit('SNAPSHOT_EXPORTED', 'snapshot', null, {
    file_name: fileName,
    tables: SNAPSHOT_TABLES.map((t) => t.name),
    row_counts: snapshot.data.row_counts,
    contains_personal_data: SNAPSHOT_INCLUDES_PERSONAL_DATA,
  });

  return ok(fileName);
}
