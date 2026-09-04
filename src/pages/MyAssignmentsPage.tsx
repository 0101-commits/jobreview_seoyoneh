// 내 검토 목록 — SME 홈. 관리자가 나에게 배정한 직무만 보여 준다.
// 회사 전체 직무를 훑어 첫 번째를 임의로 고르던 자리를 대신한다.
//
// v2 §6-5: 카드가 상태만 말하던 자리를 v1.0 §5-3 명세대로 채웠다(U4·F7).
//  · 마감 D-day(survey_settings.due_date) · 단계 진행(ProgressTracker) · 이어하기 → STEP n
//  · 이어하기 단계는 서버(reviews.last_step)에서 읽는다 — 다른 기기에서도 그대로 이어진다.
//  · 마감이 지난 미제출은 카드 위에 한 줄 안내(cautionary)를 둔다.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { fetchMyAssignments, type MyAssignment } from '@/lib/reviewApi';
import { fetchSurveySettings } from '@/lib/surveyApi';
import { mapReviewStatus } from '@/lib/jobApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TermHint } from '@/components/ui/TermHint';
import { Button } from '@/components/ui/Button';
import { FallbackView } from '@/components/ui/FallbackView';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressTracker } from '@/components/ui/ProgressTracker';
import { SectionMessage } from '@/components/ui/SectionMessage';
import { Skeleton } from '@/components/ui/Skeleton';
import { STEP_LABELS } from '@/pages/sme-review/copy';
import type { User } from '@/types';

function formatSavedAt(value: string | null) {
  if (!value) return '아직 저장한 내용이 없습니다';
  return `마지막 저장 ${new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/** 마감까지 남은 날. 오늘이면 0, 지났으면 음수. 시각은 버리고 날짜만 센다. */
function daysUntil(due: string): number {
  const today = new Date();
  const target = new Date(due);
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const dDayText = (d: number) => (d === 0 ? '오늘 마감' : d > 0 ? `마감 D-${d}` : `마감 ${-d}일 지남`);

const SUBMITTED = new Set(['SUBMITTED', 'RESUBMITTED']);

export function MyAssignmentsPage({ user }: { user: User }) {
  const [rows, setRows] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 회사 마감일. 설정이 없거나 조회에 실패하면 null이고, 그때는 D-day를 아예 그리지 않는다. */
  const [dueDate, setDueDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await fetchMyAssignments(user.id));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : '배정된 직무를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 마감일은 부가 정보다 — 실패해도 목록은 그대로 열린다(사유는 콘솔에만 남긴다).
  useEffect(() => {
    if (!user.company_id) return;
    let cancelled = false;
    fetchSurveySettings(user.company_id)
      .then((settings) => {
        if (!cancelled) setDueDate(settings?.due_date ?? null);
      })
      .catch((e) => console.warn('[MyAssignmentsPage] 마감일 조회 실패 — D-day 표기만 생략한다.', e));
    return () => {
      cancelled = true;
    };
  }, [user.company_id]);

  const dDay = dueDate ? daysUntil(dueDate) : null;
  const overdueCount = dDay !== null && dDay < 0 ? rows.filter((r) => !SUBMITTED.has(r.status)).length : 0;

  return (
    <>
      <PageHeader
        eyebrow={`나에게 배정된 직무${user.company_name ? ` · ${user.company_name}` : ''}`}
        title="내 검토 목록"
        trailing={
          dDay !== null && (
            <span
              className={`rounded-element px-3 py-2 t-label font-medium ${
                dDay < 0 ? 'bg-destructive-muted text-destructive' : 'bg-primary-subtle text-primary'
              }`}
            >
              {dDayText(dDay)} · {new Date(dueDate as string).toLocaleDateString('ko-KR', { dateStyle: 'medium' })}
            </span>
          )
        }
      />

      {overdueCount > 0 && (
        <SectionMessage variant="cautionary" className="mb-5">
          마감일이 지났습니다. 아직 제출하지 않으신 직무가 {overdueCount}건 있습니다. 늦더라도 제출하시면 반영됩니다.
        </SectionMessage>
      )}

      {loading ? (
        <Skeleton.Card count={2} />
      ) : error ? (
        <FallbackView
          kind="error"
          heading="배정된 직무를 불러오지 못했습니다"
          description="네트워크 상태를 확인한 뒤 다시 시도해 주세요. 계속 실패하면 관리자에게 문의해 주세요."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              다시 시도
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <FallbackView
          heading="배정된 직무가 없습니다"
          description="관리자가 직무를 배정하면 여기에 나타나요. 오래 비어 있으면 관리자에게 문의해 주세요."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const submitted = SUBMITTED.has(r.status);
            // 제출한 검토는 어디까지 봤든 결과를 보는 자리라 1단계부터 연다.
            const resumeStep = submitted ? 1 : Math.min(5, Math.max(1, r.last_step ?? 1));
            const resumeLabel = submitted ? '제출 내용 보기' : r.last_step ? `이어하기 → STEP ${resumeStep}` : '검토 시작';
            return (
              <li key={r.assignment_id} className="rounded-container border border-border bg-card p-5 shadow-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground">{r.job_name}</h3>
                      <StatusBadge status={mapReviewStatus(r.status)} />
                      <TermHint id="review-status" />
                    </div>
                    <p className="mt-1 truncate t-label text-foreground-muted">
                      {r.group_name} · {r.series_name}
                    </p>
                    <p className="mt-1 t-caption text-foreground-subtle">{formatSavedAt(r.last_saved_at)}</p>
                  </div>
                  <Link
                    to={`/review/${r.job_id}?step=${resumeStep}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-element bg-primary px-4 t-label font-medium text-primary-foreground transition hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {resumeLabel}
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                </div>

                {/* 단계 진행 — 표시 전용이다. 단계 이동은 검토 화면 안에서만 한다(게이트가 거기 있다). */}
                <ProgressTracker
                  className="mt-4"
                  label={`${r.job_name} 단계 진행`}
                  current={resumeStep}
                  items={STEP_LABELS.map((label, i) => ({
                    step: i + 1,
                    label,
                    complete: submitted || i + 1 < resumeStep,
                  }))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
