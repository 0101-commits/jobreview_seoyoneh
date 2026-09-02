// 검토 워크벤치 — 비교 뷰(§6-3 ⓑ · 그림 6-B). /workbench/:jobId
//
// 같은 직무를 검토한 SME들의 응답을 나란히 놓고, 이견이 있는 행만 사유와 함께 하이라이트한다.
// 계산은 전부 src/lib/adminApi.ts의 computeJobSignals가 한다 — 이 화면은 임계값을 다시 판단하지 않는다
// (30%/20%p/3건은 src/lib/workshopThresholds.ts 한 곳에서만 산다. §11-2 Phase 3 제약).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, RotateCw, Users } from 'lucide-react';
import {
  decideReview,
  fetchJobComparison,
  fetchWorkshopFlag,
  type FteRow,
  type JobComparison,
  type ReviewDecision,
  type WorkshopFlag,
} from '@/lib/adminApi';
import { SIGNAL_LABELS, WORKSHOP_REASONS, WORKSHOP_THRESHOLDS } from '@/lib/workshopThresholds';
import { workshopDecisionOf } from '@/lib/workshopRules';
import { fetchJobHeader, mapReviewStatus, type JobListItem } from '@/lib/jobApi';
import { toSuitabilityLabel, type SmeReviewFeedback, type Suitability, type SuitabilityLabel } from '@/lib/reviewApi';
import { fteSuggestedNameChip } from '@/pages/sme-review/copy';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import { AutoTextarea } from '@/pages/sme-review/controls';
import { WorkshopFlagPanel } from '@/pages/workbench/WorkshopFlagPanel';

// ── 표시 헬퍼 ───────────────────────────────────────────────────────

/** 직무 항목 신호의 key는 'job:NAME'처럼 DB 섹션 코드를 담고 있다. 화면 문구로 바꾼다. */
const SECTION_LABEL: Record<string, string> = {
  NAME: '직무명',
  DEFINITION: '직무 정의',
  REQ_EDUCATION: '요구 학력',
  REQ_MAJOR: '요구 전공',
  REQ_CERTIFICATIONS: '요구 자격증',
};

const KIND_LABEL: Record<string, string> = { job: '직무 항목', task: '과업', skill: 'Skill' };

/** 0.00 같은 꼬리를 떼고 읽기 좋게. 25.5는 25.5로 남긴다(반올림으로 사유가 거짓이 되지 않게). */
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1))));

/** 그림 6-B의 "제출 09/24" 형식. */
function shortDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function fullDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** 그림 6-B의 열 머리: "SME A (영업1팀 · 책임) — 제출 09/24". 직급이 비어 있으면 조직만 적는다. */
function smeHeading(sme: SmeReviewFeedback): string {
  const who = [sme.organization || '조직 미등록', sme.title].filter(Boolean).join(' · ');
  const when = shortDate(sme.submitted_at);
  return `${sme.sme_name || '이름 미등록'} (${who})${when ? ` — 제출 ${when}` : ''}`;
}

/** 값이 빈 칸의 문구. 신규 제안 행은 "미제안", 확정 과업 행은 "미응답"이다(0%가 아니다). */
function emptyPctLabel(row: FteRow): string {
  return row.targetType === 'SUGGESTED' ? '－ 미제안' : '－ 미응답';
}

/** 하이라이트 사유. 색만으로 알리지 않기 위해 모든 하이라이트 행이 이 문구를 함께 단다. */
export function fteReason(row: FteRow): string {
  if (row.gapFlagged) return `비중 차 ${fmtNum(row.maxGap)}%p`;
  if (row.proposalMismatch) return SIGNAL_LABELS.newTaskMismatch;
  return '';
}

// ── 적합성 판정 불일치 행 ───────────────────────────────────────────

interface SuitRow {
  key: string;
  kind: string;
  name: string;
  /** reviewId → 판정 라벨. 빈 문자열이면 그 SME는 판정하지 않았다. */
  byReview: Record<string, SuitabilityLabel>;
}

