/*
 * Export 5종(E1~E5) 스키마 계약 — 시트·열 정의만 둔다.
 *
 * 근거: docs/PLAN.html §9(산출물 연계 — Export 5종 = 계약 산출물 원천) · §10 P4 · §11-2 Phase 4,
 *      §2 R8(조직 단위 분석) · R10(적정 인력 산정의 원천 데이터), §7-1 스키마.
 *
 * 왜 이 파일이 따로 있는가
 * ------------------------
 * §9는 "각 Export가 어떤 계약 산출물·착수보고 문언의 원천인지 화면에 함께 표기해,
 * 12월 검수 시 이 화면이 그대로 증빙 목록이 되게 한다"고 못박는다. 즉 여기 적힌 시트명·열 이름·
 * 매핑 라벨이 그대로 검수 기준이 된다(§9 「산출물 명세표와의 연결」: "E1~E3의 필드 정의를
 * '검수 기준' 열에 그대로 인용"). 그래서 정의를 화면·쿼리·xlsx 생성 코드에 흩어 두지 않고
 * 이 파일 하나로 고정한다. 열을 고치는 일 = 검수 기준을 고치는 일이다.
 *
 * 이 파일이 하지 않는 것
 * ----------------------
 * 쿼리도, 집계도, xlsx 생성도 하지 않는다. 타입과 상수뿐이다. 실제 조회·집계·파일 생성은
 * 이 정의를 읽는 쪽(Export 센터 화면과 그 API)이 만든다. XLSX는 이미 있는 xlsx(^0.18.5)로만
 * 만든다 — 관례는 src/lib/jobApi.ts 의 exportAllJobsToExcel 이 기준이다
 * (행 = 한국어 열 이름을 키로 갖는 객체, XLSX.utils.json_to_sheet(rows, { header: 열순서 })).
 *
 * 산출 형식(§9 · §11-2 Phase 4)
 * ------------------------------
 * · XLSX — 실무용. 워크북 첫 시트는 항상 EXPORT_META_SHEET_NAME('내보내기 정보'),
 *          그다음이 아래 sheets 순서. 파일명은 `서연이화_{fileBase}_{YYYYMMDD}.xlsx`
 *          (jobApi.exportAllJobsToExcel 의 `서연이화_전체_직무정보_20260901.xlsx` 관례를 따른다).
 * · CSV  — 시트당 파일 1개. CSV에는 시트 개념이 없다. 파일명 `서연이화_{fileBase}_{시트명}_{YYYYMMDD}.csv`.
 * · JSON — 워크북 전체를 ExportJson 한 덩어리로. schema_version 이 여기 들어간다.
 *
 * 조회 실패를 "0건"으로 위장하지 않는다
 * -------------------------------------
 * 값이 없어서 빈 것과 조회가 실패해서 빈 것은 다른 사건이다. 집계 대상이 없는 칸은 빈칸으로 두고
 * (0으로 채우지 않는다), 조회가 실패하면 파일을 만들지 말고 실패를 그대로 화면에 올린다.
 * 절반만 채워진 증빙 파일이 12월 검수 자리에서 가장 나쁜 결과다.
 */

// ── 스키마 버전 ─────────────────────────────────────────────────────

/**
 * Export 산출물의 스키마 버전. JSON 산출물의 `schema_version` 필드와
 * XLSX '내보내기 정보' 시트의 '스키마 버전' 행에 이 값이 그대로 들어간다.
 *
 * 무슨 의미인가
 *   이 문서(파일)가 정의한 시트 구성·열 이름·열 순서의 판(version)이다. 받는 쪽(고객 TF,
 *   분석 담당, AI 처리 파이프라인)은 이 값만 보고 "열이 내가 아는 그 열인지"를 판단한다.
 *   참고 레포의 stdjob 4시트 + schema_version 관례를 계약 매핑 5종으로 확장한 것이다(§4-2).
 *
 * 갱신 규칙
 *   MAJOR(1.0 → 2.0) — 열 삭제, 열 이름 변경, 열 순서 변경, 값의 의미 변경, 시트 삭제·개명.
 *                      받는 쪽 파서가 깨진다. 12월 검수 기준을 바꾸는 일이므로 §12 확정 절차를 거친다.
 *   MINOR(1.0 → 1.1) — 시트·열 추가만. 기존 열은 이름·순서·의미 그대로.
 *   버전을 올렸으면 이 주석 아래 변경 이력 한 줄을 남긴다. 파일명·화면 문구는 바꾸지 않는다.
 *
 * 변경 이력
 *   1.0 (Phase 4) — 최초 확정. §9 표(E1~E5)와 §7 스키마 대조로 열을 정했다.
 *   1.1 (Phase 4 검토 반영) — E5 '소요 실측 요약'에 '구분' 열 추가(마지막 합계 행을 기계가 걸러낼 수 있게).
 *                            E4 '플래그 여부'에 '자동 후보(지정 전)' 값 추가(저장된 결정 없이 자동 규칙에만 걸린 직무).
 *                            기존 열의 이름·순서·의미는 그대로다(MINOR).
 */
