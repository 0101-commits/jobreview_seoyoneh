/*
 * 워크숍 후보 자동 판별 임계값 · 사유 문구 — 한곳에 모은다.
 *
 * 근거: docs/PLAN.html §6-3 ⓑ 「워크숍 플래깅(R7)」의 자동 규칙 4종
 *       ① '부적합' 판정 비율 ≥ 30%
 *       ② SME 간 FTE 1위 과업 불일치
 *       ③ 신규 제안 Task ≥ 3건
 *       ④ SME 응답 1명뿐(교차 확인 불가)
 *   및 §11-2 Phase 3 제약 「임계값(30%/20%p/3건)은 상수 파일로 분리해 §12 확정 후 조정 가능하게」.
 *
 * ★ 파일럿 후 조정 — §12 오픈이슈 5번:
 *   "초기값(부적합 30% · FTE 차 20%p · 신규 3건)은 가설이므로 파일럿 후 조정".
 *   확정 주체는 PM(상무)이다. 값이 바뀌면 이 파일만 고친다 —
 *   판정 로직(src/lib/adminApi.ts의 computeJobSignals)과 화면은 전부 이 상수를 읽는다.
 *   화면·조건문에 숫자를 다시 적어 넣지 말 것. 그 순간 §12 확정이 두 곳을 고쳐야 하는 일이 된다.
 */

export const WORKSHOP_THRESHOLDS = {
  /**
   * 자동 규칙 ① — '부적합' 판정 비율. 0~1 사이 비율이다(0.30 = 30%).
   * 분모는 그 직무의 제출된 검토에 달린 적합성 판정 전체(직무정의·Task·Skill), 분자는 그중 UNSUITABLE.
   * 파일럿 후 조정(§12 오픈이슈 5).
   */
  unsuitableRatio: 0.3,

  /**
   * 자동 규칙 ② 보조 · 비교 뷰 하이라이트 기준 — 동일 과업에 대한 SME 간 투입 비중 차(%p).
   * §6-3 ⓑ 비교 뷰: "동일 과업 비중 차 ≥ 20%p", 그림 6-B의 하이라이트 행 기준이다.
   * 파일럿 후 조정(§12 오픈이슈 5).
   */
  ftePointGap: 20,

  /**
   * 자동 규칙 ③ — 신규 제안 Task 건수. 같은 이름의 제안은 여러 SME가 냈어도 1건으로 센다
   * (서로 같은 과업을 제안한 것이므로 "제안이 많다"의 근거가 되지 못한다).
   * 파일럿 후 조정(§12 오픈이슈 5).
   */
  newTaskSuggestions: 3,

  /**
   * 자동 규칙 ④ — 교차 확인에 필요한 최소 응답 수. 이 수에 못 미치면(=1명뿐이면) 워크숍 후보다.
   * §12 오픈이슈 3번("SME 1인뿐인 직무의 취급")도 이 규칙을 판별 근거로 삼는다.
   * 파일럿 후 조정(§12 오픈이슈 5).
   */
  minSmeForCrossCheck: 2,
} as const;

/** job_workshop_flags.reasons에 들어갈 사유 문구의 키. */
export type WorkshopReasonKey = 'unsuitableRatio' | 'fteTopMismatch' | 'newTaskSuggestions' | 'singleSme';

/*
 * 자동 규칙 사유 문구 — job_workshop_flags.reasons(text[])에 그대로 들어가고
 * Export(§9 E4)의 "플래그 사유" 열에도 그대로 실린다.
 *
 * 'unsuitableRatio'·'fteTopMismatch' 두 개는 기획안 §7-1 ⑤의 예시 문자열
 *   reasons text[] not null default '{}'  -- 예: {'부적합 30%+','FTE 1위 불일치'}
 * 을 그대로 쓴다. 나머지 둘은 기획안에 예시가 없어 같은 형태(짧은 명사구)로 지었다.
 *
 * 숫자는 WORKSHOP_THRESHOLDS에서 만들어 넣는다. 문구에 30·3을 손으로 적어 두면
 * §12에서 임계값을 조정하는 순간 사유 문구만 옛 숫자로 남아 근거가 거짓이 된다.
 */
export const WORKSHOP_REASONS: Record<WorkshopReasonKey, string> = {
  unsuitableRatio: `부적합 ${Math.round(WORKSHOP_THRESHOLDS.unsuitableRatio * 100)}%+`,
  fteTopMismatch: 'FTE 1위 불일치',
  newTaskSuggestions: `신규 제안 ${WORKSHOP_THRESHOLDS.newTaskSuggestions}건+`,
  singleSme: 'SME 응답 1명',
};

/*
 * 비교 뷰(§6-3 ⓑ · 그림 6-B)의 이견 신호 배지 문구.
 * 사유 문구와 같은 이유로 여기에 둔다 — %p 숫자가 임계값에서 나와야 한다.
 */
export const SIGNAL_LABELS = {
  /** 같은 항목에 대해 SME들의 적합성 판정이 갈린 행. */
  suitabilityMismatch: '적합성 판정 불일치',
  /** 동일 과업에 대한 비중 차가 임계값 이상인 행. */
  fteGap: `FTE 비중 차 ${WORKSHOP_THRESHOLDS.ftePointGap}%p+`,
  /** 신규 제안 과업인데 일부 SME만 제안한 행(그림 6-B의 "－ 미제안"). */
  newTaskMismatch: '신규 제안 불일치',
} as const;
