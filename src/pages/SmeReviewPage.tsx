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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Lock, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TermHint } from '@/components/ui/TermHint';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';
import { Snackbar, useSnackbar } from '@/components/ui/Snackbar';
import { fetchJobDetailResult, type JobDetail } from '@/lib/jobApi';
import {
  buildDraftPayload,
  fetchReviewFeedback,
  getOrCreateReviewForJob,
  saveLastStep,
  saveReviewDraft,
  submitReview,
  toFeedbackState,
  type FteAllocationPayload,
  type MissingItem,
  type ReviewState,
  type ReviewStatus,
  type SuggestionInput,
} from '@/lib/reviewApi';
import {
  endReviewSession,
  fetchFteAllocations,
  fetchMyInquiries,
  fetchSurveySettings,
  startReviewSession,
  type FteAllocationInput,
  type Inquiry,
} from '@/lib/surveyApi';
import type { Feedback, User } from '@/types';
import { AnsweredInquiryBanner, RecheckBanner } from './sme-review/recheck';
import { FeedbackSection, RequirementFeedback, SkillFeedback, TaskActivityFeedback, type ListState } from './sme-review/sections';
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
  HINT_STEP1_PICK_ONE,
  NEXT_STEP_BUTTON,
  PREV_STEP_BUTTON,
  SUBMIT_NOTICE,
  TASK_EXAMPLES,
  TASK_EXAMPLE_INTRO,
  TASK_EXAMPLE_SUMMARY,
  TASK_EXAMPLE_TIP,
  gateStep5Missing,
  stepBarTitle,
} from './sme-review/copy';
import type { FteRow, FteTarget, StepNo } from './sme-review/wizardTypes';
import { Disclosure, ErrorPanel, StepGuideBox, SubmitSummary } from './sme-review/summary';
import { FirstVisitNotice } from './sme-review/coachmarks';

const STATUS_LABEL: Record<ReviewStatus, string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '작성 중',
  SUBMITTED: '제출 완료',
  REVIEW_REQUESTED: '재검토 요청',
  RESUBMITTED: '재제출 완료',
};

const EMPTY_FEEDBACK: Feedback = { suitability: '', comment: '', suggestion: '' };

const errMsg = (e: unknown) =>
  e instanceof Error && e.message ? e.message : '알 수 없는 오류로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

/** 서버가 돌려준 부족 항목의 step은 0(가이드)이나 범위 밖일 수 있다. 화면 이동은 1~5로만 한다. */
const toStepNo = (n: number): StepNo => (n >= 1 && n <= 5 ? (n as StepNo) : 5);

/**
 * 화면의 배분을 서버 payload로 바꾼다(v2 F5).
 *
 * 신규 제안은 DB id 대신 client_key로 가리킨다 — 서버가 초안 저장과 같은 트랜잭션에서 id로 푼다.
 * 그래서 "제안을 먼저 저장해 id를 얻고 → 그 id로 배분을 저장" 하던 2단계와, 이름으로 되짚던
 * 보정 코드가 전부 사라졌다. 대상 전부를 매번 보낸다(부분 전송은 서버 합계를 화면과 어긋나게 한다).
 */
function ftePayload(targets: FteTarget[], rows: FteRow[]): FteAllocationPayload[] {
  const pct = new Map(rows.map((r) => [r.key, r.pct]));
  return targets.map((t) =>
    t.targetType === 'EXISTING'
      ? { target_type: 'EXISTING' as const, task_id: t.taskId, client_key: null, pct: pct.get(t.key) || 0 }
      : { target_type: 'SUGGESTED' as const, task_id: null, client_key: t.clientKey, pct: pct.get(t.key) || 0 },
  );
}