export const EXPORT_SCHEMA_VERSION = '1.1';

// ── 값 타입 ─────────────────────────────────────────────────────────

export type ExportId = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

/**
 * 열 이름의 출처. §9 표에는 "구성(시트/필드 요지)"만 있고 열 이름 목록은 없다.
 * 그래서 열마다 그 이름이 어디서 왔는지를 남긴다 — 12월 검수에서 "이 열은 무슨 근거인가"를
 * 물으면 이 값이 답이 된다.
 *
 * 'PLAN'   — 기획안 문언에 그 단어가 있다(§9 구성 열 · §7-1 컬럼명 · §6 화면 문언).
 * 'REUSED' — 기존 산출물·화면의 라벨을 그대로 가져왔다(주로 jobApi.exportAllJobsToExcel).
 *            같은 것을 두 이름으로 부르지 않기 위해서다.
 * 'COINED' — 기획안에 열 이름이 없어 새로 정함.
 */
export type ColumnSource = 'PLAN' | 'REUSED' | 'COINED';

/**
 * E2의 집계 기준 토글(§9 E2 "승인 응답 기준/전체 기준 토글").
 * 'APPROVED' = 승인된 검토의 응답만, 'ALL' = 제출된 검토 전체.
 * 어느 기준으로 뽑았는지는 산출물에 반드시 남긴다(JSON의 basis, XLSX '내보내기 정보'의 '집계 기준').
 * 기준이 적히지 않은 숫자는 §9의 검수 기준
 * ("E2 Export의 직무×조직 피벗이 승인 응답 기준으로 산출 가능할 것")을 증명하지 못한다.
 */
export type FteBasis = 'APPROVED' | 'ALL';

/** 화면·산출물에 쓰는 기준 문언. §9 표의 문언 그대로다. */
export const FTE_BASIS_LABELS: Record<FteBasis, string> = {
  APPROVED: '승인 응답 기준',
  ALL: '전체 기준',
};

/**
 * 범위 종료선 문구 — §6-3 ⓒ FTE 분포 화면 하단 고정 문언(16면).
 * FTE 분포 화면과 E2·E3 산출물('내보내기 정보' 시트의 '범위 종료선' 행)이 같은 문장을 쓴다.
 * §2 하단 「범위 종료선」: 플랫폼은 FTE 분포의 수집·집계·Export까지만 하고,
 * 적정 인력의 확정 수치 산정·조직별 증감 판단은 만들지 않는다.
 * 문언을 고치지 말 것 — 착수보고 문언 = 제품 문구(§4-1 P1)다.
 */
export const FTE_SCOPE_NOTICE =
  '본 화면은 투입 비중 분포의 집계까지 제공하며, 적정 인력의 확정 수치 산정은 후속 별도 과제로 구분됩니다';

// ── 정의 타입 ───────────────────────────────────────────────────────

/** 시트의 열 하나. 순서는 배열 순서가 곧 확정 순서다. */
export interface ExportColumn {
  /** 화면·파일에 그대로 찍히는 한국어 열 이름. */
  name: string;
  /** 이 열에 무엇이 들어가는가(한 줄). */
  note: string;
  source: ColumnSource;
}

export interface ExportSheet {
  /** XLSX 시트명이자 JSON의 sheets 키. CSV 파일명에도 들어간다. */
  name: string;
  /** 한 행이 무엇인지, 어느 표에서 나오는지. */
  note: string;
  /** 열 순서 고정. */
  columns: ExportColumn[];
}

export interface ExportDefinition {
  id: ExportId;
  /** 화면에 보일 이름 — §9 표의 "Export" 열 문언 그대로. */
  name: string;
  /** §9 표의 "구성(시트/필드 요지)" 열 문언 그대로. 카드 설명으로 그대로 쓴다. */
  description: string;
  /**
   * §9 표의 "산출물 매핑" 열 라벨. 화면 카드에 칩으로 그대로 표기한다(§9·§11-2 Phase 4 1항).
   * 문언을 줄이거나 풀어 쓰지 말 것 — 이 라벨이 12월 검수의 증빙 목록 그 자체다.
   */
  deliverables: string[];
  /** 파일명 중간 토막. 기획안에 파일명 규칙이 없어 새로 정함. */
  fileBase: string;
  /** E2만 true. 승인 응답 기준/전체 기준 토글(§9 E2). */
  hasBasisToggle: boolean;
  /**
   * 계열사를 골라도 그 범위대로 잘리지 않는 시트가 있을 때의 단서(현재 E5 하나).
   * 있으면 화면 카드와 '내보내기 정보'의 '대상 회사' 값에 함께 표기한다 —
   * 받는 쪽이 파일 라벨만 보고 "이 계열사 것만 담겼다"고 읽으면 안 되기 때문이다.
   */
  scopeNote?: string;
  sheets: ExportSheet[];
}

