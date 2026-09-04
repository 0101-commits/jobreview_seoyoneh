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
 *  3. 새로 쓰는 문장은 문체 규칙을 지킨다(기획서 GUIDE v4 §4-1 P8).
 *     경어체 통일(`~합니다`·`~하세요`·`~해 주세요`, `~어요/~예요` 금지) · 할 일이 먼저 ·
 *     안내 한 줄은 1문장 · 게이트가 실패 시점에 말해 주는 조건은 가이드에서 되풀이하지 않는다.
 *     고정 문언은 이 규칙의 대상이 아니다 — 원문 그대로 둔다.
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
  /** 카드 ⑤ 화면 미리보기(v4)에만 있다. 있으면 화면이 축소 그림과 번호 말풍선을 그린다. */
  preview?: readonly PreviewNote[];
}

/** 카드 ⑤의 번호 말풍선 한 개. n은 축소 그림 위의 번호와 짝이다. */
export interface PreviewNote {
  n: number;
  label: string;
  note: string;
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

/**
 * 카드 ⓪ 왜 저에게 왔는지 — 기획서 GUIDE v4 §5 G3. 기획안에 없어 새로 씀.
 *
 * 고정 문언 4장 앞에 선다. 카드 ①이 "무엇을 하는 조사인지"를 말하기 전에, 처음 온 응답자가
 * 실제로 먼저 갖는 물음("왜 나인가 · 틀리면 어떻게 되나 · 중간에 그만둬도 되나")에 답한다.
 * 확인되지 않은 약속은 적지 않는다 — 인사평가 반영 여부는 고객 TF 확인 전까지 쓰지 않는다(D2 보류).
 */
export const GUIDE_CARD_WHY_YOU: GuideCard = {
  title: '왜 저에게 왔나요',
  body:
    '이 직무를 실제로 하고 계셔서, 초안이 맞는지 봐 주실 분으로 모셨습니다. 직무마다 1~2분께만 부탁드립니다. ' +
    '정답을 맞히는 조사가 아니니 지금 하고 계신 일을 있는 그대로 알려 주시면 됩니다. ' +
    '중간에 그만두셔도 적으신 내용은 그대로 남아 있습니다.',
  emphasis: ['정답을 맞히는 조사가 아니니'],
};

/**
 * 카드 ⑤ 화면 미리보기 — 기획서 GUIDE v4 §5 G3. 기획안에 없어 새로 씀.
 *
 * 고정 문언 4장 뒤에 선다. 목적은 설명이 아니라 이름 붙이기다 — 검토 화면에서 처음 마주칠 네
 * 요소에 미리 이름을 달아 두면, 화면에 들어섰을 때 "저게 뭔지 모르겠는" 것이 넷 줄어든다.
 * 캡처 이미지가 아니라 축소 마크업으로 그린다(이미지는 화면이 바뀌는 순간 거짓말이 된다).
 */
export const GUIDE_CARD_SCREEN: GuideCard = {
  title: '화면 미리보기',
  body: '검토 화면에서 이 넷만 알고 계시면 됩니다.',
  preview: [
    { n: 1, label: '단계 목록', note: '지금 몇 번째인지, 어디까지 끝났는지 보여 줍니다.' },
    { n: 2, label: '저장 표시', note: '직접 저장을 누르지 않으셔도 자동으로 저장됩니다.' },
    { n: 3, label: '적합성 3버튼', note: '한 항목에서 하실 일은 여기서 하나 고르는 것입니다.' },
    { n: 4, label: '문의하기', note: '막히면 여기로 남겨 주십시오. 답이 오면 알려 드립니다.' },
  ],
};

/**
 * 가이드 6장 카드(v4). 관리자 설정 소요 시간을 넣어 부른다.
 *
 * 가운데 넷은 §6-1 고정 문언이라 순서도 문장도 건드리지 않는다. 앞뒤로만 한 장씩 더했다.
 */
export function guideCards(expectedMinutes: number | null): GuideCard[] {
  return [
    GUIDE_CARD_WHY_YOU,
    GUIDE_CARD_PURPOSE,
    GUIDE_CARD_PREVIEW,
    GUIDE_CARD_FTE,
    { title: GUIDE_CARD_NOTICE_TITLE, body: expectedMinutesLine(expectedMinutes) },
    GUIDE_CARD_SCREEN,
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
export const fteOverLine = (over: number) => `${over}% 초과되었습니다. 합계가 100%가 되도록 줄여 주세요`;

/**
 * 삭제 제안 제외 안내 — 그림 6-A "삭제 제안 1건은 배분 대상에서 제외되었습니다".
 * (§6-2 대상 목록은 같은 안내를 "삭제 제안 n건 제외됨"으로도 적었다. 화면 문언은 그림 쪽을 쓴다.)
 */
export const fteExcludedLine = (count: number) => `삭제 제안 ${count}건은 배분 대상에서 제외되었습니다`;

/** §6-2 대상 목록 — SME가 추가한 신규 제안 Task에 붙는 라벨. 그림 6-A의 "SME 추가 제안 과업". */
export const FTE_SUGGESTED_BADGE = 'SME 추가 제안 과업';

/*
 * ── v2 STEP 3 보완 편집(기획안 dcab2660 §5-3) ─────────────────────
 * 5단계 구조를 유지한 채 STEP 3 각 행에서 STEP 2 결과를 되돌아보고 고칠 수 있게 하는 조각들.
 * 아래 문장은 기획안 §5-3 화면 명세의 문언을 그대로 옮긴 것이다.
 */

/** 행 머리의 「→ 제안명: …」 칩. 수정 제안이 있을 때만 붙는다. */
export const fteSuggestedNameChip = (name: string) => `→ 제안명: ${name}`;

/** 행을 펼쳐 STEP 2 항목을 그 자리에서 고치는 버튼. 접힘/펼침 두 라벨을 함께 둔다. */
export const FTE_REOPEN_BUTTON = '다시 보기';
export const FTE_REOPEN_CLOSE_BUTTON = '닫기';

/** 펼침 안쪽 안내 — 여기서 고친 내용이 STEP 2와 같은 저장임을 밝힌다. */
export const FTE_REOPEN_NOTE = '여기서 고친 내용은 STEP 2와 같은 저장입니다(같은 항목, 같은 자동 저장).';

/** 목록 하단 — 과업을 이 화면에서 바로 추가한다. */
export const FTE_ADD_TASK_BUTTON = '과업 추가 제안';

/** 삭제 제안으로 빠진 행 안내 + 되살리기. 이전 비중이 잔여로 돌아왔다는 사실까지 말한다. */
export const fteExcludedRestoreLine = (count: number, pct: number) =>
  pct > 0
    ? `삭제 제안 ${count}건은 배분 대상에서 제외되었습니다 · 이전 비중 ${pct}%가 잔여로 돌아왔습니다`
    : `삭제 제안 ${count}건은 배분 대상에서 제외되었습니다`;
export const FTE_RESTORE_BUTTON = '되살리기';

/** 세부활동 의견(결정 D2) — 배분 단위가 아니라 의견 단위임을 라벨에서 밝힌다. */
export const ACTIVITY_SECTION_LABEL = '세부활동';
export const ACTIVITY_NOTE_HINT = '세부활동은 비중 배분 대상이 아닙니다. 고칠 점이 있으면 의견만 남겨 주세요.';
export const activityCommentLabel = (name: string) => `${name} 의견`;
export const ACTIVITY_REMOVE_LABEL = '이 세부활동은 삭제가 필요합니다';

/** §6-2 입력 방식 — 행별 ±5% 스텝퍼의 증감 폭. 안내 문구가 이 값을 인용하므로 여기 둔다. */
export const FTE_STEP_PCT = 5;

/**
 * 품질 가드 ⓐ — 단일 Task 100% 배분 시 확인 모달. 본문은 §6-2의 고정 문언.
 * 제목과 버튼 라벨은 기획안에 없어 새로 씀.
 */
export const FTE_SINGLE_100_MODAL = {
  title: '한 과업에 100%를 배분하셨습니다',
  body: '이 직무의 시간이 사실상 한 과업에 쓰인다는 의미입니다. 맞습니까?',
  confirm: '맞습니다',
  cancel: '다시 배분하겠습니다',
} as const;

/**
 * 품질 가드 ⓑ — 0% Task 존재 시 제출 요약에 목록 표시(허용하되 인지시킴).
 * 문장은 기획안에 없어 새로 씀. "허용은 하되"가 원칙이라 차단 어조를 쓰지 않는다.
 */
export const fteZeroPctNote = (count: number) =>
  `투입 비중이 0%인 과업이 ${count}건 있습니다. 그대로 제출하셔도 되지만, 실제로 하지 않는 과업인지 한 번만 확인해 주세요.`;

/**
 * 품질 가드 ⓒ — 5% 미만 다수 분산 시 안내 문구.
 * 문장은 기획안에 없어 새로 씀. 이것도 차단이 아니라 안내다.
 */
export const fteTooManySmallNote = (count: number) =>
  `${FTE_STEP_PCT}% 미만으로 배분한 과업이 ${count}건입니다. 비슷한 과업을 묶으면 비중을 읽기 쉬워집니다.`;

// ── 단계 게이트 실패 문구 (§6-2 표 "다음 단계 이동 게이트") ─────────
//
// 표의 게이트 열은 개발자용 조건문이라 그대로 화면에 띄우면 사용자가 무엇을 해야 할지 모른다.
// 조건은 그대로 두고 어조만 사용자 안내문으로 옮긴 것이라, 아래 문장은 전부 기획안에 없어 새로 씀.
// (조건 자체를 바꾸면 안 된다 — 서버 submit_review가 같은 조건을 재검증한다.)

/** STEP 1 — "적합성 1건 선택 필수". */
export const GATE_STEP1_SUITABILITY = '적합성을 골라 주세요.';

/** STEP 1 — "'부적합/일부 수정' 선택 시 의견 또는 수정안 필수". */
export const GATE_STEP1_NOTE_REQUIRED =
  "'개선 필요사항'과 '수정 제안' 중 하나는 적어 주셔야 다음 단계로 넘어갑니다.";

/** STEP 2 — "모든 Task 평가 완료". */
export const gateStep2Unrated = (count: number) => `아직 고르지 않은 과업이 ${count}건 있습니다. 모두 골라 주세요.`;

/** STEP 2 — "신규 Task는 명칭 필수". */
export const GATE_STEP2_NEW_TASK_NAME = '추가하신 신규 과업의 이름을 적어 주세요.';

/** STEP 3 — "합계 = 100% (서버에서 재검증)". */
export const gateStep3Total = (total: number) =>
  `배분 합계가 100%가 되어야 다음 단계로 넘어갑니다. 지금은 ${total}%입니다.`;

/** STEP 4 — "모든 항목 평가 완료". */
export const gateStep4Unrated = (count: number) => `아직 고르지 않은 항목이 ${count}건 있습니다. 모두 골라 주세요.`;

/** STEP 5 — 서버 RPC submit_review가 돌려준 부족 항목 안내. */
export const gateStep5Missing = (count: number) =>
  count > 0
    ? `아직 제출할 수 없습니다. 채워야 할 항목이 ${count}개 있습니다. 아래 항목을 눌러 해당 단계로 이동해 주세요.`
    : '아직 제출할 수 없습니다. 채우지 않은 항목이 남아 있습니다.';

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
export const SAVE_CHIP_ERROR = '저장하지 못했습니다';
export const SAVE_CHIP_RETRY = '다시 저장';

/** 저장 중 · 입력 중 · 최초 상태 — 기획안에 없어 새로 씀. */
export const SAVE_CHIP_SAVING = '저장 중…';
export const SAVE_CHIP_DIRTY = '입력 중 · 잠시 후 자동 저장';
export const SAVE_CHIP_IDLE = '아직 입력한 내용이 없습니다.';

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

/**
 * 단계 가이드 한 장 — 세 줄 고정(GUIDE v4 §5 G5).
 *
 * 예전에는 단계마다 2~3문장짜리 통문장이었다. 조건·예외·게이트 사유가 한 문단에 뭉쳐 있어,
 * 정작 "무엇을 하면 되는지"가 문장 중간에 묻혔다. 세 줄로 자리를 정해 둔다.
 *   do     — 이 단계에서 할 동작 하나
 *   enough — 이 정도만 적어도 된다는 예시
 *   skip   — 하지 않아도 되는 일 (처음 오는 응답자는 과잉 입력을 두려워한다)
 * 게이트 조건은 여기서 되풀이하지 않는다. 막히는 순간 GATE_* 문구가 사유를 말한다.
 */
export interface StepGuide {
  do: string;
  enough: string;
  skip: string;
}

/** 세 줄의 이름표. 화면이 이 라벨로 세 줄을 구분해 그린다. */
export const STEP_GUIDE_LABELS = {
  do: '하실 일',
  enough: '이 정도면 충분합니다',
  skip: '안 하셔도 됩니다',
} as const;

export const STEP_GUIDES: readonly StepGuide[] = [
  {
    do: '직무명과 직무정의를 읽고 적합성을 고르십시오.',
    enough: '"이름은 맞는데 정의에 품질 점검이 빠져 있습니다."',
    skip: '문장을 다듬어 주실 필요는 없습니다.',
  },
  {
    do: '과업마다 적합성을 고르십시오.',
    enough: '"이 과업은 저희가 아니라 품질팀에서 합니다."',
    skip: '표현을 고쳐 적으실 필요는 없습니다. 사실만 알려 주세요.',
  },
  {
    do: '지난 1년 기준으로 과업마다 비중을 나눠 합계 100%를 맞추십시오.',
    enough: '큰 것부터 30 · 25 · 25 · 20처럼 어림수로 적으시면 됩니다.',
    skip: '시간을 재거나 계산하실 필요는 없습니다.',
  },
  {
    do: 'Skill과 수행요건을 읽고 적합성을 고르십시오.',
    enough: '"이 일에는 엑셀보다 도면 보는 능력이 더 필요합니다."',
    skip: '빠진 Skill이 없으면 추가하지 않으셔도 됩니다.',
  },
  {
    do: '요약을 확인하고 제출하십시오.',
    enough: '아래에 빨간 표시가 없으면 그대로 제출하셔도 됩니다.',
    skip: '처음부터 다시 읽어 보실 필요는 없습니다.',
  },
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
export const FTE_INPUT_HINT =
  `단위는 %이고 0에서 100 사이 정수만 입력할 수 있습니다. 위·아래 화살표 키로 ${FTE_STEP_PCT}%씩, ` +
  `Shift와 함께 누르거나 Page Up·Page Down으로 ${FTE_STEP_PCT * 10}%씩 조절할 수 있습니다. ` +
  'Home은 0%, End는 100%입니다.';

/** 합계 100% 도달 안내. 색(초록)만으로 알리지 않도록 문구·아이콘을 함께 둔다. */
export const FTE_DONE_LINE = '배분을 마쳤습니다';

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
  "입력하신 내용은 화면에 그대로 남아 있습니다. 연결을 확인한 뒤 '다시 저장'을 눌러 주세요.";

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
 * "다음 단계로 넘어갑니다"이고, 이 문장은 과업·Skill 항목에도 함께 붙는다.
 * 과업·Skill은 의견이 없어도 다음 단계로는 넘어가고 제출에서 막히므로(서버 submit_review가
 * job·task·skill 세 갈래 모두 같은 조건으로 재검증한다) 여기서는 "제출"로 적어야 사실과 맞는다.
 *
 * 무엇을 고르셨는지는 되풀이하지 않는다(v4 P8). 이 안내는 '적합'이 아닌 것을 고른 뒤에만
 * 나타나고 바로 위에 그 선택이 보이므로, 앞부분을 지워도 할 일은 그대로 전달된다.
 */
export const NOTE_REQUIRED_HINT =
  '아래 두 칸 중 하나는 적어 주셔야 제출됩니다.';

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

// ── v4 안내 문구 (기획서 GUIDE v4 §5 G6·G7 · §5 G4) ─────────────────
//
// 아래는 전부 기획안에 없어 새로 씀. 문체 규칙(파일 상단 규칙 3)을 지킨다 —
// 한 자리에 한 문장이고, 두 문장이 필요하면 그건 마이크로카피가 아니라 용어집(glossary.ts)으로 간다.

/** STEP 1 적합성 위 — 첫 항목 앞에서 멈추는 사람에게 "이것만 하면 끝"임을 알린다. */
export const HINT_STEP1_PICK_ONE = '셋 중 하나만 고르시면 이 항목은 끝납니다.';

/** STEP 3 목록 위 — 백지 공포 대응. 시작점을 손가락으로 가리켜 준다. */
export const HINT_STEP3_START = "어디서부터 할지 모르시겠으면 '균등 배분으로 시작'을 누르고 큰 것부터 올리십시오.";

/** STEP 4 Skill·수행요건 위 — 가장 흔한 오해(내 스펙을 적는 칸)를 미리 막는다. */
export const HINT_STEP4_WHO = '지금 하시는 분이 아니라 새로 맡을 사람 기준으로 봐 주십시오.';

/** 신규 제안 편집기 — 비워 두어도 된다는 사실을 밝힌다(과잉 입력 방지). */
export const HINT_NEW_SUGGESTION_OPTIONAL = '빠진 것이 없으면 비워 두셔도 됩니다.';

/**
 * 제출 확인 모달 본문 3줄(§5 G7).
 * 지금까지는 "제출 후에는 수정할 수 없다" 한 줄뿐이라, 무엇이 어떻게 되는지 모른 채 눌러야 했다.
 * 세 번째 줄은 0% 과업 안내(fteZeroPctNote)와 같은 결이다 — 허용은 하되 인지시킨다.
 */
export const SUBMIT_NOTICE = [
  '제출하시면 담당자가 확인합니다.',
  "제출 후에는 수정하실 수 없습니다. 고칠 곳이 생기면 '문의하기'로 알려 주십시오.",
  '비어 있는 항목이 있어도 제출은 됩니다.',
] as const;

/**
 * 검토 화면 첫 진입 안내(§5 G4). 카드 ⑤와 같은 넷을 같은 문장으로 짚는다 —
 * 가이드에서 한 번 읽은 말을 화면에서 다시 만나야 이름이 붙는다.
 *
 * where가 자리를 말한다. 요소를 실제로 가리키는 스포트라이트를 쓰지 않기 때문이다(coachmarks.tsx 주석).
 */
export const COACH_STEPS = [
  { where: '왼쪽 위', label: '단계 목록', note: '지금 몇 번째인지, 어디까지 끝났는지 보여 줍니다.' },
  { where: '오른쪽 위', label: '저장 표시', note: '직접 저장을 누르지 않으셔도 자동으로 저장됩니다.' },
  { where: '항목마다', label: '적합성 3버튼', note: '한 항목에서 하실 일은 여기서 하나 고르는 것입니다.' },
  { where: '오른쪽 아래', label: '문의하기', note: '막히면 여기로 남겨 주십시오. 답이 오면 알려 드립니다.' },
] as const;

export const COACH_TITLE = '이 화면 보는 법';
export const COACH_INTRO = '넷만 알고 계시면 됩니다.';
export const COACH_DONE = '알겠습니다';
