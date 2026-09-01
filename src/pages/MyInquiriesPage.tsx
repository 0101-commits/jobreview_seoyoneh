// 내 문의(/inquiries) — SME 화면. 내가 남긴 문의와 관리자 답변을 최신순으로 본다(§5-3 · §6-3ⓒ).
//
// 작성은 검토 화면의 문의 버튼(src/pages/sme-review/inquiry.tsx)이 담당하고, 이 화면은 읽기 전용이다.
// SME 화면 상단에 붙일 배너 두 개도 이 파일에서 함께 내보낸다 — 배치는 통합 담당이 한다.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Inbox, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { fetchReviewStatusResult } from '@/lib/jobApi';
import { fetchMyInquiries, type Inquiry, type InquiryStatus } from '@/lib/surveyApi';
import { STEP_TITLES } from '@/pages/sme-review/copy';
import type { User } from '@/types';

// ── 상태 표기 ───────────────────────────────────────────────────────
//
// shared/StatusBadge.tsx는 재사용하지 않는다. 그쪽은 검토 상태(미시작·작성 중·제출 완료…)에
// 타입까지 묶여 있어 문의 상태(§6-3ⓒ의 미답·답변·종결) 세 값이 아예 들어가지 않는다.
// 대신 같은 모양(rounded·11px·굵기)과 같은 원칙(색만으로 알리지 않기 — 아이콘 병기)을 따른다.
const STATUS_VIEW: Record<InquiryStatus, { label: string; className: string; Icon: typeof Clock }> = {
  OPEN: { label: '미답', className: 'bg-amber-50 text-amber-700', Icon: Clock },
  ANSWERED: { label: '답변', className: 'bg-emerald-50 text-emerald-700', Icon: MessageSquareText },
  CLOSED: { label: '종결', className: 'bg-slate-100 text-slate-600', Icon: CheckCircle2 },
};

