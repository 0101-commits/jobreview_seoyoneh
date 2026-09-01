/*
 * SME 직무 검토 화면 — §6-2 검증 마법사 5단계.
 *
 * 이 앱에서 가장 중요한 화면이다. 실제 저장은 src/lib/reviewApi.ts(RPC 한 트랜잭션)와
 * src/lib/surveyApi.ts(FTE 배분)가 담당하고, 단계별 렌더러와 공통 조각은 src/pages/sme-review/ 에 있다.
 * 단계 목록·저장 칩·게이트 판정은 ./sme-review/wizard.tsx, 화면 문구는 ./sme-review/copy.ts에 있다.
 *
 * 직무 선택 드롭다운(직군·직렬·직무 3단 Select)은 이 개편에서 없앴다.
 * §5-1·§5-3에 따라 SME의 진입 경로는 /assignments → /review/:jobId 하나뿐이고, 배정되지 않은
 * 직무는 애초에 저장할 review 행을 만들 수 없다(getOrCreateReviewForJob가 예외를 던진다).
 * 드롭다운은 "고를 수는 있는데 저장은 안 되는" 직무를 화면에 계속 노출해 실패를 유도했고,
 * 배정 목록과 검토 화면 두 곳이 서로 다른 직무를 진실로 삼는 상태를 만들었다.
 * 그래서 화면 상단에는 현재 직무를 읽기 전용으로만 표시하고 목록으로 돌아가는 링크를 둔다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Lock, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';
import { fetchJobDetailResult, type JobDetail } from '@/lib/jobApi';
import {
  buildDraftPayload,
  client,
  fetchReviewFeedback,
  getOrCreateReviewForJob,
  saveReviewDraft,
  submitReview,
  toFeedbackState,
  type MissingItem,
  type ReviewState,
  type ReviewStatus,
  type SuggestionInput,
} from '@/lib/reviewApi';
import {
  endReviewSession,
  fetchFteAllocations,
  saveFteAllocations,
  startReviewSession,
  type FteAllocationInput,
} from '@/lib/surveyApi';
import type { Feedback, User } from '@/types';
import { SectionHeading } from './sme-review/controls';
import {
  FeedbackSection,
  RequirementFeedback,
  SkillFeedback,
  TaskActivityFeedback,
  type ListState,
} from './sme-review/sections';
import { FteStep, buildFteTargets, fteTotal, fteZeroTargets } from './sme-review/fte';
import { InquiryButton } from './sme-review/inquiry';
import {
  GateNotice,
  REQ_KEYS,
  STEPS,
  SaveStatusChip,
  StepChecklist,
  evaluateStep,
  type SaveState,
  type StepChecklistItem,
} from './sme-review/wizard';
import {
  FTE_NEXT_BLOCKED_BUTTON,
  NEXT_STEP_BUTTON,
  PREV_STEP_BUTTON,
  STEP_GUIDES,
  STEP_GUIDE_SUMMARY,
  STEP_TITLES,
  TASK_EXAMPLES,
  TASK_EXAMPLE_INTRO,
  TASK_EXAMPLE_SUMMARY,
  TASK_EXAMPLE_TIP,
  fteZeroPctNote,
  gateStep5Missing,
  stepBarTitle,
} from './sme-review/copy';
import type { FteRow, FteTarget, StepNo } from './sme-review/wizardTypes';

const STATUS_LABEL: Record<ReviewStatus, string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '작성 중',
  SUBMITTED: '제출 완료',
  REVIEW_REQUESTED: '재검토 요청',
  RESUBMITTED: '재제출 완료',
};

const EMPTY_FEEDBACK: Feedback = { suitability: '', comment: '', suggestion: '' };

const errMsg = (e: unknown) =>
  e instanceof Error && e.message ? e.message : '알 수 없는 오류로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

/** 서버가 돌려준 부족 항목의 step은 0(가이드)이나 범위 밖일 수 있다. 화면 이동은 1~5로만 한다. */
const toStepNo = (n: number): StepNo => (n >= 1 && n <= 5 ? (n as StepNo) : 5);

/**
 * 신규 과업 제안의 DB id를 이름으로 찾는다.
 *
 * FTE의 SUGGESTED 행은 new_task_suggestions(id)를 참조하는데, 화면의 신규 제안은 저장 전까지 id가 없다.
 * 서버 save_review_draft도 신규 과업 제안을 이름 기준으로 맞춰 id를 유지하므로
 * (supabase/migrations/20260901030000_phase1_submit_gate.sql) 이름이 화면과 DB의 공통 키다.
 *
 * ponytail: 같은 이름의 제안이 두 줄이면 구분하지 않는다 — 서버 저장 함수도 같은 한계를 명시하고 있다.
 *           제안 행에 클라이언트가 만드는 안정 키가 생기면 두 곳을 함께 걷어낸다.
 *           surveyApi.ts에는 이 조회가 없어 여기서 직접 읽는다(Phase 1 파일은 이번 작업 범위 밖이다).
 */
async function fetchSuggestionIdsByName(reviewId: string): Promise<Map<string, string>> {
  const { data, error } = await client().from('new_task_suggestions').select('id, name').eq('review_id', reviewId);
  if (error) throw new Error(`신규 과업 제안을 확인하지 못했습니다. ${error.message}`);
  const byName = new Map<string, string>();
  for (const raw of data || []) {
    const row = raw as { id?: unknown; name?: unknown };
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name && typeof row.id === 'string' && !byName.has(name)) byName.set(name, row.id);
  }
  return byName;
}

/**
 * 투입 비중 저장. 초안 저장(save_review_draft) 뒤에 불러야 한다 — 신규 제안이 DB에 들어간 다음이라야
 * 참조할 id가 생긴다. 배분이 하나도 없으면 행을 만들지 않는다(서버 게이트가 "미배분"과
 * "합계 부족"을 다른 안내로 구분한다).
 */
