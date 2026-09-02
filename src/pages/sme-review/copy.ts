/*
 * SME 시작 가이드·검증 마법사의 화면 문구 한곳(로그인 화면의 고지 문구도 여기 둔다).
 *
 * 기획안 §6은 "화면의 안내문·라벨은 착수보고 수정안 문언을 그대로 사용한다"(원칙 P1)를 못박는다.
 * 문구가 화면마다 흩어지면 네 사람이 각자 조금씩 다르게 옮겨 적게 되고, 그 순간 "자료와 실제
 * 도구가 같다"는 검수 방어 근거가 무너진다. 그래서 문언을 이 파일 한 곳에만 둔다.
 *
 * 규칙 두 가지.
 *  1. 기획안에 있는 문장은 글자 단위로 옮긴다. 요약·의역 금지. 상수 위에 §번호와 착수보고 면수를 남긴다.
 *  2. 기획안에 없는 문구는 반드시 "기획안에 없어 새로 씀"이라고 표시한다. 표시 없는 문장은
 *     기획안 원문이라는 뜻이므로, 표시를 빠뜨리면 다음 사람이 원문으로 오인한다.
 *
 * 런타임 의존이 없다(타입 한 개만 type-only import). 어느 단계 컴포넌트에서 불러도 안전하다.
 */
import type { StepNo } from './wizardTypes';

// ── 5단계 이름 (§6-2) ───────────────────────────────────────────────

/**
 * 짧은 라벨 — 그림 6-A 좌측 StepChecklist 목록의 문언.
 * 인덱스 = step - 1. 모바일에서는 상단 가로 배열로 쓰는 그 라벨이다.
 */
export const STEP_LABELS = ['직무 개요', '과업 확인', '투입 비중', 'Skill·요건', '최종 확인'] as const;

/** 정식 제목 — §6-2 표 "단계" 열의 문언. 인덱스 = step - 1. */
export const STEP_TITLES = [
  'STEP 1 직무 개요 확인',
  'STEP 2 과업·활동 확인·보완',
  'STEP 3 투입 비중(FTE) 배분',
  'STEP 4 Skill·수행요건 확인',
  'STEP 5 최종 확인·제출',
] as const;

/** 그림 6-A 상단 바 — "영업기획 · STEP 3/5 — 투입 비중(FTE) 배분" 형식. */
export const stepBarTitle = (jobName: string, step: StepNo) =>
  `${jobName} · STEP ${step}/5 — ${STEP_TITLES[step - 1].replace(/^STEP \d /, '')}`;

/** 그림 6-A 우측 버튼. */
export const PREV_STEP_BUTTON = '이전 단계';
export const NEXT_STEP_BUTTON = '다음 단계';

// ── 시작 가이드 (§6-1) ──────────────────────────────────────────────

/**
 * 가이드 카드 한 장. steps는 카드 ②처럼 목록을 함께 보여 주는 카드에만 있다.
 * emphasis는 원문에서 굵은 글씨인 구간을 body에 있는 그대로 적은 것이다 — 화면이 이 조각만
 * <strong>으로 감싼다(문장은 손대지 않는다).
 */
export interface GuideCard {
  title: string;
  body: string;
  steps?: readonly string[];
  emphasis?: readonly string[];
}

/**
 * 카드 ① 조사 취지와 방식 — §6-1 화면 문구(고정), 착수보고 11면 헤드메시지.
 * "확인·보완"은 원문에서 굵은 글씨다. 강조는 emphasis로 넘겨 화면에서 처리하고 문장은 그대로 둔다.
 */
export const GUIDE_CARD_PURPOSE: GuideCard = {
  title: '조사 취지와 방식',
  body: '직무·과업 초안을 HCG가 먼저 작성했습니다. 여러분은 초안이 실제 업무와 맞는지 확인·보완해 주시면 됩니다. 처음부터 작성하는 조사가 아닙니다.',
  emphasis: ['확인·보완'],
};

/**
 * 카드 ② 무엇을 하게 되는지 — §6-1 구성 "② 무엇을 하게 되는지(5단계 미리보기)".
 * 제목의 "— 5단계 미리보기" 표기와 본문 자리는 기획안에 없어 새로 씀.
 * 본문 문장을 지어내는 대신 §6-2 표의 5단계 정식 제목을 그대로 나열한다.
 */
export const GUIDE_CARD_PREVIEW: GuideCard = {
  title: '무엇을 하게 되는지 — 5단계 미리보기',
  body: '',
  steps: STEP_TITLES,
};