function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  const { label, className, Icon } = STATUS_VIEW[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium ${className}`}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

function formatAt(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

/** 저장된 step은 smallint라 1~5 밖의 값도 들어올 수 있다. 그때는 번호만 보여 준다. */
function stepTitle(step: number | null): string {
  if (step === null) return '';
  return STEP_TITLES[step - 1] ?? `STEP ${step}`;
}

// ── 화면 ────────────────────────────────────────────────────────────

export function MyInquiriesPage({ user }: { user: User }) {
  const [rows, setRows] = useState<Inquiry[]>([]);
  const [jobNames, setJobNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [jobNameError, setJobNameError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setJobNameError('');
    try {
      // 목록 조회 실패를 "0건"으로 위장하지 않는다(jobApi.ts 상단 원칙). 실패는 오류로 보이고 재시도를 준다.
      setRows(await fetchMyInquiries(user.id));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : '내 문의를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setLoading(false);
      return;
    }
    setLoading(false);

    // 직무명은 review_id로만 이어지는 부가 정보다. 여기서 실패해도 문의 본문·답변은 그대로 보여 준다.
    const res = await fetchReviewStatusResult(user.company_id ?? null);
    if (!res.ok) {
      setJobNames({});
      setJobNameError('직무명을 불러오지 못했습니다. 문의 내용과 답변은 그대로 보실 수 있습니다.');
      return;
    }
    const map: Record<string, string> = {};
    for (const r of res.data) if (r.sme_id === user.id && r.review_id) map[r.review_id] = r.job_name;
    setJobNames(map);
  }, [user.id, user.company_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="mb-6">
        <p className="mb-1 text-sm text-foreground-subtle">검토 중 남긴 문의와 답변</p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">내 문의</h2>
      </div>

      {/*
        낭독용 상태 한 줄. 분기 안에 aria-live를 두면 로딩이 끝나는 순간 그 노드가 통째로 사라져
        결과도 실패도 읽히지 않는다(Toast.tsx·wizard.tsx의 저장 칩과 같은 원칙 — 컨테이너는 항상 그린다).
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {loading
          ? '불러오는 중…'
          : error
            ? error
            : rows.length === 0
              ? '아직 남긴 문의가 없습니다'
              : `문의 ${rows.length}건을 불러왔습니다.`}
      </p>

      {loading ? (
        <div className="py-12 text-center text-foreground-subtle">불러오는 중…</div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-container border border-destructive-border bg-destructive-muted p-6 text-center"
        >
          <AlertTriangle size={20} className="mx-auto mb-2 text-destructive" aria-hidden="true" />
          <p className="text-sm font-medium text-destructive">{error}</p>
          <p className="mt-1 text-xs text-foreground-muted">
            네트워크 상태를 확인한 뒤 다시 시도해 주세요. 계속 실패하면 관리자에게 문의해 주세요.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => void load()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-container border border-border bg-card p-10 text-center">
          <Inbox size={22} className="mx-auto mb-2 text-foreground-subtle" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">아직 남긴 문의가 없습니다</p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            검토 중 막히는 부분은 화면 우측 하단 &lsquo;문의하기&rsquo;로 남겨 주세요.
            <br />
            직무와 지금 보고 있는 단계가 함께 전달되어, 따로 설명하지 않으셔도 됩니다.
          </p>
          <Link
            to="/assignments"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-element border border-border px-4 text-xs font-medium text-foreground-muted transition hover:border-primary hover:text-primary sm:min-h-control-sm"
          >
            내 검토 목록으로 가기
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {jobNameError && (
            <p className="rounded-element border border-warning-border bg-warning-muted px-4 py-2 text-xs text-warning">
              {jobNameError}
            </p>
          )}
          {rows.map((q) => {
            const jobName = q.review_id ? jobNames[q.review_id] : '';
            const step = stepTitle(q.step);
            return (
              <article key={q.id} className="rounded-container border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <InquiryStatusBadge status={q.status} />
                  <span className="text-xs text-foreground-subtle">{formatAt(q.created_at)}</span>
                </div>

                {(jobName || step) && (
                  <p className="mt-2 text-sm text-foreground-muted">
                    {[jobName, step].filter(Boolean).join(' · ')}
                  </p>
                )}

                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{q.body}</p>

                {q.answer ? (
                  <div className="mt-4 rounded-element border border-primary-border bg-primary-subtle p-4">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                      <MessageSquareText size={13} aria-hidden="true" />
                      담당자 답변
                      <span className="font-normal text-foreground-muted">{formatAt(q.answered_at)}</span>
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{q.answer}</p>
                  </div>
                ) : (
                  <p className="mt-4 border-t border-border pt-3 text-xs text-foreground-subtle">
                    담당자가 확인 중입니다. 답변이 등록되면 이 화면에 함께 표시됩니다.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── SME 화면 배너 (§6-3ⓒ "답변 시 SME 화면 배너로 노출") ────────────
//
// 배치는 통합 담당 몫이라 여기서는 모양만 내보낸다. count는 fetchMyInquiries(user.id) 한 번으로
// 셀 수 있다 — 예: rows.filter(q => q.status === 'ANSWERED').length.
// 읽음 표시 컬럼이 없으므로 '답변' 상태가 유지되는 동안 계속 뜬다(관리자가 종결하면 사라진다).

function InquiryBanner({
  tone,
  Icon,
  text,
}: {
  tone: string;
  Icon: typeof Clock;
  text: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-element border px-4 py-3 text-sm ${tone}`}>
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{text}</p>
      <Link
        to="/inquiries"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-element px-3 text-xs font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:min-h-control-sm"
      >
        내 문의 보기
      </Link>
    </div>
  );
}

/** 답변이 도착한 문의가 있을 때. count가 0이면 아무것도 그리지 않는다. */
export function AnsweredInquiryBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <InquiryBanner
      tone="border-primary-border bg-primary-subtle text-primary"
      Icon={MessageSquareText}
      text={`문의 ${count}건에 답변이 등록되었습니다.`}
    />
  );
}

/** 아직 답변을 기다리는 문의가 있을 때. 같은 문의를 다시 남기지 않게 알려 주는 용도다. */
export function UnansweredInquiryBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <InquiryBanner
      tone="border-warning-border bg-warning-muted text-warning"
      Icon={Clock}
      text={`답변을 기다리는 문의가 ${count}건 있습니다.`}
    />
  );
}

export default MyInquiriesPage;