async function persistFte(reviewId: string, targets: FteTarget[], rows: FteRow[]): Promise<void> {
  const pctByKey = new Map(rows.map((r) => [r.key, r.pct]));
  const anyFilled = targets.some((t) => (pctByKey.get(t.key) || 0) > 0);
  if (!anyFilled) {
    await saveFteAllocations(reviewId, []);
    return;
  }

  const ids = targets.some((t) => t.targetType === 'SUGGESTED')
    ? await fetchSuggestionIdsByName(reviewId)
    : new Map<string, string>();

  const allocations: FteAllocationInput[] = [];
  const lost: string[] = [];
  for (const target of targets) {
    const pct = pctByKey.get(target.key) || 0;
    if (target.targetType === 'EXISTING') {
      if (target.taskId) allocations.push({ target_type: 'EXISTING', task_id: target.taskId, suggestion_id: null, pct });
      continue;
    }
    const suggestionId = ids.get(target.name.trim());
    if (suggestionId) allocations.push({ target_type: 'SUGGESTED', task_id: null, suggestion_id: suggestionId, pct });
    else if (pct > 0) lost.push(target.name);
  }

  // 여기까지 오면 신규 제안은 방금 save_review_draft로 저장된 뒤다. 그런데도 id를 못 찾았다면
  // 화면에는 있는 비중이 서버에는 없는 상태다 — 합계 100%인데 제출만 막히는 모양이 된다.
  // 조용히 빼고 저장하면 사용자가 끝까지 알 수 없으므로, 저장 자체를 실패로 돌려 저장 칩에 사유를 띄운다.
  if (lost.length > 0)
    throw new Error(
      `신규 제안 과업 ${lost.length}건(${lost.join(', ')})의 투입 비중을 저장하지 못했습니다. STEP 2에서 과업 명칭을 확인한 뒤 다시 저장해 주세요.`,
    );

  await saveFteAllocations(reviewId, allocations);
}

/**
 * 저장된 배분과 지금 화면의 배분이 같은지 비교할 지문. 대상 목록·이름·값이 모두 같으면 같은 지문이다.
 * (SUGGESTED는 이름이 DB의 공통 키라 이름도 함께 본다 — 이름만 고쳐도 저장 대상이 달라진다.)
 */
function fteSignature(targets: FteTarget[], rows: FteRow[]): string {
  const pct = new Map(rows.map((r) => [r.key, r.pct]));
  return JSON.stringify(targets.map((t) => [t.key, t.name, pct.get(t.key) || 0]));
}