// ── 공통: '내보내기 정보' 시트 ──────────────────────────────────────

/**
 * 모든 Export의 XLSX 첫 시트. §9의 "화면에 함께 표기"를 파일 안까지 끌고 들어간 것이다.
 * 파일만 따로 메일로 돌아다녀도 그 파일이 어느 계약 산출물의 원천이고 어떤 기준으로 언제
 * 뽑혔는지가 붙어 다녀야 증빙이 된다.
 */
export const EXPORT_META_SHEET_NAME = '내보내기 정보';

/** '내보내기 정보' 시트의 열 2개. 세로 표(항목/값)다. */
export const EXPORT_META_COLUMNS: readonly string[] = ['항목', '값'];

/**
 * '내보내기 정보' 시트의 행 순서. 다섯 Export가 모두 같은 모양이어야 비교·검수가 쉽다.
 * '집계 기준' 행은 E2에만 값이 차고 나머지는 빈칸으로 둔다(행 자체는 유지).
 */
export const EXPORT_META_ROWS: readonly string[] = [
  '스키마 버전',      // EXPORT_SCHEMA_VERSION
  'Export ID',        // 'E2'
  'Export 명',        // ExportDefinition.name
  '산출물 매핑',      // deliverables 를 ' · ' 로 이어 붙인다
  '집계 기준',        // E2만. FTE_BASIS_LABELS[basis]
  '생성 일시',        // ISO8601
  '생성자',           // 실행한 관리자 이름·이메일
  '대상 회사',        // 계열사 필터 값
  '시트별 행 수',     // '검토 목록 128 · 항목 응답 1,904'
  '범위 종료선',      // FTE_SCOPE_NOTICE
];

// ── 산출물 런타임 형태 ──────────────────────────────────────────────

/**
 * 시트 한 행. 키는 위 columns의 name과 정확히 같아야 한다.
 * 비어 있는 칸은 '' 또는 null 로 둔다 — 0으로 채우지 않는다.
 * (0%와 "응답 없음"은 다른 사실이고, E2·E3의 비중 열에서 이 차이가 곧 산출물의 신뢰다.)
 */
export type ExportRow = Record<string, string | number | null>;

/** 생성 코드가 만들어 넘기는 시트 한 장. columns는 정의의 열 순서를 그대로 복사한다. */
export interface ExportSheetData {
  name: string;
  columns: string[];
  rows: ExportRow[];
}

/**
 * JSON 산출물의 최상위 형태(§9 "CSV/JSON(schema_version 포함, 분석·AI 처리용)").
 * sheets의 키 = 시트명, 값 = 그 시트의 행 배열.
 */
export interface ExportJson {
  schema_version: string;
  export_id: ExportId;
  export_name: string;
  deliverables: string[];
  /** ISO8601. */
  generated_at: string;
  company_id: string | null;
  /** E2만. 어느 기준으로 집계했는지. */
  basis?: FteBasis;
  /** 시트명 → 행 수. 받는 쪽이 잘린 파일을 알아채는 최소 장치. */
  row_counts: Record<string, number>;
  sheets: Record<string, ExportRow[]>;
}

// ── E1 업무조사 응답 원본 ───────────────────────────────────────────

/*
 * §9 구성: "직무 × SME × 항목: 적합성 판정, 의견, 수정·삭제·신규 제안, FTE 비중, 제출·승인 시각".
 * 한 행 = 항목 하나가 되도록 긴 형태(long)로 만든다. 항목 종류(직무정의·과업·Skill·수행요건·
 * 신규 제안)마다 열을 따로 두면 표가 옆으로 늘어나 SME 수만큼 다시 늘어난다.
 * 검토 단위 정보(제출·승인 시각, 소요)는 매 행에 반복하는 대신 '검토 목록' 시트로 뺐고,
 * 두 시트는 '검토 ID'로 잇는다.
 *
 * 원천: reviews · review_assignments · profiles · org_units · jobs/job_series/job_groups,
 *      job_feedback · task_feedback · skill_feedback · new_task_suggestions ·
 *      new_skill_suggestions · task_fte_allocations · review_sessions.
 */