/**
 * 카드 ③ 투입 비중(FTE)이란 — §6-1 화면 문구(고정), 착수보고 11면 Step 2.
 * "상대적 비중", "개인별 소요 시간을 실측하는 방식이 아니므로"가 원문의 굵은 글씨다.
 * 특히 뒤 구절은 이 카드가 막으려는 오해(시간 실측으로 착각)를 짚는 자리라 강조가 빠지면 안 된다.
 */
export const GUIDE_CARD_FTE: GuideCard = {
  title: '투입 비중(FTE)이란',
  body: '투입 비중(FTE)은 지난 1년 기준, 이 직무 수행에 실제로 들어간 시간의 상대적 비중을 과업별로 배분하는 것입니다. 직무 단위 합계가 100%가 되면 됩니다. 개인별 소요 시간을 실측하는 방식이 아니므로, 시계를 재실 필요가 없습니다.',
  emphasis: ['상대적 비중', '개인별 소요 시간을 실측하는 방식이 아니므로'],
};

/** 카드 ④ 제목 — §6-1 구성 "④ 소요·저장·문의 안내". */
export const GUIDE_CARD_NOTICE_TITLE = '소요·저장·문의 안내';

/**
 * 카드 ④ 본문 — §6-1 화면 문구(고정). "약 N분"은 관리자 설정값(survey_settings.expected_minutes)이다.
 *
 * 설정값이 없으면 소요 문장을 통째로 뺀다. §6-1 소요 실측(R4)이 "화면에는 관리자 설정값만 표시"라고
 * 못박고 있고, 착수보고 11면의 "직무당 약 ○○분"은 P5 파일럿 실측으로 확정할 값이라
 * 앱이 추정치를 지어내면 그 문장의 근거가 사라진다.
 */
export function expectedMinutesLine(minutes: number | null): string {
  const tail =
    "입력은 자동 저장됩니다. 중간에 나가셔도 이어서 진행됩니다. 막히는 부분은 화면 우측 하단 '문의하기'로 남겨 주세요.";
  if (minutes === null) return tail;
  return `예상 소요는 직무당 약 ${minutes}분이며, ${tail}`;
}

/** 가이드 4장 카드. 관리자 설정 소요 시간을 넣어 부른다. */
export function guideCards(expectedMinutes: number | null): GuideCard[] {
  return [
    GUIDE_CARD_PURPOSE,
    GUIDE_CARD_PREVIEW,
    GUIDE_CARD_FTE,
    { title: GUIDE_CARD_NOTICE_TITLE, body: expectedMinutesLine(expectedMinutes) },
  ];
}

/** §6-1 구성 — 마지막 카드의 "시작하기"로 최초 1회 필수 통과. */
export const GUIDE_START_BUTTON = '시작하기';

/** §6-1 구성 — 이후 상단 "가이드 다시 보기"로 상시 재열람. */
export const GUIDE_REOPEN_LINK = '가이드 다시 보기';

// ── STEP 3 투입 비중(FTE) 배분 화면 (§6-2 STEP 3 상세 · 그림 6-A) ───

/**
 * 상단 안내문 — 그림 6-A 본문 영역의 고정 문언.
 * 착수보고 11면 Step 2("개인별 소요 시간 실측 방식이 아님")를 화면에서 되풀이하는 자리다.
 */
export const FTE_INTRO =
  '지난 1년 기준, 이 직무 수행에 실제로 들어간 시간의 비중을 과업별로 배분해 주세요. 합계 100%가 되면 다음으로 진행됩니다. (개인별 시간 실측이 아닙니다)';

/** 헤더 고정 표기 — §6-2 "겸직·비중 인식 지원"의 기간 기준. */
export const FTE_PERIOD_BASIS = '지난 1년';

/**
 * 겸직 안내 — §6-2 "겸직·비중 인식 지원"의 고정 표기.
 * SME 1~2인 응답 편차를 줄이는 정의 통일 장치(R6)라, 헤더에서 접거나 줄이면 안 된다.
 */
export const FTE_MOONLIGHTING_NOTE = '이 직무에 쓴 시간만을 100%로 봅니다(타 직무 겸직 시간 제외)';

/** §6-2 입력 방식 — 시작점 옵션. 그림 6-A 하단 링크와 같은 문언이다. */
export const FTE_EQUAL_SPLIT_BUTTON = '균등 배분으로 시작';

