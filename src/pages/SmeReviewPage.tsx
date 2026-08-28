// SME 직무 검토 화면 — SME가 직무명/직무정의/주요과업/Skill/수행요건을 섹션별로 검토·저장·제출한다.
// 이 앱에서 가장 중요한 화면이다. 실제 저장은 src/lib/reviewApi.ts(RPC 한 트랜잭션)가 담당하고,
// 섹션 렌더러와 공통 조각은 src/pages/sme-review/ 에 있다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, CloudOff, Loader2, Lock, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Toast, useToast } from '@/components/ui/Toast';
import { fetchAllJobsResult, fetchJobDetailResult, type JobListItem, type JobDetail } from '@/lib/jobApi';
import {
  buildDraftPayload,
  fetchReviewFeedback,
  getOrCreateReviewForJob,
  saveReviewDraft,
  submitReview,
  toFeedbackState,
  type ReviewState,
  type ReviewStatus,
  type SuggestionInput,
} from '@/lib/reviewApi';
import type { Feedback, User } from '@/types';
import {
  FeedbackSection,
  RequirementFeedback,
  SkillFeedback,
  TaskActivityFeedback,
  type ListState,
} from './sme-review/sections';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const STATUS_LABEL: Record<ReviewStatus, string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '작성 중',
  SUBMITTED: '제출 완료',
  REVIEW_REQUESTED: '재검토 요청',
  RESUBMITTED: '재제출 완료',
};

const SECTION_LABELS = [
  'A. 직무명 검토',
  'B. 직무정의 검토',
  'C. 주요과업 및 세부활동 검토',
  'D. 필요 Skill 검토',
  'E. 수행요건 검토',
];
const NAV_LABELS = ['직무명 검토', '직무정의 검토', '주요과업 및 세부활동 검토', '필요 Skill 검토', '수행요건 검토'];
const REQ_KEYS = ['req-education', 'req-major', 'req-certifications'];
const EMPTY_FEEDBACK: Feedback = { suitability: '', comment: '', suggestion: '' };

const errMsg = (e: unknown) =>
  e instanceof Error && e.message ? e.message : '알 수 없는 오류로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