const E1_REVIEWS: ExportSheet = {
  name: '검토 목록',
  note: '한 행 = 검토 1건(직무 × SME). reviews + 배정·조직·시각. 항목 응답 시트와 검토 ID로 잇는다.',
  columns: [
    { name: '검토 ID', note: 'reviews.id. 두 시트를 잇는 키.', source: 'COINED' },
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: 'SME 성명', note: 'profiles.name.', source: 'COINED' },
    { name: 'SME 이메일', note: 'profiles.email. 동명이인 식별용.', source: 'COINED' },
    { name: '소속 조직코드', note: 'org_units.code — 고객 조직코드. 조직별 집계(R8)의 키.', source: 'PLAN' },
    { name: '소속 조직명', note: 'org_units.name. 미지정이면 빈칸(0·"미상"으로 채우지 않는다).', source: 'PLAN' },
    { name: '직급', note: 'profiles.title. 수집 항목은 성명·이메일·조직·직급까지다(§8 S6).', source: 'PLAN' },
    { name: '상태', note: '미시작/작성 중/제출/승인/반려 — §6-3 진행 매트릭스와 같은 라벨.', source: 'PLAN' },
    { name: '시작 일시', note: 'reviews.started_at.', source: 'COINED' },
    { name: '최종 저장 일시', note: 'reviews.last_saved_at.', source: 'COINED' },
    { name: '제출 일시', note: 'reviews.submitted_at — §9 E1 "제출 시각".', source: 'PLAN' },
    { name: '승인 일시', note: 'reviews.approved_at — §9 E1 "승인 시각". 미승인이면 빈칸.', source: 'PLAN' },
    { name: '반려 사유', note: 'reviews.rejected_reason. 반려된 적 없으면 빈칸.', source: 'PLAN' },
    { name: '소요 분', note: 'review_sessions 구간 합계(분). E5 중앙값 요약의 원자료.', source: 'COINED' },
  ],
};

const E1_ITEMS: ExportSheet = {
  name: '항목 응답',
  note:
    '한 행 = 검토 × 항목. 항목 구분에 따라 원천이 다르다 — ' +
    '직무명·직무정의·요구 학력·관련 전공·관련 자격증/면허는 job_feedback, 주요과업은 task_feedback, ' +
    'Skill은 skill_feedback, 신규 제안은 new_task_suggestions·new_skill_suggestions.',
  columns: [
    { name: '검토 ID', note: 'reviews.id. 검토 목록 시트와 잇는 키.', source: 'COINED' },
    { name: '직무', note: 'jobs.name. 이 시트만 따로 봐도 읽히도록 둔다.', source: 'REUSED' },
    { name: 'SME 성명', note: 'profiles.name. 같은 이유로 중복 표기.', source: 'COINED' },
    {
      name: '항목 구분',
      note: '직무명 / 직무정의 / 요구 학력 / 관련 전공 / 관련 자격증·면허 / 주요과업 / Skill / 신규 과업 제안 / 신규 Skill 제안.',
      source: 'COINED',
    },
    { name: '항목명', note: '과업·Skill 이름. 직무정의처럼 이름이 없는 항목은 빈칸. 신규 제안은 제안한 이름.', source: 'COINED' },
    { name: '적합성 판정', note: '적합 / 일부 수정 필요 / 부적합. 신규 제안 행은 빈칸(판정 대상이 아니다).', source: 'PLAN' },
    { name: '의견', note: '*_feedback.comment. 신규 제안 행에는 제안 사유(reason)를 넣는다.', source: 'PLAN' },
    { name: '수정 제안', note: '*_feedback.suggestion. 신규 제안 행에는 제안 설명(description)을 넣는다.', source: 'PLAN' },
    { name: '삭제 제안', note: "delete_requested 가 true면 'Y', 아니면 빈칸.", source: 'PLAN' },
    {
      name: 'FTE 비중(%)',
      note: 'task_fte_allocations.pct. 주요과업·신규 과업 제안 행에만 값이 있고 나머지는 빈칸.',
      source: 'PLAN',
    },
  ],
};

// ── E2 직무·조직별 투입 비중 분포 ───────────────────────────────────

/*
 * §9 구성: "피벗: 직무 × 과업 × 조직(org_units) — SME 평균 비중, 표준편차, 응답 수.
 *          승인 응답 기준/전체 기준 토글". R8·R10의 산출물이자 계약 1-(4)·3-(4)의 원천.
 *
 * 시트가 두 장인 이유: SME는 직무당 1~2명이다(R6). 조직축까지 쪼개면 칸마다 응답 1건이라
 * 표준편차가 성립하지 않는다. 조직축을 뺀 '직무×과업 집계'가 실제로 분포를 읽는 표이고,
 * 조직 피벗은 R8("조직별 업무량·업무분장 분석")이 요구하는 축이다. 둘 다 필요하다.
 * 응답 수 열을 항상 함께 싣는 이유도 같다 — n을 모르는 평균은 근거가 되지 못한다.
 * 응답 1건이면 표준편차는 빈칸으로 둔다(0으로 적으면 "편차 없음"이라는 거짓이 된다).
 */