/** 그림 6-A 우측(모바일 하단 고정) 합계 게이지 제목. */
export const FTE_TOTAL_LABEL = '배분 합계';

/**
 * 잔여 안내 — 그림 6-A "잔여 5% 를 배분해 주세요".
 * 원문의 "5% 를"는 와이어프레임 조판에서 벌어진 공백이라 "5%를"로 붙인다(문장은 그대로).
 */
export const fteRemainingLine = (remaining: number) => `잔여 ${remaining}%를 배분해 주세요`;

/** 합계 미달 시 다음 버튼 라벨 — 그림 6-A 우측 하단 버튼(비활성 상태) 문언. */
export const FTE_NEXT_BLOCKED_BUTTON = '다음 단계 (100% 필요)';

/**
 * 초과 안내 — §6-2 합계 게이지 "초과 시 초과분 적색 표시".
 * 문장 자체는 기획안에 없어 새로 씀.
 */
export const fteOverLine = (over: number) => `${over}% 초과됐어요. 합계가 100%가 되도록 줄여 주세요`;

/**
 * 삭제 제안 제외 안내 — 그림 6-A "삭제 제안 1건은 배분 대상에서 제외되었습니다".
 * (§6-2 대상 목록은 같은 안내를 "삭제 제안 n건 제외됨"으로도 적었다. 화면 문언은 그림 쪽을 쓴다.)
 */
export const fteExcludedLine = (count: number) => `삭제 제안 ${count}건은 배분 대상에서 제외되었습니다`;

/** §6-2 대상 목록 — SME가 추가한 신규 제안 Task에 붙는 라벨. 그림 6-A의 "SME 추가 제안 과업". */
export const FTE_SUGGESTED_BADGE = 'SME 추가 제안 과업';

/** §6-2 입력 방식 — 행별 ±5% 스텝퍼의 증감 폭. 안내 문구가 이 값을 인용하므로 여기 둔다. */
export const FTE_STEP_PCT = 5;

/**
 * 품질 가드 ⓐ — 단일 Task 100% 배분 시 확인 모달. 본문은 §6-2의 고정 문언.
 * 제목과 버튼 라벨은 기획안에 없어 새로 씀.
 */
export const FTE_SINGLE_100_MODAL = {
  title: '한 과업에 100%를 배분했어요',
  body: '이 직무의 시간이 사실상 한 과업에 쓰인다는 의미입니다. 맞습니까?',
  confirm: '맞습니다',
  cancel: '다시 배분할게요',
} as const;

/**
 * 품질 가드 ⓑ — 0% Task 존재 시 제출 요약에 목록 표시(허용하되 인지시킴).
 * 문장은 기획안에 없어 새로 씀. "허용은 하되"가 원칙이라 차단 어조를 쓰지 않는다.
 */
export const fteZeroPctNote = (count: number) =>
  `투입 비중이 0%인 과업이 ${count}건 있어요. 그대로 제출할 수 있지만, 실제로 수행하지 않는 과업인지 한 번만 확인해 주세요.`;

/**
 * 품질 가드 ⓒ — 5% 미만 다수 분산 시 안내 문구.
 * 문장은 기획안에 없어 새로 씀. 이것도 차단이 아니라 안내다.
 */
export const fteTooManySmallNote = (count: number) =>
  `${FTE_STEP_PCT}% 미만으로 배분한 과업이 ${count}건이에요. 비슷한 과업을 묶으면 비중을 읽기 쉬워집니다.`;

// ── 단계 게이트 실패 문구 (§6-2 표 "다음 단계 이동 게이트") ─────────
//
// 표의 게이트 열은 개발자용 조건문이라 그대로 화면에 띄우면 사용자가 무엇을 해야 할지 모른다.
// 조건은 그대로 두고 어조만 사용자 안내문으로 옮긴 것이라, 아래 문장은 전부 기획안에 없어 새로 씀.
// (조건 자체를 바꾸면 안 된다 — 서버 submit_review가 같은 조건을 재검증한다.)

/** STEP 1 — "적합성 1건 선택 필수". */
export const GATE_STEP1_SUITABILITY = '적합성을 1건 선택해 주세요.';

/** STEP 1 — "'부적합/일부 수정' 선택 시 의견 또는 수정안 필수". */
export const GATE_STEP1_NOTE_REQUIRED =
  "'부적합' 또는 '일부 수정 필요'를 고르셨어요. 의견이나 수정안 중 하나는 적어 주셔야 다음 단계로 넘어갈 수 있어요.";

