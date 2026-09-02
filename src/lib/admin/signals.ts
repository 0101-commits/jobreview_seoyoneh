import {
  FteTargetType,
  ReviewStatus,
  SIGNAL_LABELS,
  Suitability,
  WORKSHOP_REASONS,
  WORKSHOP_THRESHOLDS,
  byKorean,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 3. 이견 신호·워크숍 자동 규칙 (§6-3 ⓑ) — 제출 큐와 비교 뷰가 함께 쓰는 계산
// ────────────────────────────────────────────────────────────────────

/*
 * 제출 큐의 "이견 신호 배지 수"와 비교 뷰의 하이라이트는 같은 수여야 한다.
 * 두 곳에서 따로 세면 목록에는 2건인데 열어 보면 3건인 화면이 나온다.
 * 그래서 계산은 이 순수 함수 하나에만 둔다. 조회 함수는 입력을 모아 주기만 한다.
 */

/**
 * 신호 계산에 넣을 "제출된" 검토인가. 제출 큐와 비교 뷰가 반드시 같은 답을 내야 하므로
 * 판정은 이 함수 하나뿐이다 — 계산(computeJobSignals)을 한곳에 모아도 입력 집합이 갈리면
 * 목록에는 2건인데 열어 보면 3건인 화면이 그대로 나온다.
 *
 * submitted_at은 보지 않는다. decide_review·request_rereview는 반려해도 submitted_at을
 * 지우지 않으므로(20260901030000 "submitted_at 은 지우지 않는다") 그 값으로 거르면
 * 반려되어 지금 SME가 다시 편집 중인 초안이 제출본으로 비교에 섞인다.
 */
export function isComparableReview(status: ReviewStatus | null): boolean {
  return status === 'SUBMITTED' || status === 'RESUBMITTED';
}

export type JobSignalKind = 'SUITABILITY' | 'FTE_GAP' | 'NEW_TASK';

export interface JobSignal {
  kind: JobSignalKind;
  /** 비교 뷰에서 하이라이트할 행 키. 'job:NAME' · 'task:<id>' · 'skill:<id>' · 'new:<이름>'. */
  key: string;
  /** 행 이름(과업명 등). 목록 화면이 배지 옆에 그대로 쓴다. */
  name: string;
  label: string;
}

/** computeJobSignals의 입력. 조회 함수가 raw 행을 이 모양으로 정리해서 넘긴다. */
export interface JobSignalInput {
  /** 이 직무의 "제출된" 검토 id. 신호는 제출된 응답끼리만 비교한다(작성 중 초안 비교는 잡음이다). */
  reviewIds: string[];
  /** 적합성 판정. key = 'job:NAME' · 'task:<id>' · 'skill:<id>'. */
  suitability: { key: string; name: string; reviewId: string; value: Suitability | null }[];
  /** FTE 배분. key = 'task:<id>'(기존) · 'new:<이름>'(신규 제안). */
  fte: { key: string; name: string; targetType: FteTargetType; reviewId: string; pct: number }[];
  /** 신규 제안 Task 이름(검토별). 같은 이름은 자동 규칙 ③에서 1건으로 센다. */
  newTasks: { reviewId: string; name: string }[];
}

/** 비교 뷰의 FTE 행 하나(그림 6-B의 한 줄). */
export interface FteRow {
  key: string;
  name: string;
  targetType: FteTargetType;
  /**
   * reviewId → 비중. null은 두 경우다 — 신규 제안인데 그 SME가 제안하지 않았거나("－ 미제안"),
   * 그 SME가 FTE를 한 줄도 내지 않았거나("－ 미응답"). 둘 다 0%와 구분해야 한다.
   */
  pct: Record<string, number | null>;
  /** 응답 간 최대 비중 차(%p). */
  maxGap: number;
  /** maxGap ≥ WORKSHOP_THRESHOLDS.ftePointGap. */
  gapFlagged: boolean;
  /** 신규 제안인데 일부 SME만 제안한 행. */
  proposalMismatch: boolean;
}

export interface JobSignalResult {
  smeCount: number;
  fteRows: FteRow[];
  /** reviewId → 1위 과업 키. 배분이 하나도 없으면 null. */
  topTaskByReview: Record<string, string | null>;
  /** 자동 규칙 ② — SME 간 FTE 1위 과업 불일치. */
  topTaskMismatch: boolean;
  /** 자동 규칙 ① 분자/분모. 판정이 하나도 없으면 0. */
  unsuitableRatio: number;
  /** 자동 규칙 ③ — 이름이 다른 신규 제안 Task 수. */
  newTaskCount: number;
  /** 이견 신호(행 단위). 배지 수 = signals.length. */
  signals: JobSignal[];
  /** 자동 규칙에 지금 걸리는 사유. job_workshop_flags.reasons에 그대로 넣는다. */
  workshopReasons: string[];
}

/** 신규 제안은 SME마다 id가 다르므로 이름으로 같은 과업을 맞춘다. 공백·대소문자 차이는 무시한다. */
export function suggestionKey(name: string): string {
  return `new:${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * 이견 신호와 워크숍 자동 규칙을 한곳에서 계산한다(§6-3 ⓑ).
 *
 * 이견 신호는 "행 단위 하이라이트"만 센다 — 적합성 판정이 갈린 항목, 비중 차가 임계값 이상인 행,
 * 일부 SME만 제안한 신규 과업 행. FTE 1위 불일치는 행이 아니라 직무 전체의 성질이므로
 * 배지가 아니라 워크숍 자동 규칙 ②로만 잡는다(그림 6-B의 "이견 신호 2건"이 이 셈법이다).
 */
export function computeJobSignals(input: JobSignalInput): JobSignalResult {
  const reviewIds = input.reviewIds;
  const smeCount = reviewIds.length;
  const signals: JobSignal[] = [];

  // ── 적합성 판정 불일치 ──
  const suitabilityByKey = new Map<string, { name: string; values: Map<string, Suitability> }>();
  let judged = 0;
  let unsuitable = 0;
  for (const row of input.suitability) {
    if (!row.value) continue;
    judged += 1;
    if (row.value === 'UNSUITABLE') unsuitable += 1;
    let entry = suitabilityByKey.get(row.key);
    if (!entry) {
      entry = { name: row.name, values: new Map() };
      suitabilityByKey.set(row.key, entry);
    }
    entry.values.set(row.reviewId, row.value);
  }
  for (const [key, entry] of suitabilityByKey) {
    if (new Set(entry.values.values()).size > 1) {
      signals.push({ kind: 'SUITABILITY', key, name: entry.name, label: SIGNAL_LABELS.suitabilityMismatch });
    }
  }

  // ── FTE 행 ──
  const fteByKey = new Map<string, { name: string; targetType: FteTargetType; pct: Map<string, number> }>();
  for (const row of input.fte) {
    let entry = fteByKey.get(row.key);
    if (!entry) {
      entry = { name: row.name, targetType: row.targetType, pct: new Map() };
      fteByKey.set(row.key, entry);
    }
    // 같은 검토에 같은 대상이 두 줄일 수 없다(부분 unique 인덱스). 그래도 들어오면 큰 쪽을 남긴다.
    entry.pct.set(row.reviewId, Math.max(entry.pct.get(row.reviewId) ?? 0, row.pct));
  }

  /*
   * FTE를 한 줄도 내지 않은 검토는 FTE 비교에서 통째로 뺀다.
   * 배분 0행은 "모든 과업에 0%를 썼다"가 아니라 "FTE를 아직 답하지 않았다"이다 —
   * survey_settings.fte_required가 꺼진 회사(20260901040000 3항)와 그 플래그를 켜기 전
   * 제출분에서 실제로 생긴다. 0으로 채우면 상대가 20%p 이상 배분한 모든 행이 거짓으로
   * 하이라이트되고 그 직무가 이견 신호 수 순으로 제출 큐 맨 위에 올라간다.
   * 아래 1위 과업 계산이 배분 없는 검토를 이미 null로 빼는 것과 같은 취급이다.
   */
  const answeredFte = new Set(input.fte.map((f) => f.reviewId));
  const fteReviewCount = reviewIds.filter((id) => answeredFte.has(id)).length;

  const fteRows: FteRow[] = [];
  for (const [key, entry] of fteByKey) {
    const pct: Record<string, number | null> = {};
    const values: number[] = [];
    for (const reviewId of reviewIds) {
      const v = entry.pct.get(reviewId);
      if (v !== undefined) {
        pct[reviewId] = v;
        values.push(v);
      } else if (!answeredFte.has(reviewId)) {
        // FTE 자체를 내지 않은 응답. 0도 아니고 미제안도 아니라 비교에서 뺀다.
        pct[reviewId] = null;
      } else if (entry.targetType === 'SUGGESTED') {
        // 제안하지 않은 것과 0%를 배분한 것은 다르다. 0으로 채우면 "미제안"이 사라진다.
        pct[reviewId] = null;
      } else {
        // 확정 과업인데 배분이 없으면 "이 과업에 시간을 쓰지 않는다"는 응답이다.
        pct[reviewId] = 0;
        values.push(0);
      }
    }
    const maxGap = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    // 분모는 smeCount가 아니라 FTE를 낸 검토 수다 — 답하지 않은 사람을 "제안하지 않은 사람"으로 세지 않는다.
    const proposalMismatch =
      entry.targetType === 'SUGGESTED' &&
      fteReviewCount > 1 &&
      entry.pct.size > 0 &&
      entry.pct.size < fteReviewCount;
    const gapFlagged = maxGap >= WORKSHOP_THRESHOLDS.ftePointGap;
    fteRows.push({ key, name: entry.name, targetType: entry.targetType, pct, maxGap, gapFlagged, proposalMismatch });

    if (gapFlagged) {
      signals.push({ kind: 'FTE_GAP', key, name: entry.name, label: SIGNAL_LABELS.fteGap });
    } else if (proposalMismatch) {
      // 같은 행을 두 번 세지 않는다. 배지 수가 행 수보다 많아지면 화면과 목록이 어긋난다.
      signals.push({ kind: 'NEW_TASK', key, name: entry.name, label: SIGNAL_LABELS.newTaskMismatch });
    }
  }
  fteRows.sort((a, b) => byKorean(a.name, b.name));

  // ── FTE 1위 과업 ──
  const topTaskByReview: Record<string, string | null> = {};
  for (const reviewId of reviewIds) {
    let topKey: string | null = null;
    let topPct = -1;
    // 동점이면 키 순으로 고정한다. 새로고침할 때마다 1위가 바뀌면 근거가 되지 못한다.
    for (const key of [...fteByKey.keys()].sort()) {
      const v = fteByKey.get(key)?.pct.get(reviewId);
      if (v !== undefined && v > topPct) {
        topPct = v;
        topKey = key;
      }
    }
    topTaskByReview[reviewId] = topKey;
  }
  const topKeys = reviewIds.map((id) => topTaskByReview[id]).filter((k): k is string => !!k);
  const topTaskMismatch = topKeys.length > 1 && new Set(topKeys).size > 1;

  // ── 신규 제안 Task 수(이름 기준 중복 제거) ──
  const newTaskCount = new Set(input.newTasks.map((t) => suggestionKey(t.name))).size;

  const unsuitableRatio = judged > 0 ? unsuitable / judged : 0;

  const workshopReasons: string[] = [];
  if (unsuitableRatio >= WORKSHOP_THRESHOLDS.unsuitableRatio) workshopReasons.push(WORKSHOP_REASONS.unsuitableRatio);
  if (topTaskMismatch) workshopReasons.push(WORKSHOP_REASONS.fteTopMismatch);
  if (newTaskCount >= WORKSHOP_THRESHOLDS.newTaskSuggestions) workshopReasons.push(WORKSHOP_REASONS.newTaskSuggestions);
  if (smeCount > 0 && smeCount < WORKSHOP_THRESHOLDS.minSmeForCrossCheck) {
    workshopReasons.push(WORKSHOP_REASONS.singleSme);
  }

  return {
    smeCount,
    fteRows,
    topTaskByReview,
    topTaskMismatch,
    unsuitableRatio,
    newTaskCount,
    signals,
    workshopReasons,
  };
}