/** 신호 key('job:NAME' · 'task:<id>' · 'skill:<id>')로 그 SME의 저장된 판정을 찾는다. */
function suitabilityOf(sme: SmeReviewFeedback | undefined, prefix: string, id: string): Suitability | null {
  if (!sme) return null;
  if (prefix === 'job') return sme.feedback.job.find((f) => f.section === id)?.suitability ?? null;
  if (prefix === 'task') return sme.feedback.tasks.find((f) => f.task_id === id)?.suitability ?? null;
  if (prefix === 'skill') return sme.feedback.skills.find((f) => f.skill_id === id)?.suitability ?? null;
  return null;
}

/**
 * 하이라이트 ① — 적합성 판정이 갈린 행만 모은다.
 * 어느 행이 갈렸는지는 adminApi가 이미 신호로 알려 준다. 여기서는 각 SME의 판정을 붙이기만 한다.
 */
export function buildSuitRows(cmp: JobComparison): SuitRow[] {
  const byReviewId = new Map(cmp.smes.map((s) => [s.review_id, s]));
  return cmp.signals
    .filter((s) => s.kind === 'SUITABILITY')
    .map((signal) => {
      const sep = signal.key.indexOf(':');
      const prefix = sep < 0 ? '' : signal.key.slice(0, sep);
      const id = sep < 0 ? signal.key : signal.key.slice(sep + 1);
      const byReview: Record<string, SuitabilityLabel> = {};
      for (const reviewId of cmp.comparedReviewIds) {
        byReview[reviewId] = toSuitabilityLabel(suitabilityOf(byReviewId.get(reviewId), prefix, id));
      }
      // 과업 이름은 adminApi가 풀어 준다. 직무 항목은 섹션 코드가 오고, Skill은 이름이 비어서 온다.
      const name =
        prefix === 'job' ? SECTION_LABEL[id] || signal.name : signal.name || `${KIND_LABEL[prefix] || '항목'} 항목`;
      return { key: signal.key, kind: KIND_LABEL[prefix] || '항목', name, byReview };
    });
}

// ── 화면 ────────────────────────────────────────────────────────────