/** STEP 2 — "모든 Task 평가 완료". */
export const gateStep2Unrated = (count: number) => `아직 평가하지 않은 과업이 ${count}건 있어요. 모두 평가해 주세요.`;

/** STEP 2 — "신규 Task는 명칭 필수". */
export const GATE_STEP2_NEW_TASK_NAME = '추가하신 신규 과업의 명칭을 입력해 주세요.';

/** STEP 3 — "합계 = 100% (서버에서 재검증)". */
export const gateStep3Total = (total: number) =>
  `배분 합계가 100%가 되어야 다음 단계로 넘어갈 수 있어요. 지금은 ${total}%예요.`;

/** STEP 4 — "모든 항목 평가 완료". */
export const gateStep4Unrated = (count: number) => `아직 평가하지 않은 항목이 ${count}건 있어요. 모두 평가해 주세요.`;

/** STEP 5 — 서버 RPC submit_review가 돌려준 부족 항목 안내. */
export const gateStep5Missing = (count: number) =>
  count > 0
    ? `아직 제출할 수 없어요. 채워야 할 항목이 ${count}개 있어요. 아래 항목을 눌러 해당 단계로 이동해 주세요.`
    : '아직 제출할 수 없어요. 채우지 않은 항목이 남아 있어요.';

/**
 * 게이트에 걸렸을 때 단계 공통으로 앞세우는 한 줄. 세부 사유는 이어서 목록으로 보여 준다.
 * 기획안에 없어 새로 씀.
 */
export const GATE_BLOCKED_HEADING = '다음 단계로 넘어가기 전에 확인해 주세요.';

// ── 저장 상태 칩 (그림 6-A 상단 우측) ───────────────────────────────
//
// "자동 저장됨 · 방금"은 그림 6-A의 고정 문언이라 여기 둔다.
// 나머지 네 상태(실패·저장 중·입력 중·최초)는 그림에 없는 상태라 기획안에 없어 새로 씀.

/** 그림 6-A 칩 — "자동 저장됨 · 방금"의 앞부분. 뒤의 시각 표기는 아래 세 문언이 만든다. */
export const SAVE_CHIP_SAVED = '자동 저장됨';

/** 그림 6-A 칩 — "· 방금". 저장한 지 1분이 지나지 않은 상태의 표기다. */
export const SAVE_CHIP_JUST_NOW = '방금';

/** 저장 시각 상대 표기. "방금" 다음 단위. 기획안에 없어 새로 씀(그림 6-A는 "방금"만 보여 준다). */
export const savedMinutesAgo = (minutes: number) => `${minutes}분 전`;
export const savedHoursAgo = (hours: number) => `${hours}시간 전`;

/** 저장 실패 — 기획안에 없어 새로 씀. 자동 저장은 실패를 알리지 않으면 사용자가 저장된 줄 안다. */
export const SAVE_CHIP_ERROR = '저장하지 못했어요';
export const SAVE_CHIP_RETRY = '다시 저장';

/** 저장 중 · 입력 중 · 최초 상태 — 기획안에 없어 새로 씀. */
export const SAVE_CHIP_SAVING = '저장 중…';
export const SAVE_CHIP_DIRTY = '입력 중 · 잠시 후 자동 저장';
export const SAVE_CHIP_IDLE = '아직 입력한 내용이 없어요.';

// ── StepChecklist 부속 문언 ─────────────────────────────────────────

/** 단계 목록의 이름표(§6-2 "StepChecklist"). 목록 제목과 보조기기용 라벨에 같은 말을 쓴다. */
export const STEP_NAV_LABEL = '검토 단계';

/** 완료 표시를 색·아이콘만으로 알리지 않기 위한 보조기기 전용 문구. 기획안에 없어 새로 씀. */
export const STEP_COMPLETE_SR = '완료';

// ── 단계별 축약 가이드 (§6-1 핵심 동작) ─────────────────────────────
//
// "마법사 각 단계 상단에도 해당 단계 축약 가이드를 접이식으로 상시 노출"(§6-1)을 위한 문언이다.
// 내용은 §6-2 표의 "내용"·"게이트" 열을 사용자 어조로 옮긴 것이라 전부 기획안에 없어 새로 씀.
// (조건을 바꾸면 안 된다 — 게이트 판정은 wizard.tsx evaluateStep이 하고 서버가 재검증한다.)