export function ReviewWorkspace({
  user,
  jobId,
  step,
  onStepChange,
  onBack,
  onDirtyChange,
}: {
  user: User;
  /** URL(/review/:jobId)이 지정한 직무. 배정 목록·검토 이력에서만 들어온다. */
  jobId: string;
  /** URL(?step=1..5)이 지정한 단계. */
  step: StepNo;
  /** 단계를 옮기면 URL도 함께 옮긴다(뒤로가기로 이전 단계에 돌아갈 수 있어야 한다). */
  onStepChange: (step: StepNo) => void;
  onBack: () => void;
  /** 미저장 변경 여부를 부모(라우터)에게 알린다. 라우트 이탈 가드가 이 값을 본다. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailReload, setDetailReload] = useState(0);

  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewError, setReviewError] = useState('');

  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [newTasks, setNewTasks] = useState<SuggestionInput[]>([]);
  const [newSkills, setNewSkills] = useState<SuggestionInput[]>([]);
  const [rows, setRows] = useState<FteRow[]>([]);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [missing, setMissing] = useState<MissingItem[]>([]);
  const [showGate, setShowGate] = useState(false);

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [onlyUnrated, setOnlyUnrated] = useState(false);
  const [collapseDone, setCollapseDone] = useState(true);

  const { toast, showToast, dismiss } = useToast();

  const locked = review?.status === 'SUBMITTED' || review?.status === 'RESUBMITTED';
  const readOnly = locked || !review;
  const dirty = saveState === 'dirty' || saveState === 'error';

  const reviewRef = useRef<ReviewState | null>(null);
  reviewRef.current = review;
  const lockedRef = useRef(false);
  lockedRef.current = !!locked;
  const revRef = useRef(0); // 편집할 때마다 +1. 저장 응답이 오는 사이 또 편집했는지 판별한다.
  const savingRef = useRef(false);
  // 진행 중인 저장. 제출·이탈 저장이 자동 저장과 겹치지 않도록 이 약속을 먼저 기다린다.
  const inflightRef = useRef<Promise<void> | null>(null);
  // 마지막으로 저장에 성공한 배분의 지문(null이면 아직 이 화면에서 저장한 적이 없다).
  // saveFteAllocations는 delete → insert 두 번의 왕복이라 트랜잭션이 아니다. STEP 1 의견을 타이핑하는
  // 동안에도 매번 이 두 줄을 돌리면, insert만 실패하는 순간(RLS·제약·순단) 이미 채운 배분이 통째로
  // 비어 버린다 — 화면은 여전히 100%라 사용자는 알 수 없다. 값이 그대로면 아예 부르지 않는다.
  const savedFteRef = useRef<string | null>(null);

  // ── 직무 상세 + 검토 세션 + 저장된 배분 복원 ──────────────────────
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');
    setReviewError('');
    setReview(null);
    setFeedback({});
    setNewTasks([]);
    setNewSkills([]);
    setRows([]);
    setMissing([]);
    setOpenIds(new Set());
    setSaveState('idle');
    setSaveError('');
    revRef.current = 0;
    savedFteRef.current = null;

    (async () => {
      const res = await fetchJobDetailResult(jobId);
      if (cancelled) return;
      if (!res.ok) {
        setJobDetail(null);
        setDetailError(res.error);
        setLoadingDetail(false);
        return;
      }
      setJobDetail(res.data);

      // 상세를 읽은 뒤 검토 세션을 연다. 배정이 없으면 여기서 안내 문구가 나온다.
      try {
        const state = await getOrCreateReviewForJob(user.id, jobId);
        const [saved, allocations, suggestionIds] = await Promise.all([
          fetchReviewFeedback(state.review_id),
          fetchFteAllocations(state.review_id),
          fetchSuggestionIdsByName(state.review_id),
        ]);
        if (cancelled) return;
        setReview(state);
        setFeedback(toFeedbackState(saved));
        setNewTasks(saved.newTasks);
        setNewSkills(saved.newSkills);
        setRows(restoreRows(allocations, saved.newTasks, suggestionIds));
        setSaveState(state.last_saved_at ? 'saved' : 'idle');
      } catch (e) {
        if (cancelled) return;
        setReviewError(errMsg(e));
      }
      if (!cancelled) setLoadingDetail(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, user.id, detailReload]);

  // ── FTE 배분 대상(§6-2 STEP 3 "대상 목록") ────────────────────────
  // STEP 2 결과가 그대로 반영된다: 유지 Task + 이름이 채워진 신규 제안 Task. 삭제 제안 Task는 빼고 건수만 센다.
  // 대상을 만드는 규칙은 STEP 3 화면(fte.tsx)이 내보낸 함수를 그대로 쓴다 — 규칙이 두 벌로 갈라지면
  // 화면에 보이는 목록과 저장되는 목록이 어긋난다.
  const { targets, excludedCount } = useMemo(
    () => buildFteTargets(jobDetail?.tasks || [], feedback, newTasks),
    [jobDetail, feedback, newTasks],
  );

  // 대상이 바뀌면 배분 값을 맞춰 준다. STEP 3 화면에도 같은 정렬 가드가 있지만 그쪽은 STEP 3에 있는 동안만
  // 돈다. STEP 2에서 과업을 지우고 곧장 STEP 5로 가는 경로까지 덮으려면 셸에도 있어야 한다
  // (값이 이미 맞으면 양쪽 다 아무것도 하지 않는다).
  // 신규 제안(SUGGESTED)의 값은 이름으로 먼저 찾고, 기존 Task와 이름이 바뀐 제안만 키로 찾는다.
  // 신규 제안의 키가 배열 인덱스라(계약 FteTarget.key) 앞의 제안을 지우면 뒤의 키가 한 칸씩 밀리는데,
  // 키를 먼저 보면 밀려온 제안이 방금 지운 제안의 비중을 그대로 물려받는다 — 키가 "맞아 버려서"
  // 이름 폴백이 아예 실행되지 않기 때문이다(?? 는 undefined일 때만 넘어간다).
  // 반대로 이름을 고친 제안은 이름으로 못 찾으므로 키가 뒤를 받아 값이 유지된다.
  const prevTargets = useRef<FteTarget[]>([]);
  useEffect(() => {
    setRows((prev) => {
      const byKey = new Map(prev.map((r) => [r.key, r.pct]));
      const byName = new Map(
        prevTargets.current.filter((t) => t.targetType === 'SUGGESTED').map((t) => [t.name, byKey.get(t.key) ?? 0]),
      );
      const next = targets.map((t) => ({
        key: t.key,
        pct: (t.targetType === 'SUGGESTED' ? byName.get(t.name) : undefined) ?? byKey.get(t.key) ?? 0,
      }));
      prevTargets.current = targets;
      const same = prev.length === next.length && prev.every((r, i) => r.key === next[i].key && r.pct === next[i].pct);
      return same ? prev : next;
    });
  }, [targets]);

  const fteSum = fteTotal(targets, rows);

  /** 배분이 지난 저장 이후로 바뀌었을 때만 쓴다(위 savedFteRef 주석 참고). */
  const persistFteIfChanged = useCallback(async (reviewId: string, tg: FteTarget[], rw: FteRow[]) => {
    const sig = fteSignature(tg, rw);
    if (sig === savedFteRef.current) return;
    await persistFte(reviewId, tg, rw);
    savedFteRef.current = sig;
  }, []);

  // 저장 시점의 최신 값을 읽기 위한 참조. 저장 함수를 매 입력마다 새로 만들지 않으려는 목적이다.
  const snapshot = useRef({ feedback, newTasks, newSkills, targets, rows });
  snapshot.current = { feedback, newTasks, newSkills, targets, rows };

  // ── 저장 ──────────────────────────────────────────────────────────
  const runSave = useCallback((): Promise<void> => {
    const current = reviewRef.current;
    // 이미 저장 중이면 새로 보내지 않고 그 저장을 그대로 돌려준다 — 부르는 쪽이 기다릴 수 있어야 한다.
    if (savingRef.current) return inflightRef.current ?? Promise.resolve();
    if (!current || lockedRef.current) return Promise.resolve();
    const rev = revRef.current;
    savingRef.current = true;
    setSaveState('saving');
    setSaveError('');
    const task = (async () => {
      try {
        const { feedback: f, newTasks: nt, newSkills: ns, targets: tg, rows: rw } = snapshot.current;
        const next = await saveReviewDraft(current.review_id, buildDraftPayload(f, { newTasks: nt, newSkills: ns }));
        await persistFteIfChanged(current.review_id, tg, rw);
        // 응답을 기다리는 사이 제출이 끝났거나 다른 검토로 옮겼으면 결과를 반영하지 않는다.
        // 반영하면 제출 완료 화면이 초안 상태로 되돌아가 잠금 배너가 사라지고 제출 버튼이 되살아난다
        // (그 뒤의 편집·재제출은 서버가 전부 거절한다).
        if (lockedRef.current || reviewRef.current?.review_id !== current.review_id) return;
        setReview(next);
        // 저장을 기다리는 동안 또 입력했으면 아직 '저장됨'이 아니다.
        setSaveState(revRef.current === rev ? 'saved' : 'dirty');
      } catch (e) {
        // 제출이 끝난 뒤 도착한 실패는 알리지 않는다 — 이미 저장된 검토에 "저장하지 못했어요"만 남는다.
        if (lockedRef.current || reviewRef.current?.review_id !== current.review_id) return;
        setSaveError(errMsg(e));
        setSaveState('error');
      } finally {
        savingRef.current = false;
        inflightRef.current = null;
      }
    })();
    inflightRef.current = task;
    return task;
  }, [persistFteIfChanged]);

  /** 진행 중인 자동 저장이 끝날 때까지 기다린다(저장은 한 번에 하나만 돈다). */
  const waitForSave = useCallback(async () => {
    while (inflightRef.current) await inflightRef.current;
  }, []);

  // 자동 저장 — 입력이 2.5초 멈추면 보낸다. 저장 중에는 타이머가 잡히지 않는다(saveState 가드).
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = setTimeout(() => {
      void runSave();
    }, 2500);
    return () => clearTimeout(timer);
  }, [saveState, feedback, newTasks, newSkills, rows, runSave]);

  // 새로고침·탭 닫기 차단
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // 라우터가 이탈 가드를 걸 수 있도록 미저장 여부를 위로 올린다.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // 화면을 벗어날 때 미저장 입력을 마지막으로 한 번 더 보낸다.
  // 브라우저·모바일 뒤로가기는 SPA 안에서 일어나 beforeunload도, App.tsx의 이탈 확인창도 거치지 않는다
  // (그 확인창은 사이드바 링크와 '내 검토 목록' 버튼에만 걸려 있다). 그대로 두면 마지막 저장 이후의
  // 입력이 말없이 사라진다 — 자동 저장이 실패해 error로 굳은 구간은 통째로 사라진다.
  // 언마운트 뒤의 setState는 무시되지만 저장 요청 자체는 끝까지 간다.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(
    () => () => {
      if (!dirtyRef.current || lockedRef.current) return;
      void (async () => {
        await waitForSave();
        await runSave();
      })();
    },
    [runSave, waitForSave],
  );

  // ── 응답 소요 실측(§6-1 R4) ───────────────────────────────────────
  // 단계에 들어갈 때 시작하고 단계를 떠나거나 화면을 벗어날 때(정리 함수) 끝낸다.
  // 실측치는 관리자 화면 전용이라 이 화면에는 절대 표시하지 않는다 — 응답자를 재촉하는 장치가 아니다.
  // 실패해도 화면을 막지 않는다(부수 기록). 다만 조용히 사라지지 않도록 콘솔에는 남긴다.
  const reviewId = review?.review_id;
  useEffect(() => {
    if (!reviewId) return;
    let sessionId: string | null = null;
    let left = false;

    const close = (id: string) => {
      void endReviewSession(id).catch((e) => console.error('[SmeReviewPage] 소요 기록 종료 실패:', errMsg(e)));
    };

    // 탭을 닫거나 새로고침하면 React 정리 함수가 돌지 않아 ended_at이 빈 행이 그대로 남고,
    // 새로고침할 때마다 하나씩 더 쌓인다(R4 실측의 표본에서 마지막 구간이 통째로 빠진다).
    // pagehide에서 한 번 더 닫아 준다 — 요청이 끊길 수 있어 best-effort다(인증 헤더가 필요해
    // sendBeacon은 쓸 수 없다).
    const onPageHide = () => {
      if (!sessionId) return;
      close(sessionId);
      sessionId = null;
    };
    window.addEventListener('pagehide', onPageHide);

    startReviewSession(reviewId, step)
      .then((id) => {
        // 응답이 오기 전에 이미 단계를 떠났으면 곧바로 닫는다(열린 채로 남는 세션을 만들지 않는다).
        if (left) close(id);
        else sessionId = id;
      })
      .catch((e) => console.error('[SmeReviewPage] 소요 기록 시작 실패:', errMsg(e)));

    return () => {
      left = true;
      window.removeEventListener('pagehide', onPageHide);
      if (sessionId) close(sessionId);
    };
  }, [reviewId, step]);

  // ── 입력 ──────────────────────────────────────────────────────────
  const markDirty = useCallback(() => {
    revRef.current += 1;
    setSaveState('dirty');
    // 서버가 돌려준 부족 항목 목록은 사용자가 무엇이든 고치는 순간 낡은 스냅샷이 된다.
    // 그대로 두면 STEP 5에서 이미 채운 항목이 붉은 경고에 남아, 바로 아래 완료 현황과 어긋난다.
    setMissing((prev) => (prev.length ? [] : prev));
  }, []);

  const update = useCallback(
    (key: string, value: Partial<Feedback>) => {
      setFeedback((prev) => ({ ...prev, [key]: { ...(prev[key] || EMPTY_FEEDBACK), ...value } }));
      markDirty();
    },
    [markDirty],
  );

  const openItem = useCallback((key: string) => {
    setOpenIds((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const listState: ListState = {
    onlyUnrated,
    setOnlyUnrated,
    collapseDone,
    setCollapseDone,
    props: { openIds, onOpen: openItem, collapseDone, onlyUnrated },
  };

  // ── 진행률·게이트 ─────────────────────────────────────────────────
  const stepKeys = useMemo<string[][]>(
    () => [
      ['name', 'definition'],
      (jobDetail?.tasks || []).map((t) => `task-${t.id}`),
      [], // STEP 3은 평가가 아니라 배분이라 아래에서 따로 센다.
      [...(jobDetail?.skills || []).map((s) => `skill-${s.id}`), ...REQ_KEYS],
      [],
    ],
    [jobDetail],
  );
  const ratedCount = (keys: string[]) => keys.filter((k) => feedback[k]?.suitability).length;
  const total = stepKeys.reduce((n, keys) => n + keys.length, 0);
  const done = stepKeys.reduce((n, keys) => n + ratedCount(keys), 0);
  const percent = total ? Math.round((done / total) * 100) : 0;

  const counts = STEPS.map((s) => {
    // 배분한 과업 수는 rows가 아니라 대상 기준으로 센다. rows에는 STEP 2에서 방금 지워진 과업의
    // 옛 값이 한 렌더 동안 남아 있을 수 있어, 그대로 세면 완료 수가 전체 수를 넘는다.
    if (s === 3) return { done: targets.length - fteZeroTargets(targets, rows).length, total: targets.length };
    if (s === 5) return { done, total };
    return { done: ratedCount(stepKeys[s - 1]), total: stepKeys[s - 1].length };
  });

  const gates = STEPS.map((s) =>
    evaluateStep(s, {
      tasks: jobDetail?.tasks || [],
      skills: jobDetail?.skills || [],
      feedback,
      newTasks,
      fteTotal: fteSum,
      fteTargetCount: targets.length,
    }),
  );
  const gate = gates[step - 1];

  // STEP 5는 자체 게이트가 없다(서버가 최종 판정을 한다). 다만 §10 P2 DoD ②가 "합계 100% 미만이면
  // 다음·제출 모두 차단(클라+서버)"을 요구하고, 서버 쪽 FTE 검증은 회사 설정(fte_required)이 꺼져 있으면
  // 통과시킨다(켜는 SQL은 supabase/migrations/20260901040000_phase2_enable_fte_required.sql).
  // 설정이 꺼진 회사·회사가 비어 있는 검토에서도 같은 규칙이 서게 제출 직전에 1~4단계 게이트를
  // 다시 모아 클라이언트가 먼저 막는다.
  const submitBlockers = gates.slice(0, 4).flatMap((g) => g.reasons);
  const gateReasons = step === 5 ? submitBlockers : gate.reasons;

  // 이미 지난 단계와, 앞 단계가 모두 통과한 단계는 자유롭게 오갈 수 있다.
  // 제출이 끝난 검토는 전부 읽기 전용이라 어디든 열어 준다(둘러보기만 가능하다).
  const reachable = (s: StepNo) => !!locked || s <= step || gates.slice(0, s - 1).every((g) => g.ok);
  const checklist: StepChecklistItem[] = STEPS.map((s) => ({
    step: s,
    // STEP 5는 게이트가 없어 늘 통과다. 완료 표시는 제출 여부로 본다.
    complete: s === 5 ? !!locked : gates[s - 1].ok,
    reachable: reachable(s),
    done: counts[s - 1].done,
    total: counts[s - 1].total,
  }));

  const goToStep = useCallback(
    (next: StepNo) => {
      setShowGate(false);
      onStepChange(next);
    },
    [onStepChange],
  );

  // 단계가 바뀌면 이전 단계의 게이트 안내를 지운다.
  useEffect(() => {
    setShowGate(false);
  }, [step]);

  // 단계를 옮기면 스크롤과 포커스도 함께 옮긴다. URL만 바뀔 뿐 화면은 다시 마운트되지 않아서,
  // 390px에서 긴 STEP 2 맨 아래의 '다음 단계'를 누르면 새 단계의 제목·안내문이 화면 위로 벗어난 채
  // 남는다("아무 일도 일어나지 않았다"로 읽힌다). 제목으로 포커스를 옮기면 화면 낭독기도 바뀐 단계를
  // 읽고, 이어지는 Tab이 본문 처음부터 이어진다(이전 단계 버튼이 STEP 1에서 스스로 비활성화되며
  // 포커스를 잃는 경로도 여기서 함께 받는다).
  // 첫 진입(새로고침·직접 링크)에서는 옮기지 않는다 — 사용자가 방금 한 조작이 아니다.
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  const stepMoved = useRef(false);
  useEffect(() => {
    if (!stepMoved.current) {
      stepMoved.current = true;
      return;
    }
    window.scrollTo(0, 0);
    stepTitleRef.current?.focus({ preventScroll: true });
  }, [step]);

  const goNext = () => {
    if (!gate.ok) {
      setShowGate(true);
      return;
    }
    goToStep(toStepNo(step + 1));
  };

  // ── 제출 ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const current = review;
    if (!current) return;
    setSubmitting(true);
    try {
      // 진행 중인 자동 저장을 먼저 끝내고, 제출이 끝날 때까지 자동 저장을 잠근다.
      // 겹치면 두 저장의 배분 delete→insert가 엇갈려(서버 함수는 트랜잭션이 아니다) 서버가 합계를
      // 읽는 순간 배분 행이 비거나, 늦게 도착한 초안 저장이 제출 완료 상태를 초안으로 되돌린다.
      await waitForSave();
      savingRef.current = true;
      const rev = revRef.current;
      const { feedback: f, newTasks: nt, newSkills: ns, targets: tg, rows: rw } = snapshot.current;
      const payload = buildDraftPayload(f, { newTasks: nt, newSkills: ns });
      // 제출 RPC는 서버에서 FTE 합계를 다시 더한다(§7-2 제출 게이트 ③).
      // 배분을 먼저 저장해 두지 않으면 화면은 100%인데 서버 합계는 0이라 제출이 막힌다.
      const saved = await saveReviewDraft(current.review_id, payload);
      await persistFteIfChanged(current.review_id, tg, rw);

      const res = await submitReview(current.review_id, payload);

      // 서버 제출 게이트에 걸렸다. 오류가 아니라 "아직 덜 채운 상태"라 제출로 넘기지 않는다.
      // 방금 초안과 배분은 저장됐으므로(위 두 줄) 저장 칩도 그 사실에 맞춘다 — 제출 구간 동안
      // 자동 저장을 잠가 두었기 때문에 여기서 맞추지 않으면 칩이 '입력 중'에 멈춰 있는다.
      if (!res.ok) {
        setMissing(res.missing);
        setReview(saved);
        setSaveState(revRef.current === rev ? 'saved' : 'dirty');
        showToast({ type: 'warning', msg: gateStep5Missing(res.missing.length), duration: 0 });
        return;
      }

      setMissing([]);
      setReview(res.state);
      revRef.current += 1;
      setSaveState('saved');
      setSaveError('');
      showToast({ type: 'success', msg: '검토를 제출했어요. 관리자가 확인한 뒤 결과가 반영됩니다.' });
    } catch (e) {
      showToast({ type: 'error', msg: errMsg(e), duration: 0 });
    } finally {
      savingRef.current = false;
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const statusLabel = review ? STATUS_LABEL[review.status] : '작성 전';
  const softSkills = jobDetail?.skills.filter((s) => s.skill_type === 'Soft Skill') || [];
  const hardSkills = jobDetail?.skills.filter((s) => s.skill_type === 'Hard Skill') || [];
  const skillKeys = (jobDetail?.skills || []).map((s) => `skill-${s.id}`);

  // 화면 아래에 떠 있는 것이 둘이다 — 전 단계 공통인 '문의하기' 버튼과, STEP 3에서 xl 미만이면
  // 하단 고정 바로 내려오는 합계 게이지(그림 6-A). 둘 다 fixed라 페이지 맨 아래 이전/다음·제출 버튼을
  // 덮을 수 있어, 덮이는 높이만큼을 여기서 한 번에 비운다.
  //  · --sme-bottom-bar-h — 문의 버튼이 바닥에서 띄울 높이. STEP 3에서는 게이지 바를 넘겨야 한다.
  //  · pb-* — 페이지 맨 아래 여백. 문의 버튼(높이 44px)까지 덮이지 않게 그 위로 잡는다.
  // 두 값이 한 곳에 있어야 바 높이를 바꿀 때 서로 어긋나지 않는다.
  const bottomBar = step === 3 ? '7.5rem' : '1.5rem';

  return (
    <div className={step === 3 ? 'pb-44' : 'pb-24'} style={{ '--sme-bottom-bar-h': bottomBar } as CSSProperties}>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-11 items-center gap-1 text-sm text-foreground-muted transition hover:text-primary"
          >
            <ArrowLeft size={16} aria-hidden="true" /> 내 검토 목록
          </button>
          <p className="mb-1 mt-1 text-sm text-foreground-muted">
            SME 검토 · {statusLabel}
            {user.company_name && <span className="ml-2 text-primary">· {user.company_name}</span>}
          </p>
          {/* 직무는 배정으로 정해진다. 화면에서는 바꿀 수 없고 읽기 전용으로만 보여 준다. */}
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{jobDetail?.name || '직무정보 검토'}</h2>
          {jobDetail && (
            <p className="mt-1 text-sm text-foreground-subtle">
              {jobDetail.group_name} · {jobDetail.series_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-foreground-muted">평가 진행률</span>
          <div
            className="h-2 w-28 rounded-full bg-border"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="검토 항목 평가 진행률"
          >
            <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs font-medium text-primary">
            {done}/{total} ({percent}%)
          </span>
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      {loadingDetail ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-foreground-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 직무 상세 정보를 불러오는 중…
        </div>
      ) : detailError ? (
        <ErrorPanel
          title="직무 상세 정보를 불러오지 못했어요."
          detail={detailError}
          onRetry={() => setDetailReload((n) => n + 1)}
        />
      ) : jobDetail ? (
        <div className="grid gap-5 xl:grid-cols-[240px_1fr]">
          <div className="h-fit xl:sticky xl:top-24">
            <StepChecklist items={checklist} current={step} onSelect={goToStep} />
          </div>

          <section className="rounded-element border border-border bg-card p-5 shadow-sm lg:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <h3
                ref={stepTitleRef}
                tabIndex={-1}
                className="min-w-0 text-base font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                {stepBarTitle(jobDetail.name, step)}
              </h3>
              <SaveStatusChip
                state={saveState}
                error={saveError}
                savedAt={review?.last_saved_at || null}
                onRetry={() => void runSave()}
              />
            </div>

            {reviewError && (
              <div className="mb-5 flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-4 py-3 text-sm text-destructive">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p>{reviewError}</p>
                  <p className="mt-1 text-xs">검토 내용을 저장할 수 없어 입력이 잠겨 있어요.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setDetailReload((n) => n + 1)}>
                  <RefreshCw size={14} aria-hidden="true" /> 다시 시도
                </Button>
              </div>
            )}
            {locked && review && (
              <div className="mb-5 flex items-start gap-2 rounded-element border border-primary-border bg-primary-subtle px-4 py-3 text-sm text-primary">
                <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>
                  이미 제출한 검토라 수정할 수 없어요
                  {review.submitted_at ? ` (제출 ${hhmm(review.submitted_at)})` : ''}. 수정이 필요하면 관리자에게
                  재검토를 요청해 주세요.
                </p>
              </div>
            )}

            {/* §6-1 핵심 동작 — 각 단계 상단의 축약 가이드. 접이식이라 익숙해진 뒤에는 접어 둘 수 있다. */}
            <Disclosure summary={STEP_GUIDE_SUMMARY}>{STEP_GUIDES[step - 1]}</Disclosure>

            <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
              {step === 1 && (
                <div className="space-y-10">
                  <FeedbackSection
                    title="A. 직무명 검토"
                    current={jobDetail.name}
                    feedback={feedback.name || EMPTY_FEEDBACK}
                    update={(v) => update('name', v)}
                    suggestionLabel="대체 직무명 제안"
                    done={ratedCount(['name'])}
                    total={1}
                  />
                  <FeedbackSection
                    title="B. 직무정의 검토"
                    current={jobDetail.definition}
                    feedback={feedback.definition || EMPTY_FEEDBACK}
                    update={(v) => update('definition', v)}
                    suggestionLabel="수정 직무정의 제안"
                    large
                    done={ratedCount(['definition'])}
                    total={1}
                  />
                </div>
              )}

              {step === 2 && (
                <>
                  {/* §6-2 STEP 2 — 직군별 작성 예시. 무엇을 어느 수준으로 적으면 되는지만 보여 준다. */}
                  <Disclosure summary={TASK_EXAMPLE_SUMMARY}>
                    <p>{TASK_EXAMPLE_INTRO}</p>
                    <ul className="mt-3 space-y-2">
                      {TASK_EXAMPLES.map((ex) => (
                        <li key={ex.group} className="rounded-element bg-card px-3 py-2">
                          <p className="text-[11px] font-semibold text-primary">{ex.group}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{ex.name}</p>
                          <p className="mt-0.5 text-xs leading-5 text-foreground-muted">{ex.description}</p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs leading-5 text-foreground-subtle">{TASK_EXAMPLE_TIP}</p>
                  </Disclosure>
                  <TaskActivityFeedback
                    tasks={jobDetail.tasks}
                    feedback={feedback}
                    update={update}
                    newTasks={newTasks}
                    setNewTasks={(items) => {
                      setNewTasks(items);
                      markDirty();
                    }}
                    listState={listState}
                    done={counts[1].done}
                    total={counts[1].total}
                  />
                </>
              )}

              {step === 3 && (
                <FteStep
                  readOnly={readOnly}
                  jobDetail={jobDetail}
                  review={review}
                  feedback={feedback}
                  update={update}
                  newTasks={newTasks}
                  setNewTasks={(items) => {
                    setNewTasks(items);
                    markDirty();
                  }}
                  newSkills={newSkills}
                  setNewSkills={(items) => {
                    setNewSkills(items);
                    markDirty();
                  }}
                  listState={listState}
                  done={counts[2].done}
                  total={counts[2].total}
                  onDirty={markDirty}
                  goToStep={goToStep}
                  targets={targets}
                  rows={rows}
                  setRows={(next) => {
                    setRows(next);
                    markDirty();
                  }}
                  excludedCount={excludedCount}
                  showNav={false}
                />
              )}

              {step === 4 && (
                <div className="space-y-10">
                  <SkillFeedback
                    softSkills={softSkills}
                    hardSkills={hardSkills}
                    feedback={feedback}
                    update={update}
                    newSkills={newSkills}
                    setNewSkills={(items) => {
                      setNewSkills(items);
                      markDirty();
                    }}
                    listState={listState}
                    done={ratedCount(skillKeys)}
                    total={skillKeys.length}
                  />
                  <RequirementFeedback
                    requirements={jobDetail.requirements}
                    feedback={feedback}
                    update={update}
                    listState={listState}
                    done={ratedCount(REQ_KEYS)}
                    total={REQ_KEYS.length}
                  />
                </div>
              )}

              {step === 5 && (
                <SubmitSummary
                  checklist={checklist}
                  feedback={feedback}
                  newTaskCount={newTasks.filter((t) => t.name.trim()).length}
                  newSkillCount={newSkills.filter((t) => t.name.trim()).length}
                  targets={targets}
                  rows={rows}
                  fteTotal={fteSum}
                  missing={missing}
                  goToStep={goToStep}
                  done={done}
                  total={total}
                />
              )}
            </fieldset>

            {showGate && <GateNotice reasons={gateReasons} />}

            <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row">
              <Button variant="secondary" disabled={step === 1} onClick={() => goToStep(toStepNo(step - 1))}>
                {PREV_STEP_BUTTON}
              </Button>
              <div className="flex flex-wrap gap-2">
                {/* 저장 중에도 잠그지 않는다 — 잠그면 방금 Enter로 누른 버튼이 비활성이 되며 키보드
                    포커스가 body로 떨어지고, 저장이 끝나도 돌아오지 않는다. 중복 저장은 runSave의
                    savingRef가 이미 막으므로 여기서는 진행 중임을 aria-busy와 스피너로만 알린다. */}
                <Button
                  variant="secondary"
                  onClick={() => void runSave()}
                  disabled={readOnly}
                  aria-busy={saveState === 'saving' || undefined}
                >
                  {saveState === 'saving' ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save size={15} aria-hidden="true" />
                  )}{' '}
                  임시저장
                </Button>
                {step < 5 ? (
                  // 게이트에 걸려도 버튼은 살려 둔다 — 비활성 버튼은 "왜 못 넘어가는지"를 말해 주지 못한다.
                  // 누르면 그 자리에서 사유(GateNotice)를 띄운다. STEP 3만 라벨로도 이유를 밝힌다(그림 6-A).
                  <Button onClick={goNext}>
                    {step === 3 && !gate.ok ? FTE_NEXT_BLOCKED_BUTTON : NEXT_STEP_BUTTON}
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      // 다음 단계 버튼과 같은 방식이다 — 비활성으로 두는 대신 눌렀을 때 사유를 보여 준다.
                      if (submitBlockers.length > 0) {
                        setShowGate(true);
                        return;
                      }
                      setConfirmOpen(true);
                    }}
                    disabled={readOnly}
                    loading={submitting}
                  >
                    {review?.status === 'REVIEW_REQUESTED' ? '재제출' : '최종 제출'}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* 문의는 전 단계 공통이다. 직무(review)와 지금 단계가 문의에 자동으로 붙는다(§6-1).
          jobName은 저장에 쓰이지 않고 "무엇이 함께 전달되는지"를 작성 폼에서 보여 주는 표시용이다. */}
      <InquiryButton reviewId={review?.review_id || null} step={step} jobName={jobDetail?.name} />

      {confirmOpen && (
        <ModalShell
          title="검토를 제출할까요?"
          description="최종 제출 후에는 관리자가 재검토를 요청하기 전까지 수정할 수 없어요."
          onClose={() => setConfirmOpen(false)}
          closeDisabled={submitting}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                취소
              </Button>
              <Button onClick={() => void handleSubmit()} loading={submitting}>
                제출하기
              </Button>
            </>
          }
        >
          <ul className="space-y-1.5 text-sm text-foreground-muted">
            <li>
              평가한 항목 {done}/{total}개
            </li>
            <li>투입 비중 합계 {fteSum}%</li>
            {total - done > 0 && (
              <li className="text-warning">아직 평가하지 않은 항목이 {total - done}개 있어요.</li>
            )}
          </ul>
        </ModalShell>
      )}
    </div>
  );
}

/**
 * 저장된 배분을 화면 키로 되돌린다.
 * SUGGESTED 행은 DB id로 저장돼 있어 이름을 거쳐 신규 제안 순서(sug-{index})로 돌아온다.
 */
function restoreRows(
  allocations: FteAllocationInput[],
  savedNewTasks: SuggestionInput[],
  suggestionIds: Map<string, string>,
): FteRow[] {
  const nameById = new Map([...suggestionIds].map(([name, id]) => [id, name]));
  const rows: FteRow[] = [];
  for (const a of allocations) {
    if (a.target_type === 'EXISTING') {
      if (a.task_id) rows.push({ key: `task-${a.task_id}`, pct: a.pct });
      continue;
    }
    const name = a.suggestion_id ? nameById.get(a.suggestion_id) : undefined;
    if (!name) continue;
    const index = savedNewTasks.findIndex((t) => t.name.trim() === name);
    if (index >= 0) rows.push({ key: `sug-${index}`, pct: a.pct });
  }
  return rows;
}

/**
 * 접이식 안내 상자 — §6-1 "각 단계 상단에도 해당 단계 축약 가이드를 접이식으로 상시 노출"과
 * §6-2 STEP 2의 "직군별 작성 예시 팝오버"가 쓴다.
 * <details>를 그대로 쓴다 — 열고 닫기·키보드 조작·보조기기 노출을 브라우저가 이미 한다
 * (fieldset disabled 안에서도 폼 컨트롤이 아니라 그대로 열린다).
 */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mb-5 rounded-element border border-border bg-muted">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {summary}
      </summary>
      <div className="border-t border-border px-4 py-3 text-sm leading-6 text-foreground-muted">{children}</div>
    </details>
  );
}

// ── STEP 5 제출 요약(§6-2 STEP 5) ───────────────────────────────────
//
// 아래 라벨·안내 문장은 기획안 §6에 고정 문언이 없어 새로 쓴 것이다(§6-2는 "제출 요약"의 구성만 정한다).
// 0% 과업 안내와 부족 항목 문구만 copy.ts의 문장을 쓴다.

function SubmitSummary({
  checklist,
  feedback,
  newTaskCount,
  newSkillCount,
  targets,
  rows,
  fteTotal,
  missing,
  goToStep,
  done,
  total,
}: {
  checklist: StepChecklistItem[];
  feedback: Record<string, Feedback>;
  newTaskCount: number;
  newSkillCount: number;
  targets: FteTarget[];
  rows: FteRow[];
  fteTotal: number;
  missing: MissingItem[];
  goToStep: (step: StepNo) => void;
  done: number;
  total: number;
}) {
  const entries = Object.values(feedback);
  const revisedCount = entries.filter((f) => f.suggestion.trim()).length;
  const removeCount = entries.filter((f) => f.remove).length;

  const pctByKey = new Map(rows.map((r) => [r.key, r.pct]));
  const top3 = targets
    .map((t) => ({ name: t.name, pct: pctByKey.get(t.key) || 0 }))
    .filter((t) => t.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  // 품질 가드 ⓑ — 0% 과업 목록은 STEP 3 화면과 같은 함수로 뽑는다.
  const zero = fteZeroTargets(targets, rows);

  // 서버 게이트에 걸리면 이 패널이 화면 맨 위에 그려진다. 사용자는 그 800~1200px 아래의
  // '최종 제출'을 누른 참이라, 끌어오지 않으면 모달만 닫히고 아무 일도 없었던 것처럼 보인다.
  const missingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (missing.length === 0) return;
    missingRef.current?.focus({ preventScroll: true });
    missingRef.current?.scrollIntoView({ block: 'center' });
  }, [missing]);

  // 서버가 돌려준 부족 항목을 단계별로 묶는다. 어느 단계로 가야 하는지가 목록의 핵심이다.
  const byStep = new Map<StepNo, MissingItem[]>();
  for (const item of missing) {
    const step = toStepNo(item.step);
    byStep.set(step, [...(byStep.get(step) || []), item]);
  }

  return (
    <div>
      <SectionHeading title={STEP_TITLES[4]} done={done} total={total} />

      {missing.length > 0 && (
        <div
          ref={missingRef}
          tabIndex={-1}
          role="alert"
          className="mb-6 rounded-element border border-warning-border bg-warning-muted px-4 py-3 text-sm text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
        >
          <p className="font-medium">{gateStep5Missing(missing.length)}</p>
          <div className="mt-3 space-y-3">
            {[...byStep.entries()].map(([step, items]) => (
              <div key={step}>
                <p className="text-xs font-semibold">{STEP_TITLES[step - 1]}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5">
                  {items.map((m, i) => (
                    <li key={`${m.kind}-${i}`}>{m.label}</li>
                  ))}
                </ul>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => goToStep(step)}>
                  STEP {step}으로 이동
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <h4 className="mb-3 font-semibold text-foreground">단계별 완료 현황</h4>
      <ul className="mb-8 space-y-2">
        {checklist.slice(0, 4).map((it) => (
          <li
            key={it.step}
            className="flex flex-wrap items-center justify-between gap-2 rounded-element border border-border px-4 py-3"
          >
            <span className="min-w-0 text-sm text-foreground">{STEP_TITLES[it.step - 1]}</span>
            <span className="flex items-center gap-3">
              <span className={`text-xs font-medium ${it.complete ? 'text-success' : 'text-warning'}`}>
                {it.complete ? '완료' : '미완료'}
                {it.total > 0 ? ` · ${it.done}/${it.total}` : ''}
              </span>
              {!it.complete && (
                <Button size="sm" variant="secondary" onClick={() => goToStep(it.step)}>
                  STEP {it.step}으로 이동
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <h4 className="mb-3 font-semibold text-foreground">제안 요약</h4>
      <ul className="mb-8 grid gap-2 sm:grid-cols-3">
        <li className="rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          수정 제안 <strong className="text-foreground">{revisedCount}</strong>건
        </li>
        <li className="rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          신규 제안 과업 <strong className="text-foreground">{newTaskCount}</strong>건 · Skill{' '}
          <strong className="text-foreground">{newSkillCount}</strong>건
        </li>
        <li className="rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          삭제 제안 <strong className="text-foreground">{removeCount}</strong>건
        </li>
      </ul>

      <h4 className="mb-3 font-semibold text-foreground">투입 비중 상위 과업 (합계 {fteTotal}%)</h4>
      {top3.length === 0 ? (
        <p className="mb-8 rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          아직 투입 비중을 배분하지 않았어요.
        </p>
      ) : (
        <ol className="mb-8 space-y-2">
          {top3.map((t, i) => (
            <li
              key={t.name}
              className="flex items-center justify-between gap-3 rounded-element border border-border px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm text-foreground">
                {i + 1}. {t.name}
              </span>
              <span className="shrink-0 text-sm font-semibold text-primary">{t.pct}%</span>
            </li>
          ))}
        </ol>
      )}

      {zero.length > 0 && (
        <div className="rounded-element border border-border bg-muted px-4 py-3">
          <p className="text-sm text-foreground-muted">{fteZeroPctNote(zero.length)}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-foreground-subtle">
            {zero.map((t) => (
              <li key={t.name}>{t.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ErrorPanel({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="rounded-element border border-destructive-border bg-destructive-muted p-8 text-center">
      <AlertCircle size={20} className="mx-auto mb-2 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="mt-1 text-xs text-destructive">{detail}</p>
      <p className="mt-1 text-xs text-foreground-muted">
        네트워크 상태를 확인한 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.
      </p>
      <Button variant="secondary" onClick={onRetry} className="mt-4">
        <RefreshCw size={14} aria-hidden="true" /> 다시 시도
      </Button>
    </div>
  );
}