export function ReviewWorkspace({
  user,
  jobId,
  step,
  onStepChange,
  onBack,
  onDirtyChange,
  onOpenInquiries,
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
  /** 문의 답변 배너(§6-3 ⓒ)의 '내 문의에서 확인'. 이동 가드는 라우터가 건다. */
  onOpenInquiries?: () => void;
}) {
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailReload, setDetailReload] = useState(0);

  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewError, setReviewError] = useState('');
  // 반려 사유(§6-3 ⓑ). review와 따로 두는 이유는 ReviewState.rejected_reason 주석에 적혀 있다 —
  // 임시저장 RPC 반환에는 이 값이 없어서, review를 갱신할 때마다 사유가 사라져 버린다.
  const [rejectedReason, setRejectedReason] = useState('');
  /** 답변이 도착한 내 문의(§6-3 ⓒ). 검토 대상 직무와 무관하게 SME 본인 기준이다. */
  const [answeredInquiries, setAnsweredInquiries] = useState<Inquiry[]>([]);
  /** 운영 설정의 문의 담당 표기. 문의 모달에서 보여 준다(v2 F7). 없으면 빈 문자열이다. */
  const [inquiryContact, setInquiryContact] = useState('');

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

  /*
    검토 화면 첫 진입 안내(v4 G4). 서버 기록(user.coach_completed_at)이 진실이고, 이 상태는
    "방금 닫았다"만 기억한다 — 닫자마자 사라져야 하는데 서버 값은 이 화면에서 갱신되지 않는다.
    컬럼이 없는 DB에서는 값이 undefined라 안내가 아예 뜨지 않는다(기록할 곳이 없으면 매번 뜬다).
  */
  const [coachDone, setCoachDone] = useState(false);
  const showCoach = user.coach_completed_at === null && !coachDone;

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [onlyUnrated, setOnlyUnrated] = useState(false);
  const [collapseDone, setCollapseDone] = useState(true);

  const { toast, showToast, dismiss } = useToast();
  // 닫기가 필요한 알림은 Snackbar로 낸다 — Toast에는 닫기 버튼이 없다(v3 T3).
  const { snackbar, showSnackbar, dismiss: dismissSnackbar } = useSnackbar();

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

  // ── 직무 상세 + 검토 세션 + 저장된 배분 복원 ──────────────────────
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');
    setReviewError('');
    setReview(null);
    setRejectedReason('');
    setFeedback({});
    setNewTasks([]);
    setNewSkills([]);
    setRows([]);
    setMissing([]);
    setOpenIds(new Set());
    setSaveState('idle');
    setSaveError('');
    revRef.current = 0;

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
        const [saved, allocations] = await Promise.all([
          fetchReviewFeedback(state.review_id),
          fetchFteAllocations(state.review_id),
        ]);
        if (cancelled) return;
        setReview(state);
        setRejectedReason(state.rejected_reason);
        setFeedback(toFeedbackState(saved));
        setNewTasks(saved.newTasks);
        setNewSkills(saved.newSkills);
        setRows(restoreRows(allocations));
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

  // ── 답변이 도착한 내 문의(§6-3 ⓒ "답변 시 SME 화면 배너로 노출") ──
  // 검토 로드와 분리한다 — 부가 알림이라 이 조회가 실패해도 검토 화면은 그대로 열려야 한다.
  // 실패를 화면에 띄우지 않는 것은 이 배너가 문의의 진실이 아니기 때문이다. 목록과 오류·재시도는
  // '내 문의'(/inquiries)가 책임지고, 여기서는 도착 사실만 알린다. 원인은 콘솔에 남긴다.
  useEffect(() => {
    let cancelled = false;
    fetchMyInquiries(user.id)
      .then((rows) => {
        if (!cancelled) setAnsweredInquiries(rows.filter((q) => q.status === 'ANSWERED'));
      })
      .catch((e) => {
        if (!cancelled) setAnsweredInquiries([]);
        console.warn('[SmeReviewPage] 문의 답변 배너를 위한 조회 실패 — 배너만 생략한다.', e);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // 문의 담당 표기(v2 F7). 부가 정보라 실패해도 화면은 그대로 간다.
  useEffect(() => {
    if (!user.company_id) return;
    let cancelled = false;
    fetchSurveySettings(user.company_id)
      .then((settings) => {
        if (!cancelled) setInquiryContact(settings?.inquiry_contact ?? '');
      })
      .catch((e) => console.warn('[SmeReviewPage] 문의 담당 표기 조회 실패 — 표기만 생략한다.', e));
    return () => {
      cancelled = true;
    };
  }, [user.company_id]);

  // ── FTE 배분 대상(§6-2 STEP 3 "대상 목록") ────────────────────────
  // STEP 2 결과가 그대로 반영된다: 유지 Task + 이름이 채워진 신규 제안 Task. 삭제 제안 Task는 빼고 건수만 센다.
  // 대상을 만드는 규칙은 STEP 3 화면(fte.tsx)이 내보낸 함수를 그대로 쓴다 — 규칙이 두 벌로 갈라지면
  // 화면에 보이는 목록과 저장되는 목록이 어긋난다.
  const { targets, excluded } = useMemo(
    () => buildFteTargets(jobDetail?.tasks || [], feedback, newTasks),
    [jobDetail, feedback, newTasks],
  );

  /*
    대상이 바뀌면 배분 값을 맞춘다.

    키가 안정적이라(task-{id} · sug-{client_key}) 이제 하는 일은 두 가지뿐이다.
      ① 대상 순서대로 값을 다시 세운다(없던 대상은 0%).
      ② 대상에서 빠진 과업의 값은 지우지 않고 그대로 둔다 — "주차"다.
    ②가 STEP 3의 「되살리기」를 뒷받침한다: 삭제 제안을 해제하면 직전 비중이 그대로 돌아온다.
    주차 행은 ftePctMap이 대상 기준으로 걸러 내므로 합계·저장에는 들어가지 않는다.
    (인덱스 밀림을 이름으로 보정하던 옛 코드는 client_key 도입으로 사라졌다 — v2 F5.)
  */
  useEffect(() => {
    setRows((prev) => {
      const byKey = new Map(prev.map((r) => [r.key, r.pct]));
      const keys = new Set(targets.map((t) => t.key));
      const next = targets.map((t) => ({ key: t.key, pct: byKey.get(t.key) ?? 0 }));
      const parked = prev.filter((r) => !keys.has(r.key) && r.key.startsWith('task-') && r.pct > 0);
      const merged = [...next, ...parked];
      const same =
        prev.length === merged.length && prev.every((r, i) => r.key === merged[i].key && r.pct === merged[i].pct);
      return same ? prev : merged;
    });
  }, [targets]);

  const fteSum = fteTotal(targets, rows);

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
        // 초안과 배분이 한 RPC(한 트랜잭션)로 간다 — 중간에 배분만 비는 구간이 없다(v2 F5).
        const next = await saveReviewDraft(
          current.review_id,
          buildDraftPayload(f, { newTasks: nt, newSkills: ns, fte: ftePayload(tg, rw) }),
        );
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
  }, []);

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

  // 지금 보고 있는 단계를 서버에도 남긴다(v2 §6-5) — 다른 기기에서 이어하기의 근거다.
  // 부수 기록이라 실패해도 화면은 그대로 간다(saveLastStep이 삼킨다).
  useEffect(() => {
    if (!reviewId) return;
    void saveLastStep(reviewId, step);
  }, [reviewId, step]);

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
      // 겹치면 늦게 도착한 초안 저장이 제출 완료 상태를 초안으로 되돌린다.
      await waitForSave();
      savingRef.current = true;
      const rev = revRef.current;
      const { feedback: f, newTasks: nt, newSkills: ns, targets: tg, rows: rw } = snapshot.current;
      // 제출 RPC는 서버에서 FTE 합계를 다시 더한다(§7-2 제출 게이트 ③).
      // 배분이 같은 payload에 실려 가므로(v2 F5) 저장과 합계 계산이 한 트랜잭션 안에서 이어진다.
      const payload = buildDraftPayload(f, { newTasks: nt, newSkills: ns, fte: ftePayload(tg, rw) });
      const saved = await saveReviewDraft(current.review_id, payload);

      const res = await submitReview(current.review_id, payload);

      // 서버 제출 게이트에 걸렸다. 오류가 아니라 "아직 덜 채운 상태"라 제출로 넘기지 않는다.
      // 방금 초안과 배분은 저장됐으므로(위 두 줄) 저장 칩도 그 사실에 맞춘다 — 제출 구간 동안
      // 자동 저장을 잠가 두었기 때문에 여기서 맞추지 않으면 칩이 '입력 중'에 멈춰 있는다.
      if (!res.ok) {
        setMissing(res.missing);
        setReview(saved);
        setSaveState(revRef.current === rev ? 'saved' : 'dirty');
        showSnackbar({ type: 'warning', msg: gateStep5Missing(res.missing.length), duration: 0 });
        return;
      }

      setMissing([]);
      setReview(res.state);
      // 서버가 재제출 시 rejected_reason을 비운다(submit_review). 화면도 같이 지워야 지난 사이클의
      // 반려 사유가 새 제출본 위에 계속 붙어 있지 않는다.
      setRejectedReason('');
      revRef.current += 1;
      setSaveState('saved');
      setSaveError('');
      showToast({ type: 'success', msg: '검토를 제출하셨습니다. 담당자가 확인한 뒤 결과가 반영됩니다.' });
    } catch (e) {
      showSnackbar({ type: 'error', msg: errMsg(e), duration: 0 });
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
            className="flex min-h-11 items-center gap-1 t-label text-foreground-muted transition hover:text-primary"
          >
            <ArrowLeft size={16} aria-hidden="true" /> 내 검토 목록
          </button>
          <p className="mb-1 mt-1 t-label text-foreground-muted">
            SME 검토 · {statusLabel}
            <TermHint id="review-status" />
            {user.company_name && <span className="ml-2 text-primary">· {user.company_name}</span>}
          </p>
          {/* 직무는 배정으로 정해진다. 화면에서는 바꿀 수 없고 읽기 전용으로만 보여 준다. */}
          <h2 className="t-title text-foreground">{jobDetail?.name || '직무정보 검토'}</h2>
          {jobDetail && (
            <p className="mt-1 t-label text-foreground-subtle">
              {jobDetail.group_name} · {jobDetail.series_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="t-caption text-foreground-muted">평가 진행률</span>
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
          <span className="t-caption font-medium text-primary">
            {done}/{total} ({percent}%)
          </span>
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />
      <Snackbar snackbar={snackbar} onDismiss={dismissSnackbar} />

      {loadingDetail ? (
        <div className="flex items-center justify-center gap-2 py-20 t-label text-foreground-muted">
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

          <section className="rounded-element border border-border bg-card p-5 shadow-1 lg:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <h3
                ref={stepTitleRef}
                tabIndex={-1}
                className="min-w-0 t-body font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                {stepBarTitle(jobDetail.name, step)}
              </h3>
              {/* 물음표는 aria-live 영역 밖에 둔다 — 안에 넣으면 저장 상태가 바뀔 때마다 함께 읽힌다. */}
              <div className="flex items-center gap-1">
                <SaveStatusChip
                  state={saveState}
                  error={saveError}
                  savedAt={review?.last_saved_at || null}
                  onRetry={() => void runSave()}
                />
                <TermHint id="autosave" />
              </div>
            </div>

            {reviewError && (
              <div className="mb-5 flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-4 py-3 t-label text-destructive">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p>{reviewError}</p>
                  <p className="mt-1 t-caption">검토 내용을 저장할 수 없어 입력이 잠겨 있습니다.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setDetailReload((n) => n + 1)}>
                  <RefreshCw size={14} aria-hidden="true" /> 다시 시도
                </Button>
              </div>
            )}
            {locked && review && (
              <div className="mb-5 flex items-start gap-2 rounded-element border border-primary-border bg-primary-subtle px-4 py-3 t-label text-primary">
                <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>
                  이미 제출하신 검토라 수정하실 수 없습니다
                  {review.submitted_at ? ` (제출 ${hhmm(review.submitted_at)})` : ''}. 수정이 필요하면 관리자에게
                  재검토를 요청해 주세요.
                  <TermHint id="lock" />
                </p>
              </div>
            )}

            {/*
              반려 사유 배너(§6-3 ⓑ · §10 P3 DoD ①). REVIEW_REQUESTED = 관리자가 반려해 SME에게
              되돌아온 상태다. 사유는 화면 진입 때 읽은 값만 믿는다(rejectedReason 주석 참고).

              단계 힌트(step·onGoToStep)는 넘기지 않는다. 반려가 겨눈 단계를 저장하는 컬럼이 없어
              "어느 단계" 를 지어내야 하기 때문이다 — 실제로도 이 상태에서는 5단계 전부가 다시 열린다.
            */}
            {review?.status === 'REVIEW_REQUESTED' && <RecheckBanner reason={rejectedReason} />}

            {/* 문의 답변 도착 배너(§6-3 ⓒ). 이동 경로가 없으면(라우터가 안 넘기면) 띄우지 않는다. */}
            {onOpenInquiries && <AnsweredInquiryBanner inquiries={answeredInquiries} onOpen={onOpenInquiries} />}

            {showCoach && <FirstVisitNotice userId={user.id} onDone={() => setCoachDone(true)} />}

            {/*
              §6-1 핵심 동작 — 각 단계 상단의 축약 가이드.
              v4에서 「하실 일 · 이 정도면 충분합니다 · 안 하셔도 됩니다」 세 줄 구조가 되었고,
              그 세션에서 처음 여는 단계에서는 펼친 채로 시작한다(G5).
            */}
            <StepGuideBox step={step} />

            <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
              {step === 1 && (
                <div className="space-y-10">
                  <FeedbackSection
                    title="A. 직무명 검토"
                    term="job"
                    hint={HINT_STEP1_PICK_ONE}
                    current={jobDetail.name}
                    feedback={feedback.name || EMPTY_FEEDBACK}
                    update={(v) => update('name', v)}
                    suggestionLabel="대체 직무명 제안"
                    done={ratedCount(['name'])}
                    total={1}
                  />
                  <FeedbackSection
                    title="B. 직무정의 검토"
                    term="job-definition"
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
                          <p className="t-caption-2 font-semibold text-primary">{ex.group}</p>
                          <p className="mt-1 t-label font-medium text-foreground">{ex.name}</p>
                          <p className="mt-0.5 t-caption leading-5 text-foreground-muted">{ex.description}</p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 t-caption leading-5 text-foreground-subtle">{TASK_EXAMPLE_TIP}</p>
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
                  excluded={excluded}
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
                <span className="flex items-center">
                  <TermHint id="save-vs-submit" />
                </span>
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
      <InquiryButton
        reviewId={review?.review_id || null}
        step={step}
        jobName={jobDetail?.name}
        inquiryContact={inquiryContact}
      />

      {confirmOpen && (
        <ModalShell
          title="검토를 제출할까요?"
          onClose={() => setConfirmOpen(false)}
          // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
          hideClose
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
          {/* 제출의 결과를 먼저 말한다(v4 G7). 지금까지는 "수정할 수 없다" 한 줄뿐이었다. */}
          <ul className="mb-4 space-y-1 t-label-reading text-foreground">
            {SUBMIT_NOTICE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ul className="space-y-1.5 t-label text-foreground-muted">
            <li>
              고른 항목 {done}/{total}개
            </li>
            <li>투입 비중 합계 {fteSum}%</li>
            {total - done > 0 && (
              <li className="text-warning">아직 고르지 않은 항목이 {total - done}개 있습니다.</li>
            )}
          </ul>
        </ModalShell>
      )}
    </div>
  );
}

/**
 * 저장된 배분을 화면 키로 되돌린다(v2 F5).
 * 신규 제안 행은 client_key로 저장·조회되므로 이름을 거칠 일이 없다.
 */
function restoreRows(allocations: FteAllocationInput[]): FteRow[] {
  const rows: FteRow[] = [];
  for (const a of allocations) {
    if (a.target_type === 'EXISTING') {
      if (a.task_id) rows.push({ key: `task-${a.task_id}`, pct: a.pct });
    } else if (a.client_key) {
      rows.push({ key: `sug-${a.client_key}`, pct: a.pct });
    }
  }
  return rows;
}
