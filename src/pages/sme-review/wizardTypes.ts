/*
 * SME 검증 마법사(§6-2)와 시작 가이드(§6-1)가 공유하는 타입.
 *
 * Phase 2는 마법사 셸·STEP 1~2·STEP 3(FTE)·STEP 4~5·가이드/문의를 나눠 만든다.
 * 각자 자기 화면에서 props 모양을 새로 정하면 셸과 단계가 어긋나므로, 경계에 놓이는 타입만
 * 여기 모은다. 화면 문구는 여기 두지 않는다 — copy.ts가 그 자리다.
 *
 * 타입만 둔다. 값·컴포넌트·함수 구현은 넣지 않는다(런타임 의존 0, import는 전부 type-only).
 * copy.ts가 이 파일의 StepNo를 참조하므로, 반대 방향으로 copy.ts를 import 하지 않는다(순환 금지).
 */
import type { JobDetail } from '@/lib/jobApi';
import type { ReviewState, SuggestionInput } from '@/lib/reviewApi';
import type { Feedback, User } from '@/types';
import type { ListState } from './sections';

// ── 단계 ────────────────────────────────────────────────────────────

/** 마법사 단계 번호. URL의 ?step=1..5와 같은 값이다(§5-3 라우트). */
export type StepNo = 1 | 2 | 3 | 4 | 5;

/**
 * 단계 게이트 판정 결과(§6-2 표 "다음 단계 이동 게이트").
 * reasons는 로그가 아니라 사용자에게 그대로 보여 줄 문구다 — copy.ts의 GATE_* 문구를 넣는다.
 * ok=true면 reasons는 빈 배열이다.
 */
export interface StepGateResult {
  ok: boolean;
  reasons: string[];
}

// ── STEP 3 투입 비중(FTE) ───────────────────────────────────────────

/**
 * FTE 배분 대상 한 줄(§6-2 STEP 3 "대상 목록" · v2 §5-3).
 * STEP 2 결과가 실시간 반영된다 — 유지 Task + SME가 추가한 신규 제안 Task.
 * 삭제 제안한 Task는 이 목록에 만들지 않고 excluded로 따로 돌려준다(되살리기 안내가 쓴다).
 *
 * key: 화면 상태(FteRow)와 짝을 맞추는 키. 기존 Task는 `task-${taskId}`,
 *      신규 제안은 `sug-${clientKey}`다. 배열 인덱스를 쓰지 않으므로 앞의 제안을 지워도
 *      뒤의 값이 밀리지 않고, 제안 이름을 고쳐도 배분이 그대로 따라온다(v2 F5).
 * clientKey: 신규 제안의 안정 키. 서버가 이 값으로 new_task_suggestions 행을 찾는다.
 * suitability·suggestedName: STEP 2에서 남긴 판정과 수정 제안명. 배분 행 머리에 함께 그린다.
 * activities: 「다시 보기」 펼침에서 의견을 받는 세부활동 목록(결정 D2). 배분 대상은 아니다.
 */
export interface FteTarget {
  key: string;
  targetType: 'EXISTING' | 'SUGGESTED';
  taskId: string | null;
  clientKey: string | null;
  name: string;
  description: string;
  isNew: boolean;
  suitability: string;
  suggestedName: string;
  activities: { id: string; name: string }[];
}

/** 삭제 제안으로 배분 대상에서 빠진 과업. STEP 3에서 되살릴 수 있어야 하므로 이름까지 들고 온다. */
export interface FteExcluded {
  taskId: string;
  name: string;
}

/** 배분 값 한 줄. pct는 0~100 정수(§6-2 입력 방식). key는 짝이 되는 FteTarget.key다. */
export interface FteRow {
  key: string;
  pct: number;
}

// ── 마법사 셸 → 단계 컴포넌트 공통 props ────────────────────────────

/**
 * 셸(SmeReviewPage)이 이미 들고 있는 상태를 그대로 내려 준다. 단계 컴포넌트는 자기 상태를
 * 따로 만들지 않는다 — 자동 저장(2.5초)·이탈 복원·진행률이 전부 셸의 상태를 기준으로 돌기 때문이다.
 *
 * onDirty는 feedback 이외의 값(newTasks·newSkills·FTE)을 바꾼 뒤 부른다. update()는 안에서
 * 이미 dirty 처리를 하므로 따로 부르지 않아도 된다.
 */
export interface StepProps {
  /** 제출 완료(SUBMITTED·RESUBMITTED)이거나 검토 세션이 없으면 true. 입력 전체를 잠근다. */
  readOnly: boolean;
  jobDetail: JobDetail;
  /** 검토 세션. 아직 열리지 않았으면 null이다(그 경우 readOnly가 true). */
  review: ReviewState | null;
  /** 항목 키 → 적합성·의견·수정안. 키는 'name' | 'definition' | `task-${id}` | `skill-${id}` | 'req-*'. */
  feedback: Record<string, Feedback>;
  update: (key: string, value: Partial<Feedback>) => void;
  newTasks: SuggestionInput[];
  setNewTasks: (items: SuggestionInput[]) => void;
  newSkills: SuggestionInput[];
  setNewSkills: (items: SuggestionInput[]) => void;
  /** 목록 표시 상태(미평가만 보기 / 완료 접기). sections.tsx의 목록 렌더러에 그대로 넘긴다. */
  listState: ListState;
  /** 이 단계의 평가 완료 수 / 전체 수. SectionHeading에 그대로 넘긴다. */
  done: number;
  total: number;
  /** feedback 이외의 값을 바꿨을 때 호출 — 자동 저장 타이머를 다시 건다. */
  onDirty: () => void;
  /** 게이트 안내·제출 요약의 바로가기가 쓰는 단계 이동. */
  goToStep: (step: StepNo) => void;
}

/**
 * STEP 3 전용 props. 대상 목록은 셸이 STEP 2 상태에서 만들어 내려 주고(즉시 동기화),
 * 배분 값만 이 단계가 다룬다.
 */
export interface FteStepProps extends StepProps {
  targets: FteTarget[];
  rows: FteRow[];
  setRows: (rows: FteRow[]) => void;
  /** 삭제 제안으로 목록에서 빠진 과업. 빈 배열이면 안내를 표시하지 않는다. */
  excluded: FteExcluded[];
}

// ── 가이드·문의 ─────────────────────────────────────────────────────

/** 시작 가이드 화면(/guide). onDone은 마지막 카드의 "시작하기"가 부른다(guide_completed_at 기록). */
export interface GuidePageProps {
  user: User;
  onDone: () => void;
}

/** 문의 버튼(화면 우측 하단, 전 단계 공통). 직무(review)와 현재 단계가 문의에 자동 첨부된다. */
export interface InquiryButtonProps {
  reviewId: string | null;
  step: StepNo;
}
