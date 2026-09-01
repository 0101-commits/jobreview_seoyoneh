/*
 * 워크숍 후보 자동 규칙(§6-3 ⓑ 「워크숍 플래깅(R7)」) — 순수 계산.
 *
 * DB·React를 import 하지 않는다(adminApi는 `import type`이라 런타임에는 사라진다).
 * 화면 없이 값만 넣어 돌려볼 수 있어야 §12 파일럿에서 임계값을 조정할 때 판정이 어떻게
 * 달라지는지 확인할 수 있다.
 *
 * ── 이 파일이 규칙을 "다시 계산"하지 않는 이유 ──
 * 규칙 4종의 실제 측정(부적합 비율·1위 과업·신규 제안 수·응답 수)은 이미
 * adminApi.computeJobSignals 한 곳에서 끝난다. 제출 큐 배지와 비교 뷰가 같은 값을 쓰도록
 * 계산을 한곳에 모아 둔 것이므로, 여기서 임계값을 다시 비교하면 세 번째 셈법이 생긴다
 * (목록에는 후보인데 열어 보면 후보가 아닌 화면). 그래서 이 파일은 판정을 만들지 않고
 * 이미 나온 판정(JobSignalResult.workshopReasons)을 화면이 읽을 수 있는 형태 —
 * 규칙 번호·판정 기준·측정값·적중 여부 — 로 풀어 준다.
 *
 * 임계값과 사유 문구는 전부 workshopThresholds.ts에서 온다. 이 파일에 숫자를 적지 않는다
 * (§11-2 Phase 3 제약 · §12 오픈이슈 5 — 파일럿 후 PM(상무)이 조정할 값이다).
 *
 * ── 자동 판정과 사람의 결정 ──
 * 자동 판정은 저장된 수동 결정(job_workshop_flags.source = 'MANUAL')을 덮지 않는다.
 * 수동 결정이 있는 직무에서 자동 규칙은 "참고 신호"로만 보여 준다(WorkshopFlagPanel의 안내 배너).
 * 자동 규칙이 사람 판단을 매번 덮으면 관리자가 워크벤치에서 내린 결정이 새로고침마다 사라진다.
 */

import type { JobSignalResult, WorkshopFlagSource } from './adminApi';
import { WORKSHOP_REASONS, WORKSHOP_THRESHOLDS, type WorkshopReasonKey } from './workshopThresholds';

/**
 * 화면이 그릴 워크숍 상태 4가지. 제출 큐 칸과 비교 뷰 헤더가 같은 답을 내야 해서 여기 하나뿐이다.
 *   FLAGGED        — 워크숍 후보로 저장됨(자동·수동 공통).
 *   MANUAL_CLEARED — 사람이 확인하고 대상에서 뺀 직무. 자동 규칙에 다시 걸려도 후보로 되돌리지 않는다.
 *   AUTO_PENDING   — 자동 규칙에는 걸렸지만 아직 저장된 결정이 없다.
 *   NONE           — 해당 없음.
 *
 * MANUAL_CLEARED를 AUTO_PENDING과 뭉뚱그리면 사람이 사유까지 적어 내린 해제가 화면에서
 * '지정 전'·'워크숍 후보'로 되살아나 같은 결정을 다시 누르게 된다(이 파일 상단 원칙 참조).
 */
export type WorkshopDecisionState = 'FLAGGED' | 'MANUAL_CLEARED' | 'AUTO_PENDING' | 'NONE';

export function workshopDecisionOf(
  flag: { flagged: boolean; source: WorkshopFlagSource } | null | undefined,
  autoReasons: string[],
): WorkshopDecisionState {
  if (flag?.flagged) return 'FLAGGED';
  if (flag && flag.source === 'MANUAL') return 'MANUAL_CLEARED';
  return autoReasons.length > 0 ? 'AUTO_PENDING' : 'NONE';
}

/**
 * 측정값까지 갖춘 입력 = adminApi.fetchJobComparison의 반환값(JobComparison).
 * JobComparison은 JobSignalResult를 확장하므로 그대로 넘기면 되고,
 * 테스트에서는 이 다섯 필드만 채운 평범한 객체를 넘기면 된다.
 */
export type WorkshopRuleMeasures = Pick<
  JobSignalResult,
  'smeCount' | 'unsuitableRatio' | 'topTaskMismatch' | 'newTaskCount' | 'workshopReasons'
>;