/** 접이식 가이드를 여는 줄. 인덱스 = step - 1인 아래 본문과 짝이다. */
export const STEP_GUIDE_SUMMARY = '이 단계에서 할 일';

export const STEP_GUIDES = [
  "직무명과 직무정의가 실제 업무와 맞는지 확인해 주세요. 적합성을 고르고, '부적합'이나 '일부 수정 필요'를 고르셨다면 의견이나 수정안 중 하나를 적어 주셔야 다음 단계로 넘어갑니다.",
  '과업마다 적합성을 고르고, 고칠 부분은 의견·수정안으로, 빠진 과업은 신규 제안으로, 실제로 하지 않는 과업은 삭제 제안으로 남겨 주세요. 신규 과업은 명칭이 있어야 저장됩니다.',
  '지난 1년 기준으로 이 직무에 들어간 시간의 비중을 과업별로 나눠 주세요. 합계가 100%가 되어야 다음 단계로 넘어갑니다.',
  '필요 Skill(Hard·Soft)과 수행요건이 실제 업무와 맞는지 확인해 주세요. 빠진 Skill은 신규 제안으로 남길 수 있습니다.',
  '단계별 완료 현황과 제안 요약, 투입 비중 상위 과업을 확인한 뒤 제출해 주세요. 제출 후에는 관리자가 재검토를 요청하기 전까지 수정할 수 없어요.',
] as const;

// ── STEP 2 직군별 작성 예시 팝오버 (§6-2 STEP 2 "직군별 작성 예시 팝오버") ──
//
// 기획안은 이 장치의 존재만 정하고 예시 문안은 주지 않는다(직군별 예시 원천도 DB에 없다).
// 그래서 아래 문안·예시는 전부 기획안에 없어 새로 씀. 특정 회사의 실제 과업이 아니라
// "어느 수준으로 적으면 되는지"만 보여 주는 표본이다.

export const TASK_EXAMPLE_SUMMARY = '직군별 작성 예시 보기';

export const TASK_EXAMPLE_INTRO =
  "새 과업은 '무엇을 · 어떻게 · 어떤 결과로 끝나는지'가 드러나면 충분합니다. 아래는 직군별 표본 예시입니다.";

export const TASK_EXAMPLES = [
  {
    group: '기획·관리',
    name: '월간 실적 집계·분석',
    description: '각 팀 실적 자료를 모아 월간 집계표를 만들고, 전월 대비 증감 사유를 정리해 보고합니다.',
  },
  {
    group: '영업·고객',
    name: '거래선 정기 방문·요구사항 수집',
    description: '담당 거래선을 정기 방문해 요구사항과 불만을 듣고, 관련 부서에 전달해 처리 결과를 회신합니다.',
  },
  {
    group: '생산·기술',
    name: '설비 일상점검·이상 조치',
    description: '담당 설비를 교대 시작 전 점검하고, 이상이 있으면 즉시 조치하거나 정비 부서에 인계합니다.',
  },
] as const;

export const TASK_EXAMPLE_TIP = '결과물이 서로 다른 일은 한 줄에 몰아 적기보다 과업을 나누어 적어 주세요.';

// ── Phase 5 접근성 보완 문언 (§8 S8 · §11-2 Phase 5 3번) ────────────
//
// 아래는 전부 기획안에 없어 새로 씀. 화면(스텝퍼 aria-label, 저장 실패 안내 등)에서 직접 지어
// 쓰던 문장을 이 파일로 끌어온 것이라, 문언 단일 원천 규칙(파일 상단 규칙 1·2)은 그대로 지킨다.

/**
 * STEP 3 스텝퍼(±) 버튼의 접근 가능한 이름.
 * 아이콘(Minus·Plus)만 있는 버튼이라 이름이 없으면 화면 낭독기가 "버튼"으로만 읽는다.
 * 과업이 25개면 같은 "버튼"이 50개 나열되므로 어느 과업의 버튼인지 이름에 반드시 넣는다.
 */
export const fteStepUpLabel = (taskName: string) => `${taskName} 비중 ${FTE_STEP_PCT}% 늘리기`;
export const fteStepDownLabel = (taskName: string) => `${taskName} 비중 ${FTE_STEP_PCT}% 줄이기`;

/** STEP 3 비중 입력 칸의 이름. 과업명만으로는 무엇을 넣는 칸인지 알 수 없다. */
export const fteInputLabel = (taskName: string) => `${taskName} 투입 비중`;