const E2_PIVOT: ExportSheet = {
  name: '직무×과업×조직 피벗',
  note: '한 행 = 직무 × 과업 × 조직. 응답한 SME의 소속 조직(org_units)으로 묶는다. 조직 미지정 응답은 조직코드·조직명을 빈칸으로 둔 행에 모인다.',
  columns: [
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: '과업 구분', note: '기존 / 신규 제안 — task_fte_allocations.target_type(EXISTING·SUGGESTED).', source: 'PLAN' },
    { name: '과업', note: 'job_tasks.name 또는 new_task_suggestions.name. 신규 제안은 이름으로 같은 과업을 맞춘다.', source: 'REUSED' },
    { name: '조직코드', note: 'org_units.code.', source: 'PLAN' },
    { name: '조직명', note: 'org_units.name.', source: 'PLAN' },
    { name: 'SME 평균 비중(%)', note: '해당 칸 응답들의 pct 평균. 소수 둘째 자리까지(pct는 numeric(5,2)).', source: 'PLAN' },
    { name: '표준편차(%p)', note: '같은 칸 응답들의 표준편차. 응답 1건이면 빈칸.', source: 'PLAN' },
    { name: '응답 수', note: '평균의 분모가 된 응답 수(n).', source: 'PLAN' },
  ],
};

const E2_BY_JOB: ExportSheet = {
  name: '직무×과업 집계',
  note: '한 행 = 직무 × 과업(조직축 없음). §6-3 ⓒ FTE 분포 화면의 "직무별 과업 비중 평균·상위 과업 순위"와 같은 수치다.',
  columns: [
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: '과업 구분', note: '기존 / 신규 제안.', source: 'PLAN' },
    { name: '과업', note: '과업명.', source: 'REUSED' },
    { name: 'SME 평균 비중(%)', note: '그 직무 전체 응답의 pct 평균.', source: 'PLAN' },
    { name: '표준편차(%p)', note: '응답 1건이면 빈칸.', source: 'PLAN' },
    { name: '응답 수', note: '평균의 분모(n).', source: 'PLAN' },
    { name: '순위', note: '직무 안에서 평균 비중이 큰 순서. §6-3 ⓒ "상위 과업 순위".', source: 'PLAN' },
  ],
};

// ── E3 직무기술서 원천 4시트 ────────────────────────────────────────

/*
 * §9 구성: "job_description / task_activity(FTE 비중 열 포함) / skill / requirements
 *          — 검토 반영(승인) 기준". 시트 이름 4개는 §9 문언 그대로 쓴다(참고 레포의 stdjob
 *          4시트 CSV 관례를 계승한 이름이라 분석·AI 처리 쪽이 이 키를 기대한다).
 * 열 이름은 한국어로, 기존 exportAllJobsToExcel의 라벨('직군/직렬/직무/직무정의/주요과업/
 * 세부활동/Skill 구분/Skill/요구 학력/관련 전공/관련 자격증/면허')을 그대로 쓴다.
 * 같은 것을 두 이름으로 부르면 두 파일을 대조하는 사람이 손해를 본다.
 *
 * "검토 반영(승인) 기준" — 승인된 검토가 있는 직무의 값을 싣는다. 승인 검토가 없는 직무도
 * 행은 남기고 FTE 비중·응답 수만 빈칸으로 둔다. 행을 빼 버리면 받는 쪽은 그 직무가
 * 없는 것인지 아직 승인이 안 된 것인지 구분할 수 없다.
 */
const E3_JOB_DESCRIPTION: ExportSheet = {
  name: 'job_description',
  note: '한 행 = 직무 1개. 직무정의(jobs.definition)와 승인 근거.',
  columns: [
    { name: '직무 ID', note: 'jobs.id. 4개 시트를 잇는 키.', source: 'COINED' },
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: '직무정의', note: 'jobs.definition.', source: 'REUSED' },
    { name: '승인 검토 수', note: '이 직무에서 승인된(approved_at IS NOT NULL) 검토 수. 0이면 아래 비중 열이 빈칸인 이유가 된다.', source: 'COINED' },
    { name: '최종 승인 일시', note: '가장 나중 approved_at. 승인 이력이 없으면 빈칸.', source: 'COINED' },
  ],
};