/**
 * 사유 목록만 아는 입력. 제출 큐(SubmissionQueueItem.workshopReasons)처럼 측정값 없이
 * 사유만 들고 있는 화면이 쓴다. 이때 측정값(measured)은 만들지 않고 null로 둔다 —
 * 모르는 수치를 0으로 채워 보여 주면 "제출 SME 0명" 같은 거짓말이 화면에 남는다.
 */
export interface WorkshopRuleReasonsOnly {
  workshopReasons: string[];
}

export type WorkshopRuleInput = WorkshopRuleMeasures | WorkshopRuleReasonsOnly;

function hasMeasures(input: WorkshopRuleInput): input is WorkshopRuleMeasures {
  return 'smeCount' in input;
}

/** 자동 규칙 한 줄. 화면은 이 값만 읽어 그린다 — 기준 문구·측정값을 화면에서 짓지 않는다. */
export interface WorkshopRule {
  key: WorkshopReasonKey;
  /** §6-3 ⓑ의 규칙 번호(①~④). 화면이 "규칙 ②"로 쓴다. */
  no: number;
  /** 규칙 이름. */
  title: string;
  /** 판정 기준. 임계값에서 만든다 — 화면에 그대로 작게 붙여 "왜 걸렸는지"를 보이게 한다. */
  criterion: string;
  /**
   * 이 직무의 측정값. 걸리지 않은 규칙도 값을 보여 준다(무엇이 모자라 안 걸렸는지 보이게).
   * 입력이 사유 목록뿐이면 null — 화면은 이 줄을 그리지 않는다.
   */
  measured: string | null;
  /** 지금 이 규칙에 걸렸는가. */
  hit: boolean;
  /** hit일 때 job_workshop_flags.reasons에 들어가는 사유 문구. */
  reason: string;
}

export interface WorkshopRuleEvaluation {
  /** 자동 규칙 중 하나라도 걸렸는가 = 자동 판정상 워크숍 후보. */
  flagged: boolean;
  /** 저장할 사유(§10 P3 DoD ③). computeJobSignals가 만든 문구를 그대로 넘긴다. */
  reasons: string[];
  /** 규칙 4종 전부(①~④ 순서). 걸린 것·안 걸린 것을 함께 담는다. */
  rules: WorkshopRule[];
  /**
   * 판정이 가능한 상태인가(제출된 검토가 1건 이상). 측정값을 받지 못했으면 null(=알 수 없음).
   * 제출이 0건이면 "규칙에 걸리는 신호가 없음"이 아니라 "아직 판정할 수 없음"이다.
   * 둘을 같은 문구로 보여 주면 관리자가 미제출 직무를 검토가 끝난 직무로 읽는다.
   */
  evaluable: boolean | null;
}