/**
 * 비중 입력 칸의 단위·범위 안내(aria-describedby로 모든 입력 칸이 함께 참조한다).
 * 화살표 키 조작은 화면에 단서가 없어 이 문장이 유일한 안내다.
 */
export const FTE_INPUT_HINT = `단위는 %이고 0에서 100 사이 정수만 입력할 수 있어요. 위·아래 화살표 키로 ${FTE_STEP_PCT}%씩 조절할 수 있어요.`;

/** 합계 100% 도달 안내. 색(초록)만으로 알리지 않도록 문구·아이콘을 함께 둔다. */
export const FTE_DONE_LINE = '배분을 마쳤어요';

/**
 * 합계 게이지의 aria-valuetext.
 * 초과(101% 이상)일 때 aria-valuenow를 100으로 자르기 때문에, 실제 합계와 사유는 이쪽으로 읽힌다.
 */
export const fteGaugeValueText = (total: number) =>
  total > 100
    ? `${total}% — ${fteOverLine(total - 100)}`
    : total < 100
      ? `${total}% — ${fteRemainingLine(100 - total)}`
      : `${total}% — ${FTE_DONE_LINE}`;

/**
 * 저장 실패 시 이어 붙이는 안내. 서버가 준 사유만으로는 "내가 쓴 글이 사라졌는지"를 알 수 없다.
 * 무엇이 잘못됐는지(사유)는 서버 메시지가, 무엇을 하면 되는지는 이 문장이 맡는다.
 */
export const SAVE_CHIP_ERROR_HELP =
  "입력하신 내용은 화면에 그대로 남아 있어요. 네트워크 연결을 확인한 뒤 '다시 저장'을 눌러 주세요.";

/** 필수 입력 표시(*)를 보조기기에 읽어 줄 문구. 별표는 색·기호라 낭독되지 않는다. */
export const REQUIRED_MARK_SR = '필수 입력';

/**
 * 가이드 통과 기록을 저장할 수 없는 상태(서버 연결 설정 없음).
 * "데이터베이스에 연결되어 있지 않습니다"만으로는 사용자가 무엇을 하면 되는지 알 수 없어 행동을 덧붙인다.
 */
export const GUIDE_SAVE_NO_DB = '서버 연결 설정이 없어 기록을 저장할 수 없습니다. 관리자에게 문의해 주세요.';

/**
 * 항목 옆 별표(필수)의 뜻을 문장으로 밝히는 안내. 기획안에 없어 새로 씀.
 *
 * GATE_STEP1_NOTE_REQUIRED와 문장이 비슷하지만 끝맺음이 다르다. 저쪽은 STEP 1 게이트 문구라
 * "다음 단계로 넘어갈 수 있어요"이고, 이 문장은 과업·Skill 항목에도 함께 붙는다.
 * 과업·Skill은 의견이 없어도 다음 단계로는 넘어가고 제출에서 막히므로(서버 submit_review가
 * job·task·skill 세 갈래 모두 같은 조건으로 재검증한다) 여기서는 "제출"로 적어야 사실과 맞는다.
 */
export const NOTE_REQUIRED_HINT =
  "'부적합' 또는 '일부 수정 필요'를 고르셨어요. 의견이나 수정안 중 하나는 적어 주셔야 제출할 수 있어요.";

/**
 * 로그인 화면 하단의 수집·이용 안내 한 문장(§8 S6 "로그인 화면에 수집·이용 안내 1문장").
 * 기획안에 없어 새로 씀 — S6은 요구사항만 적고 문장 자체는 주지 않는다.
 *
 * S6이 정한 사실만 적는다. 수집 항목은 성명·이메일·조직·직급으로 한정되고(주민번호·연락처는
 * 수집하지 않는다), 이용 목적은 업무조사와 SME 검증이다. 파기·이관 기준과 데이터 위치는 고객
 * TF와 합의해 별도 문서(§12)로 남기는 사항이라 이 문장에 넣지 않는다. 법적 고지문처럼 부풀려
 * 쓰지 않는다 — 여기서 약속한 것보다 더 수집하게 되는 순간 이 문장이 거짓이 된다.
 */
export const LOGIN_PRIVACY_NOTICE =
  '이 도구는 업무조사와 SME 검증에 필요한 성명·이메일·조직·직급만 수집하며, 주민등록번호와 연락처는 수집하지 않습니다.';