const E3_TASK_ACTIVITY: ExportSheet = {
  name: 'task_activity',
  note:
    '한 행 = 주요과업 × 세부활동(세부활동이 없으면 과업 1행). FTE 비중은 과업 단위 값이라 ' +
    '세부활동이 여러 개면 같은 값이 반복 표기된다 — 합산하지 말 것.',
  columns: [
    { name: '직무 ID', note: 'jobs.id.', source: 'COINED' },
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: '주요과업', note: 'job_tasks.name. 신규 제안이 반영된 과업은 new_task_suggestions.name.', source: 'REUSED' },
    { name: '세부활동', note: 'task_activities.activity_name. 없으면 빈칸.', source: 'REUSED' },
    { name: '과업 구분', note: '기존 / 신규 제안.', source: 'PLAN' },
    { name: 'FTE 비중(%)', note: '§9 E3 "FTE 비중 열 포함". 승인 기준 SME 평균 비중. 승인 응답이 없으면 빈칸.', source: 'PLAN' },
    { name: '응답 수', note: '비중의 분모(n). 0건이면 빈칸.', source: 'PLAN' },
  ],
};

const E3_SKILL: ExportSheet = {
  name: 'skill',
  note: '한 행 = 직무 × Skill. job_skills.',
  columns: [
    { name: '직무 ID', note: 'jobs.id.', source: 'COINED' },
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: 'Skill 구분', note: 'job_skills.skill_type — Hard Skill / Soft Skill.', source: 'REUSED' },
    { name: 'Skill', note: 'job_skills.name.', source: 'REUSED' },
    { name: 'Skill 설명', note: 'job_skills.description. 없으면 빈칸.', source: 'COINED' },
  ],
};

const E3_REQUIREMENTS: ExportSheet = {
  name: 'requirements',
  note: '한 행 = 직무 1개. job_requirements(직무당 1행).',
  columns: [
    { name: '직무 ID', note: 'jobs.id.', source: 'COINED' },
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: '요구 학력', note: 'job_requirements.education.', source: 'REUSED' },
    { name: '관련 전공', note: 'job_requirements.major.', source: 'REUSED' },
    { name: '관련 자격증/면허', note: 'job_requirements.certifications.', source: 'REUSED' },
  ],
};

// ── E4 워크숍 대상 직무 목록 ────────────────────────────────────────

/*
 * §9 구성: "직무, 플래그 사유(자동/수동), SME 이견 지표 — '대상 최소화' 판별 근거"(13면).
 * 원천: job_workshop_flags + adminApi.computeJobSignals 의 지표.
 * 지표 열(부적합 비율·1위 과업 불일치·최대 비중 차·신규 제안 수)은 자동 규칙 4종(§6-3 ⓑ)과
 * 1:1로 대응한다. 사유만 적고 지표를 빼면 "왜 이 직무가 걸렸나"를 파일만 보고 확인할 수 없다.
 * 임계값은 상수(src/lib/workshopThresholds.ts)이고 §12에서 조정될 수 있으므로 열 이름에 숫자를 넣지 않는다.
 * 수동 해제된 직무(flagged=false)도 행을 남긴다 — 대상 최소화 판단의 이력 자체가 근거다.
 */
const E4_JOBS: ExportSheet = {
  name: '워크숍 대상 직무',
  note:
    '한 행 = 워크숍 판단 대상 직무 1개. 저장된 플래그가 있는 직무(해제 포함)와, 저장된 결정은 아직 없지만 ' +
    "자동 규칙 ①~④에 지금 걸린 직무를 함께 싣는다. 저장된 것만 실으면 '관리자가 워크벤치에서 열어 본 직무' " +
    "목록이 되어 13면 '대상 최소화'의 전수 판별 근거가 되지 못한다.",
  columns: [
    { name: '직무 ID', note: 'jobs.id.', source: 'COINED' },
    { name: '직군', note: 'job_groups.name.', source: 'REUSED' },
    { name: '직렬', note: 'job_series.name.', source: 'REUSED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    {
      name: '플래그 여부',
      note:
        "'대상' / '해제'(job_workshop_flags.flagged) / '자동 후보(지정 전)'" +
        '(저장된 결정 없이 자동 규칙에만 걸린 직무 — 워크벤치의 「자동 규칙 해당 · 지정 전」과 같은 상태).',
      source: 'COINED',
    },
    { name: '지정 구분', note: "job_workshop_flags.source — '자동' / '수동'. 저장된 결정이 없으면 빈칸.", source: 'PLAN' },
    {
      name: '플래그 사유',
      note:
        "reasons(text[])를 ' · '로 이어 붙인다. 예: 부적합 30%+ · FTE 1위 불일치. " +
        '저장된 결정이 없는 행은 지금 실측한 자동 규칙 사유를 적는다.',
      source: 'PLAN',
    },
    { name: 'SME 응답 수', note: '비교 가능한 제출 검토 수. 자동 규칙 ④(1명뿐)의 근거.', source: 'PLAN' },
    { name: '부적합 판정 비율(%)', note: '자동 규칙 ①의 실측값.', source: 'PLAN' },
    { name: 'FTE 1위 과업 불일치', note: "자동 규칙 ②. 'Y' 또는 빈칸.", source: 'PLAN' },
    { name: '최대 FTE 비중 차(%p)', note: '동일 과업에 대한 SME 간 최대 차(§6-3 ⓑ 비교 뷰 하이라이트 기준).', source: 'PLAN' },
    { name: '신규 제안 과업 수', note: '자동 규칙 ③. 이름이 같은 제안은 1건으로 센다.', source: 'PLAN' },
    { name: '지정자', note: 'decided_by 의 이름. 자동 지정이거나 저장된 결정이 없으면 빈칸.', source: 'COINED' },
    { name: '최종 갱신 일시', note: 'job_workshop_flags.updated_at. 저장된 결정이 없으면 빈칸.', source: 'COINED' },
  ],
};