/** 29.6%와 30%를 구분해 보여 준다. 반올림으로 29.6%가 "30%"가 되면 안 걸린 이유를 설명할 수 없다. */
function pctText(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/*
 * 규칙별 표시 문구. Record<WorkshopReasonKey, …>라서 사유 키가 늘면 여기가 컴파일 오류로 막는다
 * (규칙을 추가하고 화면 설명을 빠뜨리는 실수를 타입이 잡는다).
 *
 * 규칙마다 "왜 이 신호가 조정 필요를 뜻하는가"를 한 줄로 남긴다 — 13면 "조정 필요 직무에 한해
 * 워크숍 병행(대상 최소화)"의 판별 근거이므로, 이 목록이 Export(§9 E4)로 나갔을 때
 * 각 줄이 무엇을 근거로 뽑힌 것인지 문서 없이도 읽혀야 한다.
 */
const RULE_TEXT: Record<
  WorkshopReasonKey,
  { no: number; title: string; criterion: string; measured: (c: WorkshopRuleMeasures) => string }
> = {
  // ① 기존 직무기술서 자체가 현업과 어긋난다는 뜻 — 문항 몇 개 고쳐서 될 일이 아니라 마주 앉아 다시 그려야 한다.
  unsuitableRatio: {
    no: 1,
    title: "'부적합' 판정 비율",
    criterion: `판정된 항목의 ${pctText(WORKSHOP_THRESHOLDS.unsuitableRatio)} 이상이 '부적합'`,
    /*
     * 분모 = 이 직무의 "제출된" 검토에 달린 적합성 판정 중 실제로 판정된 것 전부.
     *   (직무 항목 + Task + Skill + 수행요건) × 제출 SME 수 중, 값이 들어온 것만.
     * 미응답(값 없음)은 분모에서 빠진다 — 보지 않은 항목을 '적합'으로 세면 비율이 낮게 나와
     * 정작 절반만 답한 직무에서 신호가 죽는다. 작성 중인 검토는 분모·분자 어디에도 넣지 않는다
     * (adminApi.computeJobSignals의 judged 변수가 이 정의 그대로다).
     */
    measured: (c) => `판정된 항목 중 '부적합' ${pctText(c.unsuitableRatio)}`,
  },
  // ② 같은 직무를 두고 "무슨 일이 중심인가"가 갈린 것 — 비중 몇 %p 차이가 아니라 직무의 정의가 흔들린 상태다.
  fteTopMismatch: {
    no: 2,
    title: 'SME 간 FTE 1위 과업 불일치',
    criterion: 'SME 간 FTE 1위 과업이 서로 다름',
    /*
     * 1위 동률 처리: computeJobSignals가 과업 키 순으로 정렬해 첫 번째 최대값을 1위로 고정한다.
     * 새로고침할 때마다 1위가 바뀌면 판별 근거가 되지 못하기 때문이다. 다만 한 SME 안에서
     * 1위가 동률이면(예: 30%·30%) 실제로는 1위가 둘인데 하나로 접히므로 이 규칙이 불일치를
     * 과다 검출할 수 있다 — §12 파일럿에서 확인할 항목. 비교 대상이 1명뿐이면 불일치를 따질 수 없다.
     */
    measured: (c) =>
      c.smeCount < WORKSHOP_THRESHOLDS.minSmeForCrossCheck
        ? '비교할 응답이 부족해 판정할 수 없음'
        : c.topTaskMismatch
          ? 'SME마다 1위 과업이 다름'
          : '1위 과업이 일치함',
  },
  // ③ 기술서에 없는 일이 여러 건 올라온 직무 — 항목 수정이 아니라 과업 구성 자체를 다시 짜야 한다.
  newTaskSuggestions: {
    no: 3,
    title: '신규 제안 Task',
    criterion: `이름이 다른 신규 제안 ${WORKSHOP_THRESHOLDS.newTaskSuggestions}건 이상`,
    /*
     * 1인 기준이 아니라 이 직무의 SME 합산이다. 다만 이름이 같은 제안은 여러 SME가 냈어도 1건으로 센다
     * (공백·대소문자 차이는 무시 — adminApi.suggestionKey). 두 SME가 같은 과업을 제안한 것은
     * "빠진 과업이 하나 있다"는 뜻이지 "제안이 둘"이 아니다.
     */
    measured: (c) => `이름이 다른 신규 제안 ${c.newTaskCount}건`,
  },
  // ④ 답이 하나뿐이면 맞는지 틀리는지 견줄 상대가 없다 — 확인 자체가 불가능해 대면으로 메운다(§12 오픈이슈 3).
  singleSme: {
    no: 4,
    title: '교차 확인 가능 여부',
    criterion: `제출한 SME가 ${WORKSHOP_THRESHOLDS.minSmeForCrossCheck}명 미만`,
    measured: (c) => `제출한 SME ${c.smeCount}명`,
  },
};

/**
 * 자동 규칙 판정 결과를 화면이 읽을 형태로 푼다(§6-3 ⓑ).
 *
 * 적중 여부는 임계값을 다시 비교해서가 아니라 computeJobSignals가 만든 사유 목록에 그 규칙의
 * 사유 문구가 들어 있는지로 정한다 — 그래야 제출 큐 배지·비교 뷰·이 패널이 언제나 같은 답을 낸다.
 */
export function evaluateWorkshopRules(comparison: WorkshopRuleInput): WorkshopRuleEvaluation {
  const measures = hasMeasures(comparison) ? comparison : null;
  const fired = new Set(comparison.workshopReasons);
  const keys = Object.keys(RULE_TEXT) as WorkshopReasonKey[];

  const rules = keys
    .map((key) => {
      const text = RULE_TEXT[key];
      return {
        key,
        no: text.no,
        title: text.title,
        criterion: text.criterion,
        measured: measures ? text.measured(measures) : null,
        hit: fired.has(WORKSHOP_REASONS[key]),
        reason: WORKSHOP_REASONS[key],
      };
    })
    .sort((a, b) => a.no - b.no);

  return {
    // 사유가 하나라도 있으면 후보다. rules가 아니라 원본 사유 목록으로 판단해,
    // 나중에 규칙이 늘어 이 파일의 설명이 빠져도 후보 판정 자체는 어긋나지 않게 한다.
    flagged: comparison.workshopReasons.length > 0,
    reasons: comparison.workshopReasons,
    rules,
    evaluable: measures ? measures.smeCount > 0 : null,
  };
}