export function JobComparePage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [comparison, setComparison] = useState<JobComparison | null>(null);
  const [job, setJob] = useState<JobListItem | null>(null);
  const [jobError, setJobError] = useState('');
  const [flag, setFlag] = useState<WorkshopFlag | null>(null);
  const [flagError, setFlagError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * 이 화면에서 방금 내린 판정. 판정 직후 재조회가 끝나기 전까지의 표시용이다.
   * 지난 판정은 조회가 함께 실어 온다(SmeReviewFeedback.approved_at·rejected_reason)
   * — 승인은 status를 바꾸지 않고 approved_at만 찍기 때문에 status만 보면 알 수 없다.
   */
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [rejectTarget, setRejectTarget] = useState<SmeReviewFeedback | null>(null);
  const [busyReviewId, setBusyReviewId] = useState('');
  const { toast, showToast, dismiss } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 세 조회는 서로를 기다릴 이유가 없다. 하나가 실패해도 나머지는 그대로 보여 준다
      // (adminApi가 예외 대신 ApiResult를 주는 이유가 이것이다).
      // v2 D3: 직무명 한 줄·플래그 한 줄을 단건으로 읽는다(예전에는 전 직무·전 플래그를 받아 하나를 골랐다).
      const [cmp, jobResult, flagResult] = await Promise.all([
        fetchJobComparison(jobId),
        fetchJobHeader(jobId),
        fetchWorkshopFlag(jobId),
      ]);
      if (cancelled) return;
      if (cmp.ok) {
        setComparison(cmp.data);
        setError('');
        // 방금 내린 판정을 여기서 버린다. 조회가 approved_at·rejected_reason을 실어 왔으니
        // 표시용 상태를 남겨 둘 이유가 없고, 남기면 그 뒤 재조회 결과가 영영 가려진다
        // (반려 → SME 재제출 → 조회는 RESUBMITTED인데 카드는 계속 '반려된 검토입니다').
        setDecisions({});
      } else {
        setComparison(null);
        setError(cmp.error);
      }
      if (jobResult.ok) {
        setJob(jobResult.data);
        setJobError('');
      } else {
        setJob(null);
        setJobError(jobResult.error);
      }
      // 저장된 결정이 없는 것(null)과 못 불러온 것을 구분한다 — 후자면 패널 대신 오류를 띄운다.
      if (flagResult.ok) {
        setFlag(flagResult.data);
        setFlagError('');
      } else {
        setFlag(null);
        setFlagError(flagResult.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, reloadKey]);

  const jobName = job?.name || (jobError ? '(직무명을 불러오지 못했습니다)' : '직무');

  /** 실패 사유를 그대로 돌려준다(''=성공). 반려 모달은 토스트가 가려지므로 이 문구를 안에 띄운다. */
  const decide = useCallback(
    async (sme: SmeReviewFeedback, verdict: 'APPROVED' | 'REJECTED', reason = ''): Promise<string> => {
      setBusyReviewId(sme.review_id);
      const result = await decideReview(sme.review_id, verdict, reason);
      setBusyReviewId('');
      if (!result.ok) {
        showToast({ type: 'error', msg: result.error });
        return result.error;
      }
      setDecisions((prev) => ({ ...prev, [sme.review_id]: result.data }));
      showToast({
        type: 'success',
        msg: `${sme.sme_name || 'SME'} 님의 검토를 ${verdict === 'APPROVED' ? '승인했습니다' : '반려했습니다'}.`,
      });
      // 서버가 최종 판정한다. 낙관적 갱신 대신 다시 읽어 화면과 DB를 맞춘다.
      setReloadKey((k) => k + 1);
      return '';
    },
    [showToast],
  );

  const suitRows = useMemo(() => (comparison ? buildSuitRows(comparison) : []), [comparison]);

  const compared = useMemo(() => {
    if (!comparison) return [] as SmeReviewFeedback[];
    const byReviewId = new Map(comparison.smes.map((s) => [s.review_id, s]));
    return comparison.comparedReviewIds
      .map((id) => byReviewId.get(id))
      .filter((s): s is SmeReviewFeedback => Boolean(s));
  }, [comparison]);

  const crossCheckImpossible =
    !!comparison && comparison.smeCount > 0 && comparison.smeCount < WORKSHOP_THRESHOLDS.minSmeForCrossCheck;
  // 후보 판정은 제출 큐 칸과 같은 함수로 한다. 사람이 해제한 직무(MANUAL_CLEARED)를 자동 규칙만 보고
  // 다시 '후보'로 적으면, 바로 아래 워크숍 패널의 '대상 아님 · 수동 결정'과 한 화면에서 모순된다.
  const workshopState = workshopDecisionOf(flag, comparison?.workshopReasons ?? []);
  const workshopCandidate = workshopState === 'FLAGGED' || workshopState === 'AUTO_PENDING';

  return (
    <>
      <Toast toast={toast} onDismiss={dismiss} />

      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-3">
            <ArrowLeft size={14} aria-hidden="true" /> 제출 큐로
          </Button>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            워크벤치 · {jobName} — SME 응답 비교
          </h2>
          {job && (
            <p className="mt-1 text-sm text-foreground-subtle">
              {job.group_name} · {job.series_name}
            </p>
          )}
        </div>
        {comparison && (
          <div className="flex flex-wrap items-center gap-2">
            {/* 그림 6-B 상단 칩: "이견 신호 2건 · 워크숍 후보".
                후보 여부는 저장된 결정과 자동 규칙을 함께 보되 사람이 해제한 직무는 후보로 적지 않는다
                — 제출 큐 칸과 같은 함수(workshopDecisionOf)로 판정한다. */}
            <span
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium ${
                comparison.signals.length > 0 || workshopCandidate
                  ? 'border-destructive-border bg-destructive-muted text-destructive'
                  : 'border-border bg-muted text-foreground-muted'
              }`}
            >
              <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
              이견 신호 {comparison.signals.length}건
              {workshopCandidate && ' · 워크숍 후보'}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RotateCw size={14} aria-hidden="true" /> 새로고침
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-5 flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>SME 응답 비교를 불러오지 못했어요. {error} 잠시 후 다시 시도해 주세요.</span>
          </p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
            <RotateCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      )}

      {loading && <Skeleton.Card count={2} />}

      {!loading && !error && comparison && (
        <div className="space-y-5">
          {/* 자동 규칙에 걸린 사유·기준·측정값은 아래 워크숍 패널이 규칙 ①~④로 풀어서 보여 준다.
              여기서 같은 말을 다시 적지 않는다(사유 문구의 출처는 workshopThresholds 한 곳이다). */}
          {comparison.smeCount === 0 ? (
            <p className="rounded-container border border-border bg-card p-8 text-center text-sm text-foreground-subtle">
              아직 제출된 검토가 없습니다. SME가 제출하면 응답을 나란히 비교할 수 있어요.
            </p>
          ) : crossCheckImpossible ? (
            <p className="flex flex-wrap items-start gap-2 border border-warning-border bg-warning-muted p-4 text-sm text-warning">
              <Users size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {/* "1명"을 손으로 적지 않는다 — 교차 확인 최소 인원은 §12에서 조정될 값이다. */}
              <span>
                교차 확인 불가 — 워크숍 후보. 제출한 SME가 {comparison.smeCount}명뿐이라 응답을 서로 비교할 수
                없습니다(교차 확인에는 {WORKSHOP_THRESHOLDS.minSmeForCrossCheck}명 이상 필요 · 자동 규칙{' '}
                {WORKSHOP_REASONS.singleSme}). 아래는 제출된 응답입니다.
              </span>
            </p>
          ) : null}

          {comparison.smeCount > 0 && (
            <>
              <SuitabilitySection rows={suitRows} smes={compared} />
              <FteSection comparison={comparison} smes={compared} />
              <SuggestionSection smes={compared} />
            </>
          )}

          <DecisionSection
            jobName={jobName}
            smes={comparison.smes}
            decisions={decisions}
            busyReviewId={busyReviewId}
            onApprove={(sme) => void decide(sme, 'APPROVED')}
            onReject={(sme) => setRejectTarget(sme)}
          />

          {flagError ? (
            <div className="flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  워크숍 대상 지정 상태를 불러오지 못했어요. {flagError} 지금 지정하면 이전 결정을 덮어쓸 수 있어
                  버튼을 감춥니다.
                </span>
              </p>
              <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
                <RotateCw size={14} aria-hidden="true" /> 다시 시도
              </Button>
            </div>
          ) : (
            <WorkshopFlagPanel
              jobId={jobId}
              jobName={job?.name}
              comparison={comparison}
              flag={flag}
              onSaved={() => setReloadKey((k) => k + 1)}
            />
          )}
        </div>
      )}

      {rejectTarget && (
        <RejectModal
          target={rejectTarget}
          jobName={jobName}
          busy={busyReviewId === rejectTarget.review_id}
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            const failure = await decide(rejectTarget, 'REJECTED', reason);
            if (!failure) setRejectTarget(null);
            return failure;
          }}
        />
      )}
    </>
  );
}

// ── ① 적합성 판정 불일치 ────────────────────────────────────────────

function SuitabilitySection({ rows, smes }: { rows: SuitRow[]; smes: SmeReviewFeedback[] }) {
  return (
    <section className="rounded-container border border-border bg-card shadow-1">
      <SectionHead
        title="적합성 판정 불일치"
        note={
          rows.length === 0
            ? '판정이 갈린 항목이 없습니다.'
            : `${rows.length}개 항목에서 SME들의 판정이 갈렸습니다. (${SIGNAL_LABELS.suitabilityMismatch})`
        }
      />
      {rows.length > 0 && (
        <>
          {/* 데스크톱 — 표. 첫 열 고정, 표 컨테이너 안에서만 가로 스크롤. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">항목별 SME 적합성 판정 비교</caption>
              <thead>
                <tr className="border-b border-border bg-muted text-xs text-foreground-muted">
                  <th scope="col" className="sticky left-0 z-10 bg-muted px-4 py-3 font-medium">
                    항목
                  </th>
                  {smes.map((sme) => (
                    <th key={sme.review_id} scope="col" className="px-4 py-3 font-medium">
                      {smeHeading(sme)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-destructive-border bg-destructive-muted last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-destructive-muted px-4 py-3 text-left font-normal">
                      <span className="block text-[11px] text-foreground-subtle">{row.kind}</span>
                      <span className="block font-medium text-foreground">{row.name}</span>
                      <ReasonChip text={SIGNAL_LABELS.suitabilityMismatch} tone="destructive" />
                    </th>
                    {smes.map((sme) => (
                      <td key={sme.review_id} className="px-4 py-3 text-foreground-muted">
                        {row.byReview[sme.review_id] || '판단 없음'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 390px — 표를 옆으로 밀지 않고 SME별로 세로로 쌓는다. */}
          <div className="divide-y divide-border sm:hidden">
            {smes.map((sme) => (
              <div key={sme.review_id} className="p-4">
                <p className="mb-2 text-sm font-semibold text-foreground">{smeHeading(sme)}</p>
                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.key} className="border border-destructive-border bg-destructive-muted p-3 text-sm">
                      <span className="block text-[11px] text-foreground-subtle">{row.kind}</span>
                      <span className="block font-medium text-foreground">{row.name}</span>
                      <span className="block text-foreground-muted">{row.byReview[sme.review_id] || '판단 없음'}</span>
                      <ReasonChip text={SIGNAL_LABELS.suitabilityMismatch} tone="destructive" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── ②③ FTE 비중 · 신규 제안 유무 (그림 6-B) ─────────────────────────

function FteSection({ comparison, smes }: { comparison: JobComparison; smes: SmeReviewFeedback[] }) {
  const rows = comparison.fteRows;

  /*
    과업 수정 제안명(v2 §5-3). SME 화면의 STEP 3 행 머리와 같은 문언을 여기에도 붙인다 —
    "어느 과업의 배분인지"가 양쪽에서 같은 말로 읽혀야 워크숍에서 헷갈리지 않는다.
    같은 과업에 SME마다 다른 제안명을 냈으면 모두 나열한다(그것 자체가 이견 정보다).
  */
  const suggestedNames = new Map<string, string[]>();
  for (const sme of smes) {
    for (const t of sme.feedback.tasks) {
      const name = t.suggestion.trim();
      if (!name) continue;
      const list = suggestedNames.get(`task:${t.task_id}`) ?? [];
      if (!list.includes(name)) list.push(name);
      suggestedNames.set(`task:${t.task_id}`, list);
    }
  }

  return (
    <section className="rounded-container border border-border bg-card shadow-1">
      <SectionHead
        title="과업별 투입 비중(FTE)"
        note={
          rows.length === 0
            ? '배분된 과업이 없습니다. SME가 STEP 3에서 비중을 입력하면 여기에 나타납니다.'
            : `비중 차가 ${WORKSHOP_THRESHOLDS.ftePointGap}%p 이상인 행과 한쪽만 제안한 과업을 하이라이트합니다.`
        }
      />

      {comparison.topTaskMismatch && (
        <p className="flex items-start gap-2 border-b border-warning-border bg-warning-muted px-4 py-3 text-sm text-warning">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>1위 과업 불일치 — SME마다 비중 1위 과업이 다릅니다. 각 열의 「1위」 표시를 확인해 주세요.</span>
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">과업별 SME 투입 비중 비교</caption>
              <thead>
                <tr className="border-b border-border bg-muted text-xs text-foreground-muted">
                  <th scope="col" className="sticky left-0 z-10 bg-muted px-4 py-3 font-medium">
                    과업
                  </th>
                  {smes.map((sme) => (
                    <th key={sme.review_id} scope="col" className="px-4 py-3 font-medium">
                      {smeHeading(sme)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const reason = fteReason(row);
                  const flagged = reason !== '';
                  return (
                    <tr
                      key={row.key}
                      className={`border-b border-border last:border-0 ${flagged ? 'bg-warning-muted' : ''}`}
                    >
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 px-4 py-3 text-left font-normal ${
                          flagged ? 'bg-warning-muted' : 'bg-card'
                        }`}
                      >
                        <span className="block font-medium text-foreground">{row.name}</span>
                        {row.targetType === 'SUGGESTED' && (
                          <span className="text-[11px] text-foreground-subtle">신규 제안</span>
                        )}
                        {(suggestedNames.get(row.key) ?? []).map((name) => (
                          <span key={name} className="block t-caption font-medium text-primary">
                            {fteSuggestedNameChip(name)}
                          </span>
                        ))}
                        {flagged && <ReasonChip text={reason} tone="warning" />}
                      </th>
                      {smes.map((sme) => (
                        <td key={sme.review_id} className="px-4 py-3 text-foreground-muted">
                          <PctCell
                            value={row.pct[sme.review_id] ?? null}
                            top={comparison.topTaskByReview[sme.review_id] === row.key}
                            emptyLabel={emptyPctLabel(row)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border sm:hidden">
            {smes.map((sme) => (
              <div key={sme.review_id} className="p-4">
                <p className="mb-2 text-sm font-semibold text-foreground">{smeHeading(sme)}</p>
                <ul className="space-y-2">
                  {rows.map((row) => {
                    const reason = fteReason(row);
                    return (
                      <li
                        key={row.key}
                        className={`flex flex-wrap items-center justify-between gap-2 border p-3 text-sm ${
                          reason ? 'border-warning-border bg-warning-muted' : 'border-border'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{row.name}</span>
                          {row.targetType === 'SUGGESTED' && (
                            <span className="text-[11px] text-foreground-subtle">신규 제안</span>
                          )}
                          {(suggestedNames.get(row.key) ?? []).map((name) => (
                            <span key={name} className="block t-caption font-medium text-primary">
                              {fteSuggestedNameChip(name)}
                            </span>
                          ))}
                          {reason && <ReasonChip text={reason} tone="warning" />}
                        </span>
                        <PctCell
                          value={row.pct[sme.review_id] ?? null}
                          top={comparison.topTaskByReview[sme.review_id] === row.key}
                          emptyLabel={emptyPctLabel(row)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 그림 6-B의 셀 — 값이 없으면 0%가 아니다.
 * 신규 제안 행이면 "그 SME는 제안하지 않았다"(－ 미제안),
 * 확정 과업 행이면 "그 SME가 FTE를 아직 내지 않았다"(－ 미응답)이다. 둘을 0%로 적으면 거짓이 된다.
 */
function PctCell({ value, top, emptyLabel }: { value: number | null; top: boolean; emptyLabel: string }) {
  if (value === null) return <span className="whitespace-nowrap text-foreground-subtle">{emptyLabel}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="font-medium text-foreground">{fmtNum(value)}%</span>
      {top && (
        <span className="rounded border border-primary-border bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
          1위
        </span>
      )}
    </span>
  );
}

// ── 신규 제안 원문 ──────────────────────────────────────────────────

function SuggestionSection({ smes }: { smes: SmeReviewFeedback[] }) {
  const any = smes.some((s) => s.feedback.newTasks.length > 0);
  if (!any) return null;
  return (
    <section className="rounded-container border border-border bg-card shadow-1">
      <SectionHead title="신규 제안 과업" note="제안한 SME가 적은 과업일수록 워크숍에서 확인할 값이 큽니다." />
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {smes.map((sme) => (
          <div key={sme.review_id}>
            <p className="mb-2 text-sm font-semibold text-foreground">{smeHeading(sme)}</p>
            {sme.feedback.newTasks.length === 0 ? (
              <p className="text-sm text-foreground-subtle">제안 없음</p>
            ) : (
              <ul className="space-y-2">
                {sme.feedback.newTasks.map((t, i) => (
                  <li key={`${t.name}-${i}`} className="bg-muted px-3 py-2 text-sm">
                    <span className="block font-medium text-foreground">{t.name}</span>
                    {t.description && <span className="block text-foreground-muted">{t.description}</span>}
                    {t.reason && <span className="block text-xs text-foreground-subtle">사유: {t.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 승인 / 반려 ─────────────────────────────────────────────────────

/**
 * 판정 대상은 "이 직무의 특정 SME 검토 1건"이다. 직무 전체가 아니다.
 * 그래서 SME마다 카드를 두고 카드 안에 대상 이름을 그대로 적는다.
 */
function DecisionSection({
  jobName,
  smes,
  decisions,
  busyReviewId,
  onApprove,
  onReject,
}: {
  jobName: string;
  smes: SmeReviewFeedback[];
  decisions: Record<string, ReviewDecision>;
  busyReviewId: string;
  onApprove: (sme: SmeReviewFeedback) => void;
  onReject: (sme: SmeReviewFeedback) => void;
}) {
  return (
    <section className="rounded-container border border-border bg-card shadow-1">
      <SectionHead
        title="승인 · 반려"
        note="SME 한 명의 검토 1건씩 판정합니다. 반려하면 그 SME 화면에 사유가 배너로 뜨고 해당 검토만 다시 열립니다."
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {smes.map((sme) => {
          // 방금 내린 판정 > 조회로 실어 온 지난 판정. 재조회가 끝나면 둘이 같은 값이 된다.
          const decision = decisions[sme.review_id];
          const status = decision?.status ?? sme.status;
          const approvedAt = decision ? decision.approvedAt : sme.approved_at;
          const rejectedReason = decision ? decision.rejectedReason : sme.rejected_reason;
          // 판정은 제출 상태에서만 한다(JobDetailPage의 재검토 요청과 같은 조건).
          // 반려된 검토는 SME 손에 돌아가 있으므로 재제출을 기다린다.
          const canDecide = status === 'SUBMITTED' || status === 'RESUBMITTED';
          const busy = busyReviewId === sme.review_id;

          return (
            <article key={sme.review_id} className="flex flex-col gap-2 border border-border p-4">
              <header className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{sme.sme_name || '이름 미등록'}</span>
                <span className="text-xs text-foreground-subtle">{sme.organization || '조직 미등록'}</span>
                <StatusBadge status={mapReviewStatus(status)} />
              </header>
              <p className="text-xs text-foreground-subtle">
                「{jobName}」 검토 1건 · {sme.submitted_at ? `제출 ${fullDate(sme.submitted_at)}` : '제출 전'}
              </p>

              {approvedAt && (
                <p className="flex items-center gap-1.5 border border-success-border bg-success-muted px-3 py-2 text-xs text-success">
                  <CheckCircle2 size={14} className="shrink-0" aria-hidden="true" />
                  승인 완료 {fullDate(approvedAt)}
                </p>
              )}
              {rejectedReason && (
                <p className="border border-destructive-border bg-destructive-muted px-3 py-2 text-xs text-destructive">
                  반려 사유: {rejectedReason}
                </p>
              )}

              {canDecide ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button size="sm" loading={busy} onClick={() => onApprove(sme)}>
                    승인
                  </Button>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => onReject(sme)}>
                    반려 (사유 필수)
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-foreground-subtle">
                  {status === 'REVIEW_REQUESTED'
                    ? '반려된 검토입니다. SME가 다시 제출하면 판정할 수 있습니다.'
                    : '아직 제출 전이라 판정할 수 없습니다.'}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RejectModal({
  target,
  jobName,
  busy,
  onClose,
  onSubmit,
}: {
  target: SmeReviewFeedback;
  jobName: string;
  busy: boolean;
  onClose: () => void;
  /** 실패 사유('' = 성공). 모달이 토스트를 가리므로 사유를 이 안에서 보여 준다. */
  onSubmit: (reason: string) => Promise<string>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    if (!reason.trim()) {
      // 서버(decide_review)도 같은 조건을 다시 본다. 여기서 먼저 막는 건 같은 문구를 즉시 보여 주기 위해서다.
      setError('반려 사유를 입력해 주세요. SME가 무엇을 고쳐야 하는지 알 수 없습니다.');
      return;
    }
    setError('');
    setError(await onSubmit(reason.trim()));
  }

  return (
    <ModalShell
      title="검토 반려"
      description={`${target.sme_name || 'SME'} 님의 「${jobName}」 검토 1건을 반려합니다.`}
      size="md"
      dirty={reason.trim().length > 0}
      closeDisabled={busy}
      icon={<AlertTriangle size={20} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            반려
          </Button>
        </>
      }
    >
      <Field
        label="반려 사유"
        required
        error={error || undefined}
        description="여기에 적은 내용은 SME 화면에 그대로 보이고 검토 이력에 남습니다."
      >
        <AutoTextarea
          value={reason}
          onChange={setReason}
          minRows={4}
          disabled={busy}
          placeholder="예) 3번 과업의 투입 비중이 실제 업무와 달라 보여요. 담당 범위 기준으로 다시 봐 주세요."
        />
      </Field>
    </ModalShell>
  );
}

// ── 공용 조각 ───────────────────────────────────────────────────────

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-b border-border p-4">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-foreground-muted">{note}</p>
    </div>
  );
}

/** 하이라이트한 행에는 반드시 사유 문구가 함께 붙는다(색만으로 알리지 않기). */
function ReasonChip({ text, tone }: { text: string; tone: 'warning' | 'destructive' }) {
  const cls =
    tone === 'warning'
      ? 'border-warning-border bg-warning-muted text-warning'
      : 'border-destructive-border bg-destructive-muted text-destructive';
  return (
    <span className={`mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />
      {text}
    </span>
  );
}

export default JobComparePage;