// ── E5 검토 이력·감사 로그 ──────────────────────────────────────────

/*
 * §9 구성: "상태 전이 이력, 반려 사유, 관리자 행위 로그, 소요 실측 요약(직무당 중앙값 N분)".
 * 매핑: 검수 대응 · 11면 ○○분 확정 근거. 세 덩어리라 시트도 셋이다.
 * 반려 사유는 별도 시트가 아니라 '상태 전이 이력'의 사유·메모 열에 담긴다 —
 * review_history.note 가 곧 반려 사유이고(decide_review·request_rereview가 그렇게 적는다),
 * 사유를 전이와 떼어 놓으면 어느 반려의 사유인지 다시 이어 붙여야 한다.
 * '소요 실측 요약'은 §12 오픈이슈 1(직무당 예상 소요 ○○분 확정)의 근거표다.
 */
const E5_TRANSITIONS: ExportSheet = {
  name: '상태 전이 이력',
  note: '한 행 = review_history 1건. 제출·재검토 요청·승인·반려가 시간순으로 쌓인다.',
  columns: [
    { name: '발생 일시', note: 'review_history.created_at.', source: 'COINED' },
    { name: '검토 ID', note: 'review_history.review_id. E1 검토 목록과 잇는 키.', source: 'COINED' },
    { name: '직무', note: 'jobs.name.', source: 'REUSED' },
    { name: 'SME 성명', note: '그 검토의 배정 SME.', source: 'COINED' },
    { name: '행위', note: '제출 / 재검토 요청 / 승인 / 반려 — review_history.action 을 한국어로.', source: 'PLAN' },
    { name: '사유·메모', note: 'review_history.note. 반려 행에서는 이것이 반려 사유다(§9 E5).', source: 'PLAN' },
    { name: '행위자', note: 'actor_id 의 이름. 승인·반려는 관리자, 제출은 SME 본인.', source: 'COINED' },
  ],
};

/**
 * audit_logs 에는 회사 구분 컬럼이 없어 이 시트만 계열사 필터가 걸리지 않는다(§8 S5 의 감사 기록은
 * 본래 전사 단위 증빙이다). 그 사실이 코드 주석에만 있으면, '대상 회사 = ○○'이라고 적힌 파일을
 * 받은 쪽은 그 계열사 것만 담겼다고 읽는다. 그래서 화면 카드와 파일 첫 시트에 같이 싣는다.
 */
export const E5_AUDIT_SCOPE_NOTE =
  "'관리자 행위 로그' 시트는 계열사 필터가 걸리지 않는 전사 기록입니다(감사 로그에 회사 구분이 없습니다).";

const E5_AUDIT: ExportSheet = {
  name: '관리자 행위 로그',
  note: `한 행 = audit_logs 1건(§8 S5: 제출·승인/반려·계정 생성/삭제·업로드·Export·메일 발송). ${E5_AUDIT_SCOPE_NOTE}`,
  columns: [
    { name: '발생 일시', note: 'audit_logs.created_at.', source: 'COINED' },
    { name: '행위', note: 'audit_logs.action. 예: REVIEW_APPROVED · EXPORT_DOWNLOADED.', source: 'PLAN' },
    { name: '대상', note: 'audit_logs.entity — 테이블·객체 이름.', source: 'COINED' },
    { name: '대상 ID', note: 'audit_logs.entity_id.', source: 'COINED' },
    { name: '행위자', note: 'actor_id 의 이름·이메일.', source: 'PLAN' },
    { name: '상세', note: 'audit_logs.meta(jsonb)를 JSON 문자열로. 개인정보는 이미 meta에 넣지 않는다(§8 S6).', source: 'COINED' },
  ],
};

