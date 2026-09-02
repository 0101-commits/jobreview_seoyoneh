// SME 배정 관리 — 관리자(ADMIN) 화면. 직무별로 누가 배정되어 있는지 보고, 더하거나 내린다.
//
// 이 화면의 존재 이유는 R6 하나다. sync_sme_assignments가 SME 계정을 만들 때마다 그 회사의
// 활성 직무 전부를 배정하므로, 진행 현황(/progress)은 "직무별 3명 이상"이라는 위반을 보여 주기만 할 뿐
// 고칠 수 없었다(docs/OPEN_ISSUES.md 이슈 3). 고치는 쪽이 여기다.
//
// 조회·판정·쓰기는 전부 src/lib/assignmentApi.ts가 한다. 이 파일은 그리기만 한다.
// R6 판정(r6Of)과 상태 라벨(CELL_STATUS_LABELS)은 진행 현황 화면이 쓰는 것을 그대로 가져다 쓴다 —
// 여기서 다시 적으면 두 화면이 같은 직무를 놓고 서로 다른 말을 하게 된다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Lock,
  PenLine,
  RotateCw,
  Send,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react';
import {
  addAssignment,
  deactivateAssignment,
  fetchAssignments,
  type AssignedSme,
  type AssignmentBoard,
  type JobAssignmentRow,
} from '@/lib/assignmentApi';
import { CELL_STATUS_LABELS, type CellStatus } from '@/lib/adminApi';
import { r6Of } from '@/pages/ProgressMatrixPage';
import { fetchCompaniesResult } from '@/lib/jobApi';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';

// ── 표시용 상수 ─────────────────────────────────────────────────────

/**
 * 검토 상태 표시. 색만으로 알리지 않도록 아이콘·한국어 라벨을 항상 함께 그린다(§8 S8).
 * 라벨은 adminApi의 CELL_STATUS_LABELS를 쓰고, 색·아이콘만 여기서 고른다.
 */
const STATUS_STYLE: Record<CellStatus, { chip: string; Icon: typeof Circle }> = {
  NOT_STARTED: { chip: 'border-border bg-muted text-foreground-muted', Icon: Circle },
  IN_PROGRESS: { chip: 'border-warning-border bg-warning-muted text-warning', Icon: PenLine },
  SUBMITTED: { chip: 'border-primary-border bg-primary-subtle text-primary', Icon: Send },
  APPROVED: { chip: 'border-success-border bg-success-muted text-success', Icon: CheckCircle2 },
  REJECTED: { chip: 'border-destructive-border bg-destructive-muted text-destructive', Icon: XCircle },
};

/**
 * R6 배지 — 0명=미배정 / 1~2명=적정 / 3명 이상=과다.
 * 위반 여부(violation)는 진행 현황의 r6Of가 정한다. 이 함수는 거기에 라벨·색만 입힌다.
 */
function r6BadgeOf(count: number): { label: string; violation: boolean; chip: string; Icon: typeof Circle } {
  const { violation } = r6Of(count);
  if (count === 0)
    return {
      label: '미배정',
      violation,
      chip: 'border-destructive-border bg-destructive-muted text-destructive',
      Icon: AlertTriangle,
    };
  if (count > 2)
    return { label: '과다', violation, chip: 'border-warning-border bg-warning-muted text-warning', Icon: AlertTriangle };
  return { label: '적정', violation, chip: 'border-success-border bg-success-muted text-success', Icon: CheckCircle2 };
}

/** 'YYYY-MM-DD HH:mm' 대신 짧게. 값을 못 읽으면 빈 문자열(추측한 날짜를 보여 주지 않는다). */
function shortDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR');
}

const personLine = (sme: { organization: string; title: string }) =>
  [sme.organization, sme.title].filter(Boolean).join(' · ');

// ── 화면 ────────────────────────────────────────────────────────────