export function ReviewWorkspace({
  user,
  onBack,
  jobId,
  onSelectJob,
  onDirtyChange,
}: {
  user: User;
  onBack: () => void;
  /** URL(/review/:jobId)이 지정한 직무. 내 검토 목록·검토 이력에서 넘어올 때 들어온다. */
  jobId?: string;
  /** 화면 안에서 직무를 바꾸면 URL도 따라오게 한다. */
  onSelectJob?: (jobId: string) => void;
  /** 미저장 변경 여부를 부모(라우터)에게 알린다. 라우트 이탈 가드가 이 값을 본다. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [jobList, setJobList] = useState<JobListItem[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobsReload, setJobsReload] = useState(0);

  const [selectedJobId, setSelectedJobId] = useState('');
  const [selGroup, setSelGroup] = useState('');
  const [selSeries, setSelSeries] = useState('');

  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailReload, setDetailReload] = useState(0);

  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewError, setReviewError] = useState('');

  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [newTasks, setNewTasks] = useState<SuggestionInput[]>([]);
  const [newSkills, setNewSkills] = useState<SuggestionInput[]>([]);

  const [section, setSection] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [onlyUnrated, setOnlyUnrated] = useState(false);
  const [collapseDone, setCollapseDone] = useState(true);

  const { toast, showToast, dismiss } = useToast();

  const locked = review?.status === 'SUBMITTED' || review?.status === 'RESUBMITTED';
  const readOnly = locked || !review;
  const dirty = saveState === 'dirty' || saveState === 'error';

  // 저장 시점의 최신 값을 읽기 위한 참조. 저장 함수를 매 입력마다 새로 만들지 않으려는 목적이다.
  const snapshot = useRef({ feedback, newTasks, newSkills });
  snapshot.current = { feedback, newTasks, newSkills };
  const reviewRef = useRef<ReviewState | null>(null);
  reviewRef.current = review;
  const lockedRef = useRef(false);
  lockedRef.current = !!locked;
  const revRef = useRef(0); // 편집할 때마다 +1. 저장 응답이 오는 사이 또 편집했는지 판별한다.
  const savingRef = useRef(false);
  // 목록을 다시 부를 때 URL 직무를 참고하되, jobId 변경만으로 목록을 다시 부르지는 않는다.
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  // ── 직무 목록 ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingJobs(true);
    setJobsError('');
    fetchAllJobsResult(user.company_id || null).then((res) => {
      if (cancelled) return;
      setLoadingJobs(false);
      if (!res.ok) {
        setJobsError(res.error);
        setJobList([]);
        return;
      }
      setJobList(res.data);
      // URL이 직무를 지정했으면 그 직무를 연다. 없으면 첫 직무.
      const target = res.data.find((j) => j.id === jobIdRef.current) || res.data[0];
      setSelGroup(target?.group_name || '');
      setSelSeries(target?.series_name || '');
      setSelectedJobId(target?.id || '');
    });
    return () => {
      cancelled = true;
    };
  }, [user.company_id, jobsReload]);

  // URL이 뒤로가기 등으로 바뀌면 목록이 이미 있는 경우에도 따라간다.
  useEffect(() => {
    if (!jobId || jobId === selectedJobId) return;
    const job = jobList.find((j) => j.id === jobId);
    if (!job) return;
    setSelGroup(job.group_name);
    setSelSeries(job.series_name);
    setSelectedJobId(job.id);
  }, [jobId, jobList, selectedJobId]);

  // ── 직무 상세 + 검토 세션 복원 ────────────────────────────────────
  useEffect(() => {
    if (!selectedJobId) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');
    setReviewError('');
    setReview(null);
    setFeedback({});
    setNewTasks([]);
    setNewSkills([]);
    setOpenIds(new Set());
    setSection(0);
    setSaveState('idle');
    setSaveError('');
    revRef.current = 0;

    (async () => {
      const res = await fetchJobDetailResult(selectedJobId);
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
        const state = await getOrCreateReviewForJob(user.id, selectedJobId);
        const saved = await fetchReviewFeedback(state.review_id);
        if (cancelled) return;
        setReview(state);
        setFeedback(toFeedbackState(saved));
        setNewTasks(saved.newTasks);
        setNewSkills(saved.newSkills);
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
  }, [selectedJobId, user.id, detailReload]);

  // ── 저장 ──────────────────────────────────────────────────────────
  const runSave = useCallback(async () => {
    const current = reviewRef.current;
    if (!current || lockedRef.current || savingRef.current) return;
    const rev = revRef.current;
    savingRef.current = true;
    setSaveState('saving');
    setSaveError('');
    try {
      const { feedback: f, newTasks: nt, newSkills: ns } = snapshot.current;
      const next = await saveReviewDraft(current.review_id, buildDraftPayload(f, { newTasks: nt, newSkills: ns }));
      setReview(next);
      // 저장을 기다리는 동안 또 입력했으면 아직 '저장됨'이 아니다.
      setSaveState(revRef.current === rev ? 'saved' : 'dirty');
    } catch (e) {
      setSaveError(errMsg(e));
      setSaveState('error');
    } finally {
      savingRef.current = false;
    }
  }, []);

  // 자동 저장 — 입력이 2.5초 멈추면 보낸다. 저장 중에는 타이머가 잡히지 않는다(saveState 가드).
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = setTimeout(() => {
      void runSave();
    }, 2500);
    return () => clearTimeout(timer);
  }, [saveState, feedback, newTasks, newSkills, runSave]);

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

  const markDirty = () => {
    revRef.current += 1;
    setSaveState('dirty');
  };

  const update = useCallback((key: string, value: Partial<Feedback>) => {
    setFeedback((prev) => ({ ...prev, [key]: { ...(prev[key] || EMPTY_FEEDBACK), ...value } }));
    revRef.current += 1;
    setSaveState('dirty');
  }, []);

  const openItem = useCallback((key: string) => {
    setOpenIds((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  // ── 진행률: 실제로 평가한 항목 수로 센다 ──────────────────────────
  const sectionKeys = useMemo<string[][]>(
    () => [
      ['name'],
      ['definition'],
      (jobDetail?.tasks || []).map((t) => `task-${t.id}`),
      (jobDetail?.skills || []).map((s) => `skill-${s.id}`),
      REQ_KEYS,
    ],
    [jobDetail],
  );
  const ratedCount = (keys: string[]) => keys.filter((k) => feedback[k]?.suitability).length;
  const perSection = sectionKeys.map((keys) => ({ done: ratedCount(keys), total: keys.length }));
  const total = perSection.reduce((n, s) => n + s.total, 0);
  const done = perSection.reduce((n, s) => n + s.done, 0);
  const percent = total ? Math.round((done / total) * 100) : 0;

  const listState: ListState = {
    onlyUnrated,
    setOnlyUnrated,
    collapseDone,
    setCollapseDone,
    props: { openIds, onOpen: openItem, collapseDone, onlyUnrated },
  };

  // ── 직무 전환 가드 ────────────────────────────────────────────────
  const confirmLeave = () =>
    !dirty || window.confirm('저장하지 않은 검토 내용이 있어요. 지금 이동하면 입력한 내용이 사라집니다. 이동할까요?');

  const pickJob = (job: JobListItem | undefined) => {
    if (!confirmLeave()) return;
    setSelGroup(job?.group_name || '');
    setSelSeries(job?.series_name || '');
    setSelectedJobId(job?.id || '');
    if (job) onSelectJob?.(job.id); // URL도 함께 옮겨 새로고침·공유가 같은 직무를 연다.
  };

  const groups = [...new Set(jobList.map((j) => j.group_name))];
  const series = [...new Set(jobList.filter((j) => j.group_name === selGroup).map((j) => j.series_name))];
  const jobsInSeries = jobList.filter((j) => j.group_name === selGroup && j.series_name === selSeries);

  const softSkills = jobDetail?.skills.filter((s) => s.skill_type === 'Soft Skill') || [];
  const hardSkills = jobDetail?.skills.filter((s) => s.skill_type === 'Hard Skill') || [];

  // ── 제출 ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!review) return;
    const unrated = total - done;
    const head = unrated > 0 ? `아직 평가하지 않은 항목이 ${unrated}개 있어요.\n\n` : '';
    if (!window.confirm(`${head}최종 제출 후에는 관리자가 재검토를 요청하기 전까지 수정할 수 없어요. 제출할까요?`))
      return;

    setSubmitting(true);
    try {
      const { feedback: f, newTasks: nt, newSkills: ns } = snapshot.current;
      const next = await submitReview(review.review_id, buildDraftPayload(f, { newTasks: nt, newSkills: ns }));
      setReview(next);
      revRef.current += 1;
      setSaveState('saved');
      setSaveError('');
      showToast({ type: 'success', msg: '검토를 제출했어요. 관리자가 확인한 뒤 결과가 반영됩니다.' });
    } catch (e) {
      showToast({ type: 'error', msg: errMsg(e), duration: 0 });
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = review ? STATUS_LABEL[review.status] : '작성 전';

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <button
            type="button"
            onClick={() => confirmLeave() && onBack()}
            className="flex min-h-11 items-center gap-1 text-sm text-foreground-muted transition hover:text-primary"
          >
            <ArrowLeft size={16} aria-hidden="true" /> 검토 이력
          </button>
          <p className="mb-1 mt-1 text-sm text-foreground-muted">
            SME 검토 · {statusLabel}
            {user.company_name && <span className="ml-2 text-primary">· {user.company_name}</span>}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">직무정보 검토</h2>
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

      {loadingJobs ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-foreground-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 직무 목록을 불러오는 중…
        </div>
      ) : jobsError ? (
        <ErrorPanel
          title="직무 목록을 불러오지 못했어요."
          detail={jobsError}
          onRetry={() => setJobsReload((n) => n + 1)}
        />
      ) : jobList.length === 0 ? (
        <div className="rounded-element border border-warning-border bg-warning-muted p-8 text-center text-sm text-warning">
          등록된 직무가 없습니다. 관리자가 직무정보를 업로드한 후 검토할 수 있습니다.
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <Select
              label="직군"
              value={selGroup}
              options={groups.map((g) => ({ value: g, label: g }))}
              onChange={(g) => pickJob(jobList.find((j) => j.group_name === g))}
            />
            <Select
              label="직렬"
              value={selSeries}
              options={series.map((s) => ({ value: s, label: s }))}
              onChange={(s) => pickJob(jobList.find((j) => j.group_name === selGroup && j.series_name === s))}
            />
            <Select
              label="직무"
              value={selectedJobId}
              options={jobsInSeries.map((j) => ({ value: j.id, label: j.name }))}
              onChange={(id) => pickJob(jobList.find((j) => j.id === id))}
            />
          </div>

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
              <aside className="h-fit rounded-element border border-border bg-card p-3 shadow-sm">
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                  검토 섹션
                </p>
                {NAV_LABELS.map((label, i) => {
                  const s = perSection[i];
                  const complete = s.total > 0 && s.done === s.total;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setSection(i)}
                      aria-current={section === i ? 'true' : undefined}
                      className={`flex w-full min-h-11 items-center gap-2 rounded-element px-3 py-2 text-left text-sm ${section === i ? 'bg-primary-subtle font-semibold text-primary' : 'text-foreground-muted hover:bg-muted'}`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${complete ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground-muted'}`}
                      >
                        {complete ? <Check size={12} aria-hidden="true" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">{label}</span>
                      <span className="shrink-0 text-[11px] font-normal text-foreground-subtle">
                        {s.done}/{s.total}
                      </span>
                      {complete && <span className="sr-only">완료</span>}
                    </button>
                  );
                })}
                <div className="mt-4 border-t border-border px-3 pt-4">
                  <p className="text-xs text-foreground-subtle">자동 저장</p>
                  <SaveIndicator
                    state={saveState}
                    error={saveError}
                    savedAt={review?.last_saved_at || null}
                    onRetry={() => void runSave()}
                  />
                </div>
              </aside>

              <section className="rounded-element border border-border bg-card p-5 shadow-sm lg:p-7">
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
                {locked && (
                  <div className="mb-5 flex items-start gap-2 rounded-element border border-primary-border bg-primary-subtle px-4 py-3 text-sm text-primary">
                    <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <p>
                      이미 제출한 검토라 수정할 수 없어요
                      {review.submitted_at ? ` (제출 ${hhmm(review.submitted_at)})` : ''}. 수정이 필요하면 관리자에게
                      재검토를 요청해 주세요.
                    </p>
                  </div>
                )}

                <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
                  {section === 0 && (
                    <FeedbackSection
                      title={SECTION_LABELS[0]}
                      current={jobDetail.name}
                      feedback={feedback.name || EMPTY_FEEDBACK}
                      update={(v) => update('name', v)}
                      suggestionLabel="대체 직무명 제안"
                      done={perSection[0].done}
                      total={perSection[0].total}
                    />
                  )}
                  {section === 1 && (
                    <FeedbackSection
                      title={SECTION_LABELS[1]}
                      current={jobDetail.definition}
                      feedback={feedback.definition || EMPTY_FEEDBACK}
                      update={(v) => update('definition', v)}
                      suggestionLabel="수정 직무정의 제안"
                      large
                      done={perSection[1].done}
                      total={perSection[1].total}
                    />
                  )}
                  {section === 2 && (
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
                      done={perSection[2].done}
                      total={perSection[2].total}
                    />
                  )}
                  {section === 3 && (
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
                      done={perSection[3].done}
                      total={perSection[3].total}
                    />
                  )}
                  {section === 4 && (
                    <RequirementFeedback
                      requirements={jobDetail.requirements}
                      feedback={feedback}
                      update={update}
                      listState={listState}
                      done={perSection[4].done}
                      total={perSection[4].total}
                    />
                  )}
                </fieldset>

                <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row">
                  <Button variant="secondary" disabled={section === 0} onClick={() => setSection(section - 1)}>
                    이전 섹션
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void runSave()}
                      disabled={readOnly}
                      loading={saveState === 'saving'}
                    >
                      <Save size={15} aria-hidden="true" /> 임시저장
                    </Button>
                    {section < NAV_LABELS.length - 1 ? (
                      <Button onClick={() => setSection(section + 1)}>다음 섹션</Button>
                    ) : (
                      <Button onClick={() => void handleSubmit()} disabled={readOnly} loading={submitting}>
                        {review?.status === 'REVIEW_REQUESTED' ? '재제출' : '최종 제출'}
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/** 저장 상태 3+1단계 — 입력 중 / 저장 중 / 저장됨·시각 / 실패(재시도). */
function SaveIndicator({
  state,
  error,
  savedAt,
  onRetry,
}: {
  state: SaveState;
  error: string;
  savedAt: string | null;
  onRetry: () => void;
}) {
  if (state === 'error') {
    return (
      <div className="mt-1 rounded-element border border-destructive-border bg-destructive-muted p-2 text-xs text-destructive">
        <p className="flex items-center gap-1 font-medium">
          <CloudOff size={13} aria-hidden="true" /> 저장하지 못했어요
        </p>
        <p className="mt-1 leading-5">{error}</p>
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-2 w-full">
          <RefreshCw size={13} aria-hidden="true" /> 다시 저장
        </Button>
      </div>
    );
  }
  if (state === 'saving') {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-foreground-muted">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" /> 저장 중…
      </p>
    );
  }
  if (state === 'saved') {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-success">
        <Check size={13} aria-hidden="true" /> 저장됨{savedAt ? ` · ${hhmm(savedAt)}` : ''}
      </p>
    );
  }
  if (state === 'dirty') {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-warning">
        <Loader2 size={13} aria-hidden="true" /> 입력 중 · 잠시 후 자동 저장
      </p>
    );
  }
  return <p className="mt-1 text-xs text-foreground-subtle">아직 입력한 내용이 없어요.</p>;
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

// 이 화면 전용 select. 값(value)과 표시(label)를 분리해야 동명 직무 2건을 구분할 수 있다.
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input min-h-11" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.length === 0 && <option value="">선택할 항목이 없어요</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
