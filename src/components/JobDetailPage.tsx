import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Pencil,
  X,
  Save,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  RotateCcw,
  RefreshCw,
  Loader2,
  Users,
} from 'lucide-react';
import {
  fetchJobDetailResult,
  fetchGroupSeriesOptionsResult,
  checkDuplicateJob,
  hasTaskFeedback,
  hasSkillFeedback,
  saveJobEdits,
  mapReviewStatus,
  type JobDetail,
  type GroupSeriesOption,
} from '@/lib/jobApi';
import {
  fetchJobReviewFeedback,
  toFeedbackState,
  type SmeReviewFeedback,
  type SuitabilityLabel,
} from '@/lib/reviewApi';
import { decideReview } from '@/lib/adminApi';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import { Field } from '@/components/ui/Field';
import { Toast, useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/shared/StatusBadge';

interface Props {
  jobId: string;
  onBack: () => void;
  userId: string;
  companyId?: string | null;
}

/** 목록에서 중간 항목을 지워도 뒤 입력칸의 포커스·한글 조합이 엉키지 않도록 행마다 고정 키를 붙인다. */
let uidSeq = 0;
const uid = () => `row-${++uidSeq}`;

interface EditActivity {
  uid: string;
  id?: string;
  activity_name: string;
  sort_order: number;
}
interface EditTask {
  uid: string;
  id?: string;
  name: string;
  description: string;
  sort_order: number;
  activities: EditActivity[];
  _deleted?: boolean;
}
interface EditSkill {
  uid: string;
  id?: string;
  name: string;
  skill_type: string;
  sort_order: number;
  _deleted?: boolean;
}

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** SME 피드백 → 편집 폼 필드 연결용 DOM id. 조회/편집 두 모드에서 같은 id를 쓴다. */
const fieldId = (key: string) => `jobfield-${key}`;

const JOB_FIELD_LABEL: Record<string, string> = {
  name: '직무명',
  definition: '직무 정의',
  'req-education': '요구 학력',
  'req-major': '관련 전공',
  'req-certifications': '관련 자격증/면허',
};

export function JobDetailPage({ jobId, onBack, userId, companyId }: Props) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [options, setOptions] = useState<GroupSeriesOption | null>(null);
  const { toast, showToast, dismiss } = useToast();

  // Edit state
  const [editName, setEditName] = useState('');
  const [editGroupId, setEditGroupId] = useState('');
  const [editSeriesId, setEditSeriesId] = useState('');
  const [editDefinition, setEditDefinition] = useState('');
  const [editTasks, setEditTasks] = useState<EditTask[]>([]);
  const [editSkills, setEditSkills] = useState<EditSkill[]>([]);
  const [editReq, setEditReq] = useState({ education: '', major: '', certifications: '' });
  const [dupError, setDupError] = useState<string | null>(null);

  // SME 피드백 패널
  const [feedback, setFeedback] = useState<SmeReviewFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [rereviewTarget, setRereviewTarget] = useState<SmeReviewFeedback | null>(null);

  /*
    구조 편집 잠금(v2 F6 · 결정 D7).
    검토가 시작된 뒤 과업·Skill을 지우거나 더하면 SME 응답의 참조가 끊긴다 —
    제출 게이트는 "활성 과업 전부"의 평가를 요구하고, 배분 합계도 활성 과업 기준이다.
    그래서 응답이 걸린 직무는 구조(추가·삭제·순서)를 잠그고 문구·정의 수정만 남긴다.
    서버도 같은 조건을 다시 본다(trg_job_tasks_structure_lock) — 화면만의 약속이 아니다.
  */
  const structureLocked = feedback.some((f) => f.status !== 'NOT_STARTED');

  const backRef = useRef(onBack);
  backRef.current = onBack;

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await fetchJobDetailResult(jobId);
    if (!result.ok) {
      // 조회 실패를 "데이터 없음"으로 보여주지 않는다 — 사유와 다시 시도할 방법을 함께 준다.
      setDetail(null);
      setLoadError('직무 정보를 불러오지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
    } else {
      setDetail(result.data);
      setLoadError(null);
    }
    setLoading(false);
  }, [jobId]);

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      setFeedback(await fetchJobReviewFeedback(jobId));
    } catch (e) {
      setFeedback([]);
      setFeedbackError(
        e instanceof Error && e.message
          ? `${e.message} 잠시 후 다시 시도해 주세요.`
          : 'SME 검토 내용을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setFeedbackLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    setEditMode(false);
    setDirty(false);
    loadDetail();
    loadFeedback();
  }, [loadDetail, loadFeedback]);

  // Unsaved changes guard
  useEffect(() => {
    if (!dirty || !editMode) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, editMode]);

  // 강조 표시는 잠깐만 남긴다.
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2000);
    return () => clearTimeout(t);
  }, [highlight]);

  function handleBack() {
    if (dirty && editMode) {
      setConfirmState({
        title: '저장하지 않고 나갈까요?',
        description: '저장하지 않은 변경 내용이 있어요. 지금 나가면 입력한 내용이 사라집니다.',
        confirmLabel: '나가기',
        onConfirm: () => backRef.current(),
      });
      return;
    }
    backRef.current();
  }

  async function enterEditMode() {
    if (!detail) return;
    if (!options) {
      const result = await fetchGroupSeriesOptionsResult(companyId ?? null);
      if (!result.ok) {
        showToast({
          type: 'error',
          msg: '직군·직렬 목록을 불러오지 못해 수정을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      setOptions(result.data);
    }
    resetEditState(detail);
    setDupError(null);
    setEditMode(true);
  }

  function resetEditState(d: JobDetail) {
    setEditName(d.name);
    setEditGroupId(d.group_id);
    setEditSeriesId(d.series_id);
    setEditDefinition(d.definition);
    setEditTasks(
      (d.tasks || []).map((t, ti) => ({
        uid: uid(),
        id: t.id,
        name: t.name,
        description: t.description || '',
        sort_order: ti,
        activities: t.task_activities.map((a, ai) => ({
          uid: uid(),
          id: a.id,
          activity_name: a.activity_name,
          sort_order: ai,
        })),
      })),
    );
    setEditSkills(
      (d.skills || []).map((s, si) => ({
        uid: uid(),
        id: s.id,
        name: s.name,
        skill_type: s.skill_type,
        sort_order: si,
      })),
    );
    setEditReq({
      education: d.requirements?.education || '',
      major: d.requirements?.major || '',
      certifications: d.requirements?.certifications || '',
    });
    setDirty(false);
  }

  function cancelEdit() {
    if (!detail) {
      setEditMode(false);
      return;
    }
    resetEditState(detail);
    setEditMode(false);
    setDupError(null);
  }

  // ── Task helpers ──
  function updateTask(idx: number, patch: Partial<EditTask>) {
    setEditTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
    setDirty(true);
  }
  function addTask() {
    setEditTasks((prev) => [
      ...prev,
      { uid: uid(), name: '', description: '', sort_order: prev.length, activities: [] },
    ]);
    setDirty(true);
  }
  function removeTaskAt(idx: number) {
    setEditTasks((prev) => prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, sort_order: i })));
    setDirty(true);
  }
  async function deleteTask(idx: number) {
    const task = editTasks[idx];
    if (task.id && (await hasTaskFeedback(task.id))) {
      setConfirmState({
        title: '검토이력이 연결된 과업이에요',
        description:
          '이 과업에는 SME가 남긴 검토 내용이 연결되어 있어요. 삭제하면 원본 항목과 검토이력의 연결이 끊어질 수 있습니다. 계속할까요?',
        confirmLabel: '삭제',
        onConfirm: () => removeTaskAt(idx),
      });
      return;
    }
    removeTaskAt(idx);
  }
  function moveTask(idx: number, dir: -1 | 1) {
    setEditTasks((prev) => {
      const arr = [...prev];
      const ni = idx + dir;
      if (ni < 0 || ni >= arr.length) return arr;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return arr.map((t, i) => ({ ...t, sort_order: i }));
    });
    setDirty(true);
  }

  // ── Activity helpers ──
  function updateActivity(ti: number, ai: number, value: string) {
    setEditTasks((prev) =>
      prev.map((t, i) =>
        i === ti
          ? { ...t, activities: t.activities.map((a, j) => (j === ai ? { ...a, activity_name: value } : a)) }
          : t,
      ),
    );
    setDirty(true);
  }
  function addActivity(ti: number) {
    setEditTasks((prev) =>
      prev.map((t, i) =>
        i === ti
          ? { ...t, activities: [...t.activities, { uid: uid(), activity_name: '', sort_order: t.activities.length }] }
          : t,
      ),
    );
    setDirty(true);
  }
  function deleteActivity(ti: number, ai: number) {
    setEditTasks((prev) =>
      prev.map((t, i) =>
        i === ti
          ? { ...t, activities: t.activities.filter((_, j) => j !== ai).map((a, j) => ({ ...a, sort_order: j })) }
          : t,
      ),
    );
    setDirty(true);
  }
  function moveActivity(ti: number, ai: number, dir: -1 | 1) {
    setEditTasks((prev) =>
      prev.map((t, i) =>
        i === ti
          ? {
              ...t,
              activities: (() => {
                const arr = [...t.activities];
                const ni = ai + dir;
                if (ni < 0 || ni >= arr.length) return arr;
                [arr[ai], arr[ni]] = [arr[ni], arr[ai]];
                return arr.map((a, j) => ({ ...a, sort_order: j }));
              })(),
            }
          : t,
      ),
    );
    setDirty(true);
  }

  // ── Skill helpers (uid 기준 — 필터된 목록의 인덱스를 쓰지 않는다) ──
  function addSkill(type: 'Soft Skill' | 'Hard Skill') {
    const sameType = editSkills.filter((s) => s.skill_type === type && !s._deleted);
    setEditSkills((prev) => [...prev, { uid: uid(), name: '', skill_type: type, sort_order: sameType.length }]);
    setDirty(true);
  }
  function updateSkill(rowUid: string, name: string) {
    setEditSkills((prev) => prev.map((s) => (s.uid === rowUid ? { ...s, name } : s)));
    setDirty(true);
  }
  function removeSkill(rowUid: string) {
    setEditSkills((prev) => prev.filter((s) => s.uid !== rowUid));
    setDirty(true);
  }
  async function deleteSkill(rowUid: string) {
    const skill = editSkills.find((s) => s.uid === rowUid);
    if (!skill) return;
    if (skill.id && (await hasSkillFeedback(skill.id))) {
      setConfirmState({
        title: '검토이력이 연결된 Skill이에요',
        description:
          '이 Skill에는 SME가 남긴 검토 내용이 연결되어 있어요. 삭제하면 원본 항목과 검토이력의 연결이 끊어질 수 있습니다. 계속할까요?',
        confirmLabel: '삭제',
        onConfirm: () => removeSkill(rowUid),
      });
      return;
    }
    removeSkill(rowUid);
  }

  // ── Save ──
  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    dismiss();
    setDupError(null);

    if (editName !== detail.name || editGroupId !== detail.group_id || editSeriesId !== detail.series_id) {
      const isDup = await checkDuplicateJob(editGroupId, editSeriesId, editName, jobId, companyId ?? null);
      if (isDup) {
        setDupError('같은 직군·직렬에 같은 이름의 직무가 이미 있어요. 직무명을 바꾸거나 다른 직렬을 선택해 주세요.');
        setSaving(false);
        return;
      }
    }

    const result = await saveJobEdits({
      jobId,
      groupId: editGroupId,
      seriesId: editSeriesId,
      name: editName,
      definition: editDefinition,
      tasks: editTasks,
      skills: editSkills,
      requirements: editReq,
      userId,
    });

    if (result.error) {
      // DB 원문은 콘솔에만 남기고, 화면에는 다음 행동을 알려 준다.
      console.error('Job edit save error:', result.error);
      showToast({
        type: 'error',
        msg: '직무정보를 저장하지 못했어요. 입력값을 확인한 뒤 다시 시도하고, 같은 문제가 이어지면 관리자에게 알려 주세요.',
        duration: 0,
      });
      setSaving(false);
      return;
    }

    const updated = await fetchJobDetailResult(jobId);
    if (updated.ok) setDetail(updated.data);
    setEditMode(false);
    setDirty(false);
    setSaving(false);
    showToast({ type: 'success', msg: '직무정보를 저장했어요.' });
  }

  // ── SME 피드백 → 편집 폼 이동 ──
  function focusField(key: string) {
    const el = document.getElementById(fieldId(key));
    if (!el) {
      showToast({ type: 'warning', msg: '이 항목은 지금 화면에 없어요. 이미 삭제된 항목일 수 있습니다.' });
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
    setHighlight(key);
  }

  const labelFor = useMemo(() => {
    const taskNames = new Map((detail?.tasks || []).map((t) => [t.id, t.name]));
    const skillNames = new Map((detail?.skills || []).map((s) => [s.id, s.name]));
    return (key: string): { kind: string; name: string } => {
      if (JOB_FIELD_LABEL[key]) return { kind: '직무정보', name: JOB_FIELD_LABEL[key] };
      if (key.startsWith('task-')) return { kind: '주요과업', name: taskNames.get(key.slice(5)) || '삭제된 과업' };
      if (key.startsWith('skill-')) return { kind: 'Skill', name: skillNames.get(key.slice(6)) || '삭제된 Skill' };
      return { kind: '항목', name: key };
    };
  }, [detail]);

  async function submitRereview(note: string) {
    if (!rereviewTarget) return;
    // 반려 경로는 decide_review 하나로 모은다. request_rereview는 사유를 review_history에만 남기고
    // reviews.rejected_reason을 쓰지 않아, 이 버튼으로 반려하면 SME 화면의 재검토 배너가 관리자가
    // 필수로 입력한 사유 대신 "사유가 함께 저장되지 않았어요"만 보여 준다(§10 P3 DoD ①).
    const result = await decideReview(rereviewTarget.review_id, 'REJECTED', note);
    if (!result.ok) throw new Error(result.error);
    setRereviewTarget(null);
    showToast({ type: 'success', msg: '재검토를 요청했어요. SME 화면에 「재검토 요청」으로 표시됩니다.' });
    loadFeedback();
  }

  const highlightClass = (key: string) =>
    highlight === key ? 'outline outline-2 outline-offset-2 outline-primary' : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-foreground-subtle">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        직무 상세 정보를 불러오는 중이에요…
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div className="rounded-container border border-border bg-card p-12 text-center">
        <AlertTriangle size={20} className="mx-auto mb-3 text-warning" aria-hidden="true" />
        <p className="text-sm text-foreground-muted">
          {loadError ?? '요청하신 직무를 찾을 수 없어요. 목록에서 다시 선택해 주세요.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {loadError && (
            <Button variant="primary" size="sm" onClick={loadDetail}>
              <RefreshCw size={14} aria-hidden="true" /> 다시 시도
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onBack}>
            목록으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  const softSkills = editMode
    ? editSkills.filter((s) => s.skill_type === 'Soft Skill')
    : detail.skills.filter((s) => s.skill_type === 'Soft Skill');
  const hardSkills = editMode
    ? editSkills.filter((s) => s.skill_type === 'Hard Skill')
    : detail.skills.filter((s) => s.skill_type === 'Hard Skill');

  const reqFields: [keyof typeof editReq, string, string][] = [
    ['education', '요구 학력', 'req-education'],
    ['major', '관련 전공', 'req-major'],
    ['certifications', '관련 자격증/면허', 'req-certifications'],
  ];

  const seriesOptions = options?.seriesByGroup.get(editGroupId) || [];

  return (
    <>
      {/* Breadcrumb */}
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-foreground-subtle">
        <button onClick={handleBack} className="flex items-center gap-1 rounded-element transition hover:text-primary">
          <ArrowLeft size={15} aria-hidden="true" /> 직무정보 관리
        </button>
        <ChevronRight size={14} className="text-foreground-subtle" aria-hidden="true" />
        <span className="font-medium text-foreground">{editMode ? editName : detail.name}</span>
      </nav>

      {/* Top header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-container border border-border bg-card p-6 shadow-sm">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">직무 상세정보</h2>
          <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground-subtle">직군</span>
              {editMode ? (
                <select
                  aria-label="직군"
                  value={editGroupId}
                  onChange={(e) => {
                    setEditGroupId(e.target.value);
                    setEditSeriesId('');
                    setDirty(true);
                  }}
                  className="min-h-11 rounded-element border border-border px-3 text-sm outline-none focus:border-primary sm:min-h-control-md"
                >
                  {options?.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-foreground-muted">{detail.group_name}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground-subtle">직렬</span>
              {editMode ? (
                <select
                  aria-label="직렬"
                  value={editSeriesId}
                  onChange={(e) => {
                    setEditSeriesId(e.target.value);
                    setDirty(true);
                  }}
                  className="min-h-11 rounded-element border border-border px-3 text-sm outline-none focus:border-primary sm:min-h-control-md"
                >
                  <option value="">선택</option>
                  {seriesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-foreground-muted">{detail.series_name}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground-subtle">직무</span>
              {editMode ? (
                <input
                  id={fieldId('name')}
                  aria-label="직무명"
                  aria-invalid={dupError ? true : undefined}
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setDirty(true);
                  }}
                  className={`min-h-11 w-56 rounded-element border px-3 text-sm font-semibold outline-none focus:border-primary sm:min-h-control-md ${
                    dupError ? 'border-destructive' : 'border-border'
                  } ${highlightClass('name')}`}
                />
              ) : (
                <span
                  id={fieldId('name')}
                  tabIndex={-1}
                  className={`text-sm font-semibold text-foreground ${highlightClass('name')}`}
                >
                  {detail.name}
                </span>
              )}
            </div>
          </div>
          {dupError && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle size={14} aria-hidden="true" /> {dupError}
            </p>
          )}
          {/* 구조 편집 잠금 안내(v2 F6) — 무엇이 잠겼고 무엇이 열려 있는지, 언제 풀리는지까지 적는다. */}
          {editMode && structureLocked && (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 rounded-element border border-warning-border bg-warning-muted px-3.5 py-2.5 text-sm text-warning"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                이 직무는 SME 검토가 시작돼 과업·Skill의 추가·삭제·순서 변경이 잠겨 있어요. 이름·설명·정의는 지금
                수정할 수 있고, 구조 변경은 검토가 끝난 뒤 재업로드로 해 주세요.
              </span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!editMode ? (
            <Button onClick={enterEditMode}>
              <Pencil size={15} aria-hidden="true" /> 직무정보 수정
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
                <X size={15} aria-hidden="true" /> 취소
              </Button>
              <Button onClick={handleSave} loading={saving}>
                {!saving && <Save size={15} aria-hidden="true" />}
                {saving ? '저장 중…' : '변경사항 저장'}
              </Button>
            </>
          )}
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      {/* 편집 폼(왼쪽)과 SME 피드백(오른쪽)을 나란히 둔다 — 무엇을 왜 고치는지 보면서 수정한다. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          {/* Section 1: 직무분류체계 */}
          <Section title="1. 직무분류체계">
            <div className="overflow-x-auto rounded-element border border-border">
              <table className="w-full min-w-[24rem] text-sm">
                <tbody>
                  {[
                    [
                      '직군',
                      editMode ? options?.groups.find((g) => g.id === editGroupId)?.name || '' : detail.group_name,
                    ],
                    [
                      '직렬',
                      editMode ? seriesOptions.find((s) => s.id === editSeriesId)?.name || '' : detail.series_name,
                    ],
                    ['직무', editMode ? editName : detail.name],
                  ].map(([label, value], i) => (
                    <tr key={label} className={i > 0 ? 'border-t border-border' : ''}>
                      <th
                        scope="row"
                        className="w-32 bg-muted px-5 py-3.5 text-left text-xs font-medium text-foreground-muted"
                      >
                        {label}
                      </th>
                      <td className="px-5 py-3.5 font-medium text-foreground">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Section 2: 직무 목적 및 정의 */}
          <Section title="2. 직무 목적 및 정의">
            {editMode ? (
              <textarea
                id={fieldId('definition')}
                aria-label="직무 정의"
                value={editDefinition}
                onChange={(e) => {
                  setEditDefinition(e.target.value);
                  setDirty(true);
                }}
                rows={4}
                className={`w-full rounded-element border border-border p-4 text-sm leading-7 text-foreground-muted outline-none focus:border-primary ${highlightClass('definition')}`}
                placeholder="직무 정의를 입력하세요"
              />
            ) : (
              <div
                id={fieldId('definition')}
                tabIndex={-1}
                className={`rounded-element border border-border bg-muted p-5 ${highlightClass('definition')}`}
              >
                {detail.definition ? (
                  <p className="text-sm leading-7 text-foreground-muted">{detail.definition}</p>
                ) : (
                  <p className="text-sm text-foreground-subtle">등록된 직무정의 정보가 없습니다.</p>
                )}
              </div>
            )}
          </Section>

          {/* Section 3: 주요 책임 및 과업 */}
          <Section title="3. 주요 책임 및 과업">
            {editMode ? (
              <div className="space-y-4">
                {editTasks.map((task, ti) => (
                  <div
                    key={task.uid}
                    id={task.id ? fieldId(`task-${task.id}`) : undefined}
                    tabIndex={task.id ? -1 : undefined}
                    className={`rounded-element border border-border p-5 ${task.id ? highlightClass(`task-${task.id}`) : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
                        {ti + 1}
                      </span>
                      <input
                        value={task.name}
                        aria-label={`${ti + 1}번 주요과업명`}
                        onChange={(e) => updateTask(ti, { name: e.target.value })}
                        className="min-h-11 min-w-0 flex-1 rounded-element border border-border px-3 text-sm font-semibold text-foreground outline-none focus:border-primary sm:min-h-control-md"
                        placeholder="주요과업명"
                      />
                      <RowActions
                        label={`${ti + 1}번 주요과업`}
                        onUp={() => moveTask(ti, -1)}
                        onDown={() => moveTask(ti, 1)}
                        onDelete={() => deleteTask(ti)}
                        upDisabled={ti === 0 || structureLocked}
                        downDisabled={ti === editTasks.length - 1 || structureLocked}
                        deleteDisabled={structureLocked}
                      />
                    </div>
                    <div className="mt-3 space-y-2 sm:pl-8">
                      {task.activities.map((act, ai) => (
                        <div key={act.uid} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-foreground-subtle">{ai + 1}.</span>
                          <input
                            value={act.activity_name}
                            aria-label={`${ti + 1}번 과업의 ${ai + 1}번 세부활동`}
                            onChange={(e) => updateActivity(ti, ai, e.target.value)}
                            className="min-h-11 min-w-0 flex-1 rounded-element border border-border px-3 text-sm text-foreground-muted outline-none focus:border-primary sm:min-h-control-md"
                            placeholder="세부활동"
                          />
                          <RowActions
                            label={`${ti + 1}번 과업의 ${ai + 1}번 세부활동`}
                            onUp={() => moveActivity(ti, ai, -1)}
                            onDown={() => moveActivity(ti, ai, 1)}
                            onDelete={() => deleteActivity(ti, ai)}
                            upDisabled={ai === 0 || structureLocked}
                            downDisabled={ai === task.activities.length - 1 || structureLocked}
                            deleteDisabled={structureLocked}
                          />
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addActivity(ti)}
                        disabled={structureLocked}
                        className="text-primary"
                      >
                        <Plus size={15} aria-hidden="true" /> 세부활동 추가
                      </Button>
                    </div>
                  </div>
                ))}
                <Button variant="secondary" onClick={addTask} disabled={structureLocked} className="border-dashed">
                  <Plus size={16} aria-hidden="true" /> 주요과업 추가
                </Button>
              </div>
            ) : detail.tasks.length === 0 ? (
              <EmptyMessage>등록된 주요과업 정보가 없습니다.</EmptyMessage>
            ) : (
              <div className="space-y-4">
                {detail.tasks.map((task, ti) => (
                  <div
                    key={task.id}
                    id={fieldId(`task-${task.id}`)}
                    tabIndex={-1}
                    className={`rounded-element border border-border p-5 ${highlightClass(`task-${task.id}`)}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
                        {ti + 1}
                      </span>
                      <h4 className="font-semibold text-foreground">{task.name}</h4>
                    </div>
                    {task.task_activities.length === 0 ? (
                      <p className="mt-3 pl-8 text-sm text-foreground-subtle">등록된 세부활동 정보가 없습니다.</p>
                    ) : (
                      <ul className="mt-3 space-y-2 pl-8">
                        {task.task_activities.map((act) => (
                          <li key={act.id} className="flex items-start gap-2 text-sm leading-6 text-foreground-muted">
                            <span
                              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle"
                              aria-hidden="true"
                            />
                            {act.activity_name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Section 4: 관련 Skill */}
          <Section title="4. 관련 Skill">
            {editMode ? (
              <div className="space-y-6">
                {(
                  [
                    ['역량 (Soft Skill)', 'Soft Skill'],
                    ['지식/기술 (Hard Skill)', 'Hard Skill'],
                  ] as const
                ).map(([label, type]) => (
                  <div key={type}>
                    <h4 className="mb-3 text-sm font-semibold text-foreground-muted">{label}</h4>
                    <div className="space-y-2">
                      {editSkills
                        .filter((s) => s.skill_type === type)
                        .map((s) => (
                          <div key={s.uid} className="flex flex-wrap items-center gap-2">
                            <input
                              id={s.id ? fieldId(`skill-${s.id}`) : undefined}
                              aria-label={`${label} 이름`}
                              value={s.name}
                              onChange={(e) => updateSkill(s.uid, e.target.value)}
                              className={`min-h-11 min-w-0 flex-1 rounded-element border border-border px-3 text-sm outline-none focus:border-primary sm:min-h-control-md ${
                                s.id ? highlightClass(`skill-${s.id}`) : ''
                              }`}
                              placeholder="Skill명"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${s.name || '이름 없는'} Skill 삭제`}
                              onClick={() => deleteSkill(s.uid)}
                              disabled={structureLocked}
                              className="ml-2 text-destructive hover:bg-destructive-muted"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addSkill(type)}
                        disabled={structureLocked}
                        className="text-primary"
                      >
                        <Plus size={15} aria-hidden="true" /> Skill 추가
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : detail.skills.length === 0 ? (
              <EmptyMessage>등록된 Skill 정보가 없습니다.</EmptyMessage>
            ) : (
              <div className="space-y-6">
                <SkillGroup
                  label="역량 (Soft Skill)"
                  skills={softSkills}
                  accent="teal"
                  highlightClass={highlightClass}
                />
                <SkillGroup
                  label="지식/기술 (Hard Skill)"
                  skills={hardSkills}
                  accent="navy"
                  highlightClass={highlightClass}
                />
              </div>
            )}
          </Section>

          {/* Section 5: 수행요건 */}
          <Section title="5. 수행요건">
            {(() => {
              const r = (editMode ? editReq : detail.requirements) as Record<string, string> | null;
              const hasAny = r && (r.education || r.major || r.certifications);
              if (!hasAny && !editMode) return <EmptyMessage>등록된 수행요건 정보가 없습니다.</EmptyMessage>;
              return (
                <div className="overflow-x-auto rounded-element border border-border">
                  <table className="w-full min-w-[24rem] text-sm">
                    <tbody>
                      {reqFields.map(([key, label, fkey], i) => (
                        <tr key={key} className={i > 0 ? 'border-t border-border' : ''}>
                          <th
                            scope="row"
                            className="w-40 bg-muted px-5 py-4 text-left text-xs font-medium text-foreground-muted"
                          >
                            {label}
                          </th>
                          <td className="px-5 py-4 text-foreground-muted">
                            {editMode ? (
                              <input
                                id={fieldId(fkey)}
                                aria-label={label}
                                value={editReq[key]}
                                onChange={(e) => {
                                  setEditReq((prev) => ({ ...prev, [key]: e.target.value }));
                                  setDirty(true);
                                }}
                                className={`min-h-11 w-full rounded-element border border-border px-3 text-sm text-foreground-muted outline-none focus:border-primary sm:min-h-control-md ${highlightClass(fkey)}`}
                                placeholder={label}
                              />
                            ) : (
                              <span id={fieldId(fkey)} tabIndex={-1} className={highlightClass(fkey)}>
                                {r?.[key] || <em className="text-foreground-subtle">등록된 정보 없음</em>}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Section>
        </div>

        <SmeFeedbackPanel
          data={feedback}
          loading={feedbackLoading}
          error={feedbackError}
          onRetry={loadFeedback}
          onFocusField={focusField}
          labelFor={labelFor}
          onRequestRereview={setRereviewTarget}
        />
      </div>

      {confirmState && (
        <ModalShell
          title={confirmState.title}
          description={confirmState.description}
          size="sm"
          icon={<AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />}
          onClose={() => setConfirmState(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmState(null)}>
                취소
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  confirmState.onConfirm();
                  setConfirmState(null);
                }}
              >
                {confirmState.confirmLabel}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-6 text-foreground-muted">
            되돌릴 수 없는 작업이에요. 내용을 한 번 더 확인해 주세요.
          </p>
        </ModalShell>
      )}

      {rereviewTarget && (
        <RereviewModal
          target={rereviewTarget}
          jobName={detail.name}
          onClose={() => setRereviewTarget(null)}
          onSubmit={submitRereview}
        />
      )}
    </>
  );
}

/* ── SME 피드백 패널 ───────────────────────────────────────────────── */

const SUIT_STYLE: Record<
  Exclude<SuitabilityLabel, ''> | 'none',
  { cls: string; Icon: typeof CheckCircle2; rank: number }
> = {
  부적합: { cls: 'border-destructive-border bg-destructive-muted text-destructive', Icon: XCircle, rank: 0 },
  '일부 수정 필요': { cls: 'border-warning-border bg-warning-muted text-warning', Icon: AlertTriangle, rank: 1 },
  적합: { cls: 'border-success-border bg-success-muted text-success', Icon: CheckCircle2, rank: 2 },
  none: { cls: 'border-border bg-muted text-foreground-muted', Icon: MessageSquare, rank: 3 },
};

const suitStyle = (label: SuitabilityLabel) => (label ? SUIT_STYLE[label] : SUIT_STYLE.none);

function formatWhen(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

interface PanelProps {
  data: SmeReviewFeedback[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onFocusField: (key: string) => void;
  labelFor: (key: string) => { kind: string; name: string };
  onRequestRereview: (review: SmeReviewFeedback) => void;
}

function SmeFeedbackPanel({ data, loading, error, onRetry, onFocusField, labelFor, onRequestRereview }: PanelProps) {
  return (
    <aside className="rounded-container border border-border bg-card p-5 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
      <div className="mb-4 flex items-center gap-2">
        <Users size={16} className="text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold text-[#182635]">SME 검토 의견</h3>
        {!loading && !error && data.length > 0 && (
          <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
            {data.length}명
          </span>
        )}
      </div>

      {loading && (
        <p className="flex items-center gap-2 py-6 text-sm text-foreground-subtle">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> 검토 의견을 불러오는 중이에요…
        </p>
      )}

      {!loading && error && (
        <div className="rounded-element border border-destructive-border bg-destructive-muted p-4">
          <p className="flex items-start gap-2 text-sm leading-6 text-destructive">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
            <RefreshCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <p className="rounded-element bg-muted px-4 py-8 text-center text-sm text-foreground-subtle">
          아직 제출된 검토가 없습니다.
        </p>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="space-y-4">
          {data.map((review) => (
            <ReviewCard
              key={review.review_id}
              review={review}
              onFocusField={onFocusField}
              labelFor={labelFor}
              onRequestRereview={onRequestRereview}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function ReviewCard({
  review,
  onFocusField,
  labelFor,
  onRequestRereview,
}: {
  review: SmeReviewFeedback;
  onFocusField: (key: string) => void;
  labelFor: (key: string) => { kind: string; name: string };
  onRequestRereview: (review: SmeReviewFeedback) => void;
}) {
  // 저장된 값 → 화면 라벨 변환은 reviewApi의 변환기를 그대로 쓴다.
  const items = Object.entries(toFeedbackState(review.feedback))
    .map(([key, f]) => ({ key, ...f }))
    .sort((a, b) => suitStyle(a.suitability).rank - suitStyle(b.suitability).rank);

  const when = formatWhen(review.submitted_at) || formatWhen(review.last_saved_at);
  const canRerequest = review.status === 'SUBMITTED' || review.status === 'RESUBMITTED';

  return (
    <article className="rounded-element border border-border p-4">
      <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-foreground">{review.sme_name || '이름 미등록'}</span>
        {review.organization && <span className="text-xs text-foreground-subtle">{review.organization}</span>}
        <StatusBadge status={mapReviewStatus(review.status)} />
        {when && <span className="w-full text-xs text-foreground-subtle">{when}</span>}
      </header>

      {items.length === 0 && review.feedback.newTasks.length === 0 && review.feedback.newSkills.length === 0 ? (
        <p className="text-sm text-foreground-subtle">항목별 의견 없이 제출했어요.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const { cls, Icon } = suitStyle(item.suitability);
            const { kind, name } = labelFor(item.key);
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onFocusField(item.key)}
                  className={`w-full rounded-element border p-3 text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${cls}`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon size={14} className="shrink-0" aria-hidden="true" />
                    {item.suitability || '의견'}
                    {item.remove && (
                      <span className="ml-1 rounded bg-black/10 px-1.5 py-0.5 text-[11px]">삭제 요청</span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-foreground-subtle">{kind}</span>
                  <span className="block text-sm font-medium text-foreground">{name}</span>
                  {item.comment && (
                    <span className="mt-1 block text-sm leading-6 text-foreground-muted">{item.comment}</span>
                  )}
                  {item.suggestion && (
                    <span className="mt-1 block text-sm leading-6 text-foreground-muted">
                      <span className="font-medium">제안</span> {item.suggestion}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SuggestionList title="새로 제안한 과업" items={review.feedback.newTasks} />
      <SuggestionList title="새로 제안한 Skill" items={review.feedback.newSkills} />

      {canRerequest && (
        <Button variant="secondary" size="sm" onClick={() => onRequestRereview(review)} className="mt-3 w-full">
          <RotateCcw size={14} aria-hidden="true" /> 재검토 요청
        </Button>
      )}
    </article>
  );
}

function SuggestionList({
  title,
  items,
}: {
  title: string;
  items: { name: string; description: string; reason: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <h5 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground-muted">
        <Plus size={13} aria-hidden="true" /> {title}
      </h5>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={`${s.name}-${i}`} className="rounded-element bg-muted px-3 py-2 text-sm">
            <span className="block font-medium text-foreground">{s.name}</span>
            {s.description && <span className="block text-foreground-muted">{s.description}</span>}
            {s.reason && <span className="block text-xs text-foreground-subtle">사유: {s.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RereviewModal({
  target,
  jobName,
  onClose,
  onSubmit,
}: {
  target: SmeReviewFeedback;
  jobName: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!note.trim()) {
      setError('SME가 무엇을 다시 봐야 하는지 알 수 있도록 사유를 적어 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(note.trim());
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '재검토를 요청하지 못했어요. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="재검토 요청"
      description={`${target.sme_name || 'SME'} 님에게 「${jobName}」 검토를 다시 요청합니다.`}
      size="md"
      dirty={note.trim().length > 0}
      closeDisabled={busy}
      icon={<RotateCcw size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} loading={busy}>
            재검토 요청
          </Button>
        </>
      }
    >
      <Field
        label="반려 사유"
        required
        error={error ?? undefined}
        description="여기에 적은 내용은 검토 이력에 남고, SME 화면에 그대로 보여요."
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={5}
          className="w-full rounded-element border border-border p-3 text-sm leading-6 text-foreground-muted outline-none focus:border-primary"
          placeholder="예) 3번 과업의 세부활동이 실제 업무와 달라 보여요. 담당하시는 범위 기준으로 다시 봐 주세요."
        />
      </Field>
    </ModalShell>
  );
}

/* ── 공용 조각 ─────────────────────────────────────────────────────── */

/** 순서 이동·삭제 묶음. 모바일 오탭이 곧 데이터 손실이라 삭제는 44px 타깃 + 간격을 둔다. */
function RowActions({
  label,
  onUp,
  onDown,
  onDelete,
  upDisabled,
  downDisabled,
  deleteDisabled,
}: {
  label: string;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
  upDisabled: boolean;
  downDisabled: boolean;
  /** 구조 편집 잠금(v2 F6) — 검토가 시작된 직무는 삭제를 막는다. */
  deleteDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" aria-label={`${label} 위로 이동`} onClick={onUp} disabled={upDisabled}>
        <ArrowUp size={15} aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="sm" aria-label={`${label} 아래로 이동`} onClick={onDown} disabled={downDisabled}>
        <ArrowDown size={15} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${label} 삭제`}
        onClick={onDelete}
        disabled={deleteDisabled}
        className="ml-2 text-destructive hover:bg-destructive-muted"
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-container border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-5 text-base font-bold text-[#182635]">{title}</h3>
      {children}
    </section>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-element bg-muted px-4 py-6 text-center text-sm text-foreground-subtle">{children}</p>;
}

function SkillGroup({
  label,
  skills,
  accent,
  highlightClass,
}: {
  label: string;
  skills: { id?: string; name: string }[];
  accent: 'teal' | 'navy';
  highlightClass: (key: string) => string;
}) {
  const chipClass =
    accent === 'teal'
      ? 'bg-primary-subtle text-primary border-primary-border'
      : 'bg-muted text-[#182635] border-border';
  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold text-foreground-muted">{label}</h4>
      {skills.length === 0 ? (
        <p className="text-sm text-foreground-subtle">등록된 {label}이 없습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {skills.map((s, i) => (
            <span
              key={s.id ?? `${s.name}-${i}`}
              id={s.id ? fieldId(`skill-${s.id}`) : undefined}
              tabIndex={s.id ? -1 : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${chipClass} ${s.id ? highlightClass(`skill-${s.id}`) : ''}`}
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