export function AssignmentAdminPage({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyError, setCompanyError] = useState('');
  const [onlyViolation, setOnlyViolation] = useState(false);
  /** 한 번에 한 직무만 펼친다 — 펼친 칸에 검색·선택 상태가 붙어 있어 여러 개를 동시에 열면 헷갈린다. */
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [smeQuery, setSmeQuery] = useState('');
  const [pickedSmeId, setPickedSmeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ job: JobAssignmentRow; sme: AssignedSme } | null>(null);
  const { toast, showToast, dismiss } = useToast();

  const companyId = companyFilter === 'all' ? null : companyFilter;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchCompaniesResult();
      if (cancelled) return;
      if (result.ok) {
        setCompanies(result.data);
        setCompanyError('');
      } else {
        setCompanies([]);
        setCompanyError(`회사 목록을 불러오지 못했어요. ${result.error}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      const result = await fetchAssignments(companyId);
      if (cancelled) return;
      if (result.ok) {
        setBoard(result.data);
        setError('');
      } else {
        // 조회 실패를 '0건'으로 보여 주지 않는다 — 목록을 비우고 오류 상태로 간다.
        setBoard(null);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadKey]);

  /** 계열사를 바꾸면 펼쳐 둔 직무와 고르던 SME는 다른 회사 것이 된다. 함께 접는다. */
  useEffect(() => {
    setOpenJobId(null);
    setSmeQuery('');
    setPickedSmeId('');
  }, [companyId]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const counts = useMemo(() => {
    const jobs = board?.jobs ?? [];
    let fit = 0;
    let none = 0;
    let over = 0;
    for (const job of jobs) {
      if (job.smes.length === 0) none += 1;
      else if (job.smes.length > 2) over += 1;
      else fit += 1;
    }
    return { total: jobs.length, fit, none, over };
  }, [board]);

  const visibleJobs = useMemo(() => {
    const jobs = board?.jobs ?? [];
    return onlyViolation ? jobs.filter((job) => r6Of(job.smes.length).violation) : jobs;
  }, [board, onlyViolation]);

  const openJob = useMemo(
    () => (board?.jobs ?? []).find((job) => job.jobId === openJobId) ?? null,
    [board, openJobId],
  );

  /**
   * 추가 후보 — 이미 배정된 사람과 다른 계열사 사람을 뺀다.
   * 회사가 지정된 직무에는 회사가 비어 있는 SME도 넣지 않는다. sync_sme_assignments가 회사를
   * 기준으로 배정을 정리하므로, 회사 없는 계정을 붙이면 다음 동기화에서 조용히 지워진다.
   */
  const candidates = useMemo(() => {
    if (!board || !openJob) return [];
    const assigned = new Set(openJob.smes.map((s) => s.smeId));
    const q = smeQuery.trim();
    return board.smes.filter(
      (s) =>
        !assigned.has(s.id) &&
        (!openJob.companyId || s.companyId === openJob.companyId) &&
        (q === '' || s.name.includes(q) || s.organization.includes(q)),
    );
  }, [board, openJob, smeQuery]);

  /** 검색어를 좁혀 고른 사람이 목록에서 빠지면 선택도 함께 푼다(보이지 않는 사람이 배정되지 않게). */
  useEffect(() => {
    if (pickedSmeId && !candidates.some((c) => c.id === pickedSmeId)) setPickedSmeId('');
  }, [candidates, pickedSmeId]);

  const toggleJob = (jobId: string) => {
    setOpenJobId((prev) => (prev === jobId ? null : jobId));
    setSmeQuery('');
    setPickedSmeId('');
  };

  const onAdd = async () => {
    if (!openJob || !pickedSmeId) return;
    const picked = candidates.find((c) => c.id === pickedSmeId);
    setBusy(true);
    const result = await addAssignment(pickedSmeId, openJob.jobId);
    setBusy(false);
    if (!result.ok) {
      showToast({ type: 'error', msg: result.error, duration: 0 });
      return;
    }
    showToast({
      type: 'success',
      msg: `${picked?.name ?? 'SME'} 님을 「${openJob.jobName}」에 배정했습니다.`,
    });
    setSmeQuery('');
    setPickedSmeId('');
    reload();
  };

  const runDeactivate = async (job: JobAssignmentRow, sme: AssignedSme) => {
    setBusy(true);
    const result = await deactivateAssignment(sme.assignmentId);
    setBusy(false);
    setConfirmTarget(null);
    if (!result.ok) {
      showToast({ type: 'error', msg: result.error, duration: 0 });
      return;
    }
    showToast({
      type: 'success',
      msg: `${sme.name} 님의 「${job.jobName}」 배정을 해제했습니다. 응답 데이터는 지워지지 않았습니다.`,
    });
    reload();
  };

  const onDeactivateClick = (job: JobAssignmentRow, sme: AssignedSme) => {
    if (sme.guard.blocked) return; // 버튼이 이미 잠겨 있다. 사유는 목록에 적혀 있다.
    if (sme.guard.warning) {
      setConfirmTarget({ job, sme });
      return;
    }
    runDeactivate(job, sme);
  };

  const ready = !loading && !error && board !== null;

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            {loading
              ? '불러오는 중…'
              : error
                ? '조회 실패'
                : `직무 ${counts.total}개 · 적정 ${counts.fit} · 미배정 ${counts.none} · 과다 ${counts.over}`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">SME 배정 관리</h2>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        </div>
      </div>

      {/* R6 근거 — 착수보고 원문. 이 화면의 판정 기준이 어디서 왔는지 항상 보이게 고정한다. */}
      <p className="mb-3 flex items-start gap-2 border border-border bg-muted p-3 text-xs leading-5 text-foreground-muted">
        <BookOpen size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <b className="font-semibold text-foreground">R6 · 착수보고 7·12면</b> — &ldquo;업무 조사는 직무별 최소
          인원의 업무전문가(SME, 1~2명)를 대상으로 운영&rdquo;
        </span>
      </p>

      <div className="mb-5 border border-warning-border bg-warning-muted p-4 text-sm leading-6 text-warning">
        <p className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <b className="font-semibold">
              SME 계정을 새로 만들면 그 회사의 활성 직무가 전부 자동으로 배정됩니다
            </b>
            (sync_sme_assignments). 「과다」로 표시되는 직무는 대개 그 때문입니다 — 담당이 아닌 배정을 이 화면에서
            해제해 직무마다 1~2명으로 정리해 주세요. 해제는 삭제가 아니라 배정을 내려 두는 것이라 이미 저장된
            응답은 데이터베이스에 남지만, SME 화면·진행 현황·산출물(E1·E2)에서는 함께 빠집니다.
          </span>
        </p>
      </div>

      {companyError && (
        <p role="alert" className="mb-5 border border-border bg-muted p-3 text-xs leading-5 text-foreground-muted">
          {companyError} 계열사 필터가 비어 있어도 아래 목록은 현재 범위로 조회됩니다.
        </p>
      )}

      {error && (
        <div className="mb-5 flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>배정 현황을 불러오지 못했어요. {error} 잠시 후 다시 시도해 주세요.</span>
          </p>
          <Button variant="secondary" size="sm" onClick={reload} className="shrink-0">
            <RotateCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      )}

      <Toast toast={toast} onDismiss={dismiss} />

      <div className="border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="배정 인원 필터">
            {[
              { on: false, label: '전체', count: counts.total },
              { on: true, label: 'R6 위반만 (0명 · 3명 이상)', count: counts.none + counts.over },
            ].map((f) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={onlyViolation === f.on}
                onClick={() => setOnlyViolation(f.on)}
                className={`min-h-11 rounded-element border px-3 text-xs font-medium transition sm:min-h-control-sm ${
                  onlyViolation === f.on
                    ? 'border-primary bg-primary-subtle text-primary'
                    : 'border-border bg-card text-foreground-muted hover:border-primary hover:text-primary'
                }`}
              >
                {f.label} {ready ? f.count : ''}
              </button>
            ))}
          </div>
          <p className="text-xs text-foreground-subtle">직무를 누르면 SME를 추가하거나 해제할 수 있습니다.</p>
        </div>

        {loading ? (
          <p className="px-4 py-12 text-center text-sm text-foreground-subtle">불러오는 중…</p>
        ) : error ? (
          <p className="px-4 py-12 text-center text-sm text-destructive">
            배정 현황을 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요.
          </p>
        ) : counts.total === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-foreground-subtle">
            등록된 활성 직무가 없습니다. 「직무정보 업로드」에서 직무를 먼저 등록해 주세요.
          </p>
        ) : visibleJobs.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-foreground-subtle">
            R6(직무별 1~2명)에 어긋나는 직무가 없습니다. 필터를 「전체」로 바꾸면 모든 직무를 볼 수 있습니다.
          </p>
        ) : (
          <ul>
            {visibleJobs.map((job) => {
              const badge = r6BadgeOf(job.smes.length);
              const open = openJobId === job.jobId;
              const panelId = `assign-panel-${job.jobId}`;
              return (
                <li key={job.jobId} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    onClick={() => toggleJob(job.jobId)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex w-full min-h-11 flex-col gap-2 px-4 py-3 text-left transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {open ? (
                        <ChevronDown size={16} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
                      ) : (
                        <ChevronRight size={16} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
                      )}
                      <span className="text-sm font-medium text-foreground">{job.jobName}</span>
                      <span className="text-xs text-foreground-subtle">
                        {[job.groupName, job.seriesName, job.companyName].filter(Boolean).join(' · ')}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-element border px-2 py-0.5 text-[11px] font-medium ${badge.chip}`}
                      >
                        <badge.Icon size={11} className="shrink-0" aria-hidden="true" />
                        {badge.label} · SME {job.smes.length}명
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5 pl-6">
                      {job.smes.length === 0 ? (
                        <span className="text-xs text-foreground-muted">배정된 SME가 없습니다</span>
                      ) : (
                        job.smes.map((sme) => {
                          const statusStyle = STATUS_STYLE[sme.status];
                          return (
                            <span
                              key={sme.assignmentId}
                              className={`inline-flex items-center gap-1 rounded-element border px-2 py-0.5 text-[11px] ${statusStyle.chip}`}
                            >
                              <statusStyle.Icon size={11} className="shrink-0" aria-hidden="true" />
                              {sme.name} · {CELL_STATUS_LABELS[sme.status]}
                            </span>
                          );
                        })
                      )}
                    </span>
                  </button>

                  {open && (
                    <div id={panelId} className="border-t border-border bg-muted p-4">
                      <h3 className="text-xs font-semibold text-foreground-muted">
                        배정된 SME {job.smes.length}명
                      </h3>
                      {job.smes.length === 0 ? (
                        <p className="mt-2 text-sm text-foreground-muted">
                          아직 배정된 SME가 없습니다. 아래에서 담당 SME를 1~2명 배정해 주세요.
                        </p>
                      ) : (
                        <ul className="mt-2 flex flex-col gap-2">
                          {job.smes.map((sme) => {
                            const statusStyle = STATUS_STYLE[sme.status];
                            const reasonId = `assign-reason-${sme.assignmentId}`;
                            return (
                              <li
                                key={sme.assignmentId}
                                className="flex flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-start sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm text-foreground">
                                    <b className="font-medium">{sme.name}</b>
                                    {personLine(sme) && (
                                      <span className="text-foreground-subtle"> · {personLine(sme)}</span>
                                    )}
                                  </p>
                                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-foreground-muted">
                                    <statusStyle.Icon size={12} className="shrink-0" aria-hidden="true" />
                                    <span>{CELL_STATUS_LABELS[sme.status]}</span>
                                    {sme.submittedAt && <span>· 제출 {shortDate(sme.submittedAt)}</span>}
                                    {!sme.submittedAt && sme.lastSavedAt && (
                                      <span>· 최종 저장 {shortDate(sme.lastSavedAt)}</span>
                                    )}
                                  </p>
                                  {sme.guard.blocked && (
                                    <p
                                      id={reasonId}
                                      className="mt-2 flex items-start gap-1.5 border border-warning-border bg-warning-muted p-2 text-xs leading-5 text-warning"
                                    >
                                      <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                      <span>{sme.guard.blocked}</span>
                                    </p>
                                  )}
                                </div>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  className="shrink-0"
                                  disabled={!!sme.guard.blocked || busy}
                                  aria-describedby={sme.guard.blocked ? reasonId : undefined}
                                  onClick={() => onDeactivateClick(job, sme)}
                                >
                                  <UserMinus size={14} aria-hidden="true" /> 배정 해제
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <div className="mt-4 border-t border-border pt-4">
                        <h3 className="text-xs font-semibold text-foreground-muted">SME 추가</h3>
                        {job.smes.length >= 2 && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-warning">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>이미 {job.smes.length}명이 배정되어 있습니다. 더 추가하면 R6(1~2명)을 넘습니다.</span>
                          </p>
                        )}
                        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
                          <div className="sm:w-56">
                            <Field
                              label="SME 검색"
                              value={smeQuery}
                              onChange={setSmeQuery}
                              placeholder="이름 또는 소속 조직"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <Field label="배정할 SME">
                              {(a11y) => (
                                <select
                                  {...a11y}
                                  className="input"
                                  value={pickedSmeId}
                                  disabled={candidates.length === 0}
                                  onChange={(e) => setPickedSmeId(e.target.value)}
                                >
                                  <option value="">선택해 주세요</option>
                                  {candidates.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {[c.name, c.organization, c.title].filter(Boolean).join(' · ')}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </Field>
                          </div>
                          <Button onClick={onAdd} disabled={!pickedSmeId} loading={busy} className="shrink-0">
                            <UserPlus size={14} aria-hidden="true" /> 배정 추가
                          </Button>
                        </div>
                        {candidates.length === 0 && (
                          <p className="mt-2 text-xs leading-5 text-foreground-muted">
                            {smeQuery.trim()
                              ? '검색어에 맞는 SME가 없습니다. 검색어를 지우고 다시 골라 주세요.'
                              : '추가할 수 있는 SME가 없습니다. 이 회사의 활성 SME가 모두 이 직무에 배정되어 있거나, 「SME 계정 관리」에 등록된 계정이 없습니다.'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmTarget && (
        <ModalShell
          title="배정을 해제할까요?"
          size="sm"
          onClose={() => setConfirmTarget(null)}
          closeDisabled={busy}
          icon={<AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />}
          description={`${confirmTarget.sme.name} 님 · ${confirmTarget.job.jobName}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmTarget(null)} disabled={busy}>
                취소
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => runDeactivate(confirmTarget.job, confirmTarget.sme)}
              >
                배정 해제
              </Button>
            </>
          }
        >
          <p className="text-sm leading-6 text-foreground-muted">{confirmTarget.sme.guard.warning}</p>
          <p className="mt-3 text-sm leading-6 text-foreground-muted">
            해제는 삭제가 아닙니다. 배정만 내려 두므로 이미 저장된 응답은 데이터베이스에 남고, 다시 배정하면 이어서
            작성할 수 있습니다.
          </p>
        </ModalShell>
      )}
    </>
  );
}

export default AssignmentAdminPage;