const E5_DURATION: ExportSheet = {
  name: '소요 실측 요약',
  note:
    '한 행 = 직무 1개. review_sessions 구간 합계를 검토 단위로 모아 직무별로 요약한다. ' +
    '제출을 마친 검토(제출·재제출·승인)만 센다 — 작성 중인 검토가 섞이면 "완료까지 걸린 시간"이 아니게 된다. ' +
    "마지막 행은 직무 칸에 '전체'를 적고 전 직무 합산 중앙값을 담는다 — 착수보고 11면 '직무당 약 ○○분'이 이 값이다. " +
    "그 행은 '구분' 열이 '합계'다: 응답 수를 합산할 때는 '구분'이 '직무'인 행만 더해야 한다.",
  columns: [
    { name: '직무 ID', note: "jobs.id. '전체' 행은 빈칸.", source: 'COINED' },
    { name: '직군', note: "job_groups.name. '전체' 행은 빈칸.", source: 'REUSED' },
    { name: '직렬', note: "job_series.name. '전체' 행은 빈칸.", source: 'REUSED' },
    { name: '직무', note: "jobs.name. 마지막 행은 '전체'.", source: 'REUSED' },
    { name: '응답 수', note: '소요가 기록된 제출 완료 검토 수(n). 중앙값의 분모.', source: 'PLAN' },
    { name: '소요 중앙값(분)', note: '§9 E5 "직무당 중앙값 N분". 기록이 없으면 빈칸.', source: 'PLAN' },
    { name: '소요 평균(분)', note: '중앙값과 벌어지면 이상치가 있다는 뜻이라 함께 싣는다.', source: 'COINED' },
    {
      name: '구분',
      note:
        "'직무' / '합계'. 마지막 '전체' 행을 기계가 걸러내기 위한 표시다. CSV·JSON 에는 이 시트 주석이 실리지 " +
        "않아, 이 열이 없으면 받는 쪽이 '응답 수'를 그냥 더해 실제 검토 수의 두 배를 얻는다(합계 행이 데이터 행에 " +
        '섞여 있기 때문). 빈 직무 ID만으로는 프로그램이 구분할 근거가 되지 못한다.',
      source: 'COINED',
    },
  ],
};

// ── 정의 5종 ────────────────────────────────────────────────────────

/**
 * Export 센터(/exports) 카드 순서 = 이 배열 순서 = §9 표 순서.
 * name·description·deliverables는 §9 표 문언 그대로다. 화면에서 줄여 쓰지 말 것.
 */
export const EXPORT_DEFINITIONS: readonly ExportDefinition[] = [
  {
    id: 'E1',
    name: '업무조사 응답 원본',
    description: '직무 × SME × 항목: 적합성 판정, 의견, 수정·삭제·신규 제안, FTE 비중, 제출·승인 시각',
    deliverables: ['계약 1-(2)', '계약 1-(3)', '23면 현황진단 행'],
    fileBase: 'E1_업무조사_응답원본',
    hasBasisToggle: false,
    sheets: [E1_REVIEWS, E1_ITEMS],
  },
  {
    id: 'E2',
    name: '직무·조직별 투입 비중 분포',
    description:
      '피벗: 직무 × 과업 × 조직(org_units) — SME 평균 비중, 표준편차, 응답 수. 승인 응답 기준/전체 기준 토글',
    deliverables: ['계약 1-(4)', '계약 3-(4) 원천', '16면'],
    fileBase: 'E2_직무조직별_투입비중분포',
    hasBasisToggle: true,
    sheets: [E2_PIVOT, E2_BY_JOB],
  },
  {
    id: 'E3',
    name: '직무기술서 원천 4시트',
    description:
      'job_description / task_activity(FTE 비중 열 포함) / skill / requirements — 검토 반영(승인) 기준',
    deliverables: ['계약 2-(2) JD', '23면 직무기술서 구성항목'],
    fileBase: 'E3_직무기술서_원천4시트',
    hasBasisToggle: false,
    sheets: [E3_JOB_DESCRIPTION, E3_TASK_ACTIVITY, E3_SKILL, E3_REQUIREMENTS],
  },
  {
    id: 'E4',
    name: '워크숍 대상 직무 목록',
    description: '직무, 플래그 사유(자동/수동), SME 이견 지표 — "대상 최소화" 판별 근거',
    deliverables: ['13면'],
    fileBase: 'E4_워크숍_대상직무목록',
    hasBasisToggle: false,
    sheets: [E4_JOBS],
  },
  {
    id: 'E5',
    name: '검토 이력·감사 로그',
    // §9 표에서 '검수 대응'은 칩이 아닌 평문이지만, 화면에는 같은 줄에 함께 표기된다.
    description: '상태 전이 이력, 반려 사유, 관리자 행위 로그, 소요 실측 요약(직무당 중앙값 N분)',
    deliverables: ['검수 대응', '11면 ○○분 확정 근거'],
    fileBase: 'E5_검토이력_감사로그',
    hasBasisToggle: false,
    scopeNote: E5_AUDIT_SCOPE_NOTE,
    sheets: [E5_TRANSITIONS, E5_AUDIT, E5_DURATION],
  },
];
