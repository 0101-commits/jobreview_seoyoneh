// 문의 인박스(/inbox) — 관리자 화면. §6-3 ⓒ "문의는 직무·단계 컨텍스트가 자동 첨부되어 도착.
// 답변 시 SME 화면 배너로 노출. 상태(미답/답변/종결)와 미답 경과일 표시."를 이행한다.
//
// 조회·저장은 전부 src/lib/adminApi.ts를 거친다(Phase 3 공유 계약 — 화면에서 쿼리를 짜지 않는다).
// SME 쪽 짝은 src/pages/MyInquiriesPage.tsx다. 상태 세 값의 표기(미답/답변/종결)·아이콘·색을
// 그 화면과 같게 맞춰야 한 사람이 양쪽에서 같은 문의를 보고 같은 말을 읽는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Inbox, MessageSquareText, RotateCw } from 'lucide-react';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { Button } from '@/components/ui/Button';
import { Toast, useToast } from '@/components/ui/Toast';
import { AutoTextarea } from '@/pages/sme-review/controls';
import { STEP_TITLES } from '@/pages/sme-review/copy';
import { fetchCompaniesResult, type Company } from '@/lib/jobApi';
import {
  answerInquiry,
  closeInquiry,
  fetchInquiries,
  INQUIRY_STATUS_LABELS,
  type AdminInquiry,
  type InquiryFilter,
} from '@/lib/adminApi';
import type { InquiryStatus } from '@/lib/surveyApi';

/**
 * 미답 경과일 경고 임계값(일). **기획안에 없어 새로 정한 값이다.**
 *
 * §6-3 ⓒ는 "미답 경과일 표시"까지만 요구하고 며칠부터 늦은 것인지는 정하지 않았다. 3일로 잡은 근거는
 * 두 가지다. ① 문의는 SME의 검토가 그 자리에서 멈췄다는 신호다(§6-1 카드 ④가 막히면 문의하라고
 * 안내한다). 답이 늦으면 그 직무 하나가 통째로 마감까지 밀린다. ② 금요일 접수분이 주말을 건너
 * 월요일에 닿는 폭이 3일이라, 그보다 짧게 잡으면 주말마다 전 건이 경고로 물들어 신호가 죽는다.
 *
 * 워크숍 자동 규칙의 임계값(30% · 20%p · 3건)과 달리 이 값은 §11-2 Phase 3이 상수 파일로 모으라고
 * 지목한 대상이 아니라 이 화면만 쓰는 표시 기준이라 여기 둔다. 파일럿에서 운영 리듬을 보고
 * 조정한다(§12 오픈이슈 5번과 같은 성격의 값).
 */
const OVERDUE_WARNING_DAYS = 3;

// ── 상태 표기 ───────────────────────────────────────────────────────
//
// shared/StatusBadge.tsx는 쓸 수 없다. 그쪽은 검토 상태(미시작·작성 중·제출 완료…)에 타입이 묶여
// 있어 문의 상태 세 값이 들어가지 않는다. MyInquiriesPage의 배지도 그 파일 안 지역 컴포넌트라
// 가져올 수 없어, 같은 모양(rounded·11px·아이콘 병기)만 맞춘다. 라벨은 계약에서 읽는다.
const STATUS_VIEW: Record<InquiryStatus, { className: string; Icon: typeof Clock }> = {
  OPEN: { className: 'bg-amber-50 text-amber-700', Icon: Clock },
  ANSWERED: { className: 'bg-emerald-50 text-emerald-700', Icon: MessageSquareText },
  CLOSED: { className: 'bg-slate-100 text-slate-600', Icon: CheckCircle2 },
};

function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  const { className, Icon } = STATUS_VIEW[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium ${className}`}
    >
      <Icon size={12} aria-hidden="true" />
      {INQUIRY_STATUS_LABELS[status]}
    </span>
  );
}

/** 미답 경과일. 색만으로 알리지 않도록 지연 여부를 문구로도 적는다(아이콘까지 셋을 함께 쓴다). */
function WaitingDaysChip({ days }: { days: number }) {
  const late = days >= OVERDUE_WARNING_DAYS;
  const Icon = late ? AlertTriangle : Clock;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium ${
        late ? 'border border-warning-border bg-warning-muted text-warning' : 'bg-slate-100 text-slate-600'
      }`}
    >
      <Icon size={12} aria-hidden="true" />
      {days === 0 ? '오늘 접수' : `미답 ${days}일 경과`}
      {late && ' · 답변 지연'}
    </span>
  );
}

const FILTERS: { key: InquiryFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'OPEN', label: INQUIRY_STATUS_LABELS.OPEN },
  { key: 'ANSWERED', label: INQUIRY_STATUS_LABELS.ANSWERED },
  { key: 'CLOSED', label: INQUIRY_STATUS_LABELS.CLOSED },
];

/** 미답 우선(§ 기본 정렬). 미답끼리는 오래 기다린 순, 나머지는 최신순. */
const STATUS_RANK: Record<InquiryStatus, number> = { OPEN: 0, ANSWERED: 1, CLOSED: 2 };

function formatAt(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

/** 저장된 step은 smallint라 1~5 밖의 값도 들어올 수 있다. 그때는 번호만 보여 준다(MyInquiriesPage와 동일). */
function stepTitle(step: number | null): string {
  if (step === null) return '';
  return STEP_TITLES[step - 1] ?? `STEP ${step}`;
}

// ── 화면 ────────────────────────────────────────────────────────────

export function InquiryInboxPage({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [rows, setRows] = useState<AdminInquiry[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyError, setCompanyError] = useState('');
  const [filter, setFilter] = useState<InquiryFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // 작성 중인 답변은 문의 id로 들고 있는다. 필터를 바꿔도, 저장에 실패해도, 계열사를 바꿔 목록을
  // 다시 불러도 쓰던 글이 남는다(문의 작성 모달이 본문을 버튼 쪽에 두는 것과 같은 이유).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const { toast, showToast, dismiss } = useToast();

  useEffect(() => {
    void fetchCompaniesResult().then((res) => {
      if (res.ok) {
        setCompanies(res.data);
        setCompanyError('');
      } else {
        // 목록을 비우기만 하면 "계열사가 없다"로 읽힌다. 조회에 실패했다고 적는다(jobApi.ts 상단 원칙).
        setCompanies([]);
        setCompanyError('계열사 목록을 불러오지 못해 전체 회사 기준으로 표시합니다.');
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // ponytail: 상태 필터를 fetchInquiries 인자로 서버에 넘길 수도 있지만 한 번 받아 화면에서 거른다 —
    // 칩마다 건수를 보여 주려면 어차피 전체가 필요하고, 필터 전환도 왕복 없이 끝난다.
    // 인박스가 수천 건이 되면 filter 인자를 서버로 넘기고 건수는 별도 집계로 돌린다.
    void (async () => {
      const res = await fetchInquiries(companyFilter === 'all' ? null : companyFilter);
      if (cancelled) return;
      if (res.ok) {
        setRows(res.data);
        setError('');
      } else {
        setRows([]);
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilter, reloadKey]);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (rank) return rank;
        // created_at을 못 읽은 건은 빈 문자열이라 미답 안에서 맨 앞에 온다 — 눈에 띄는 편이 낫다.
        const ta = a.createdAt ?? '';
        const tb = b.createdAt ?? '';
        return a.status === 'OPEN' ? ta.localeCompare(tb) : tb.localeCompare(ta);
      }),
    [rows],
  );
  const visible = useMemo(
    () => (filter === 'ALL' ? sorted : sorted.filter((q) => q.status === filter)),
    [sorted, filter],
  );

  const patchRow = useCallback((id: string, patch: Partial<AdminInquiry>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const setRowError = useCallback((id: string, message: string) => {
    setRowErrors((e) => ({ ...e, [id]: message }));
  }, []);

  async function saveAnswer(q: AdminInquiry) {
    const text = (drafts[q.id] ?? q.answer).trim();
    if (!text || busyId) return;
    setBusyId(q.id);
    setRowError(q.id, '');
    const res = await answerInquiry(q.id, text);
    setBusyId('');
    if (!res.ok) {
      // 저장 실패. 사유를 그대로 보이고 쓰던 답변은 그대로 둔다 — 같은 버튼으로 다시 시도한다.
      setRowError(q.id, res.error);
      return;
    }
    // 목록을 다시 부르지 않고 그 줄만 고친다. 재조회가 실패하면 방금 저장한 답변이 화면에서
    // 사라져 저장 자체를 의심하게 된다(저장은 이미 끝난 뒤다).
    patchRow(q.id, { answer: text, status: 'ANSWERED', answeredAt: new Date().toISOString(), waitingDays: null });
    setDrafts((d) => {
      const next = { ...d };
      delete next[q.id];
      return next;
    });
    showToast({ type: 'success', msg: '답변을 저장했습니다. SME 화면에 배너로 표시됩니다.' });
  }

  async function closeOne(q: AdminInquiry) {
    if (busyId) return;
    // 종결하면 카드가 읽기 전용으로 바뀌어 쓰던 답변을 다시 볼 방법이 없다([답변 저장] 바로 옆 버튼이다).
    // 저장한 답변과 다른 초안이 남아 있으면 먼저 묻는다(App.tsx·ModalShell과 같은 관례).
    const draft = (drafts[q.id] ?? '').trim();
    if (
      draft &&
      draft !== q.answer.trim() &&
      !window.confirm('저장하지 않은 답변이 있어요. 종결하면 작성 중인 내용이 사라집니다. 답변 없이 종결할까요?')
    ) {
      return;
    }
    setBusyId(q.id);
    setRowError(q.id, '');
    const res = await closeInquiry(q.id);
    setBusyId('');
    if (!res.ok) {
      setRowError(q.id, res.error);
      return;
    }
    patchRow(q.id, { status: 'CLOSED', waitingDays: null });
    showToast({ type: 'success', msg: '문의를 종결했습니다.' });
  }

  const openCount = rows.filter((q) => q.status === 'OPEN').length;
  const lateCount = rows.filter((q) => q.waitingDays !== null && q.waitingDays >= OVERDUE_WARNING_DAYS).length;

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            {loading
              ? '불러오는 중…'
              : error
                ? '조회 실패'
                : `총 ${rows.length}건 · 미답 ${openCount}건${
                    lateCount ? ` (${OVERDUE_WARNING_DAYS}일 이상 ${lateCount}건)` : ''
                  }`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">문의 인박스</h2>
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
          {companyError && <p className="text-xs text-warning">{companyError}</p>}
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      {/* 낭독용 한 줄. 컨테이너는 분기 밖에 둬야 이후 변경이 읽힌다(MyInquiriesPage와 같은 원칙). */}
      <p role="status" aria-live="polite" className="sr-only">
        {loading
          ? '불러오는 중…'
          : error
            ? error
            : `문의 ${visible.length}건을 표시하고 있습니다. 미답 ${openCount}건.`}
      </p>

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="문의 상태 필터">
        {FILTERS.map(({ key, label }) => {
          const on = filter === key;
          const count = key === 'ALL' ? rows.length : rows.filter((q) => q.status === key).length;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(key)}
              className={`min-h-11 rounded-element border px-3 text-xs font-medium transition sm:min-h-control-sm ${
                on
                  ? 'border-primary bg-primary-subtle text-primary'
                  : 'border-border bg-card text-foreground-muted hover:border-primary hover:text-primary'
              }`}
            >
              {label} {loading || error ? '' : count}
            </button>
          );
        })}
      </div>

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
            문의가 없는 것이 아니라 목록을 불러오지 못한 상태입니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-container border border-border bg-card p-10 text-center">
          <Inbox size={22} className="mx-auto mb-2 text-foreground-subtle" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            {rows.length === 0 ? '아직 도착한 문의가 없습니다' : '이 상태의 문의가 없습니다'}
          </p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            {rows.length === 0
              ? 'SME가 검토 화면에서 남긴 문의가 직무·단계와 함께 이곳에 도착합니다.'
              : '다른 상태 필터를 눌러 보세요.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((q) => {
            const draft = drafts[q.id] ?? q.answer;
            const busy = busyId === q.id;
            const rowError = rowErrors[q.id] || '';
            const context = [q.jobName, stepTitle(q.step)].filter(Boolean).join(' · ');
            const canSave = draft.trim().length > 0 && draft.trim() !== q.answer.trim() && !busyId;

            return (
              <article key={q.id} className="rounded-container border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <InquiryStatusBadge status={q.status} />
                  {q.waitingDays !== null && <WaitingDaysChip days={q.waitingDays} />}
                  <span className="text-xs text-foreground-subtle">{formatAt(q.createdAt)}</span>
                </div>

                <p className="mt-2 text-sm font-medium text-foreground">
                  {q.smeName || '이름 미상'}
                  {q.organization && <span className="ml-2 font-normal text-foreground-muted">{q.organization}</span>}
                </p>
                <p className="mt-1 text-sm text-foreground-muted">
                  {context || <span className="text-foreground-subtle">직무·단계 정보 없음(검토 시작 전 문의)</span>}
                </p>

                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">{q.body}</p>

                {q.status === 'CLOSED' ? (
                  <div className="mt-4 rounded-element border border-border bg-muted p-4">
                    <p className="text-xs font-medium text-foreground-muted">
                      종결된 문의입니다{q.answer ? ` · 답변 ${formatAt(q.answeredAt)}` : ''}
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">
                      {q.answer || '답변 없이 종결되었습니다.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-border pt-4">
                    <label className="block">
                      <span className="label">{q.answer ? '답변 수정' : '답변 작성'}</span>
                      <AutoTextarea
                        id={`inquiry-answer-${q.id}`}
                        value={draft}
                        onChange={(v) => setDrafts((d) => ({ ...d, [q.id]: v }))}
                        minRows={3}
                        maxRows={12}
                        disabled={busy}
                        placeholder="답변을 입력해 주세요."
                      />
                    </label>
                    {/* 무엇이 SME에게 전달되는지 먼저 알린다 — 문의 작성 모달이 컨텍스트를 먼저 보여 주는 것과 같은 결. */}
                    <p className="mt-2 text-xs leading-5 text-foreground-subtle">
                      저장하면 SME 검토 화면 상단에 배너로 알려지고, &lsquo;내 문의&rsquo;에서 이 답변 전문이 그대로
                      표시됩니다.
                      {q.answeredAt && ` (마지막 답변 ${formatAt(q.answeredAt)})`}
                    </p>

                    {rowError && (
                      <div
                        role="alert"
                        className="mt-3 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2.5 text-xs leading-5 text-destructive"
                      >
                        {rowError}
                        <span className="mt-1 block text-foreground-muted">
                          작성하신 답변은 그대로 남아 있습니다. 네트워크를 확인한 뒤 다시 저장해 주세요.
                        </span>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => void saveAnswer(q)} disabled={!canSave} loading={busy}>
                        {rowError ? '다시 저장' : '답변 저장'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void closeOne(q)} disabled={!!busyId}>
                        종결
                      </Button>
                      {!q.answer && (
                        <span className="text-xs text-foreground-subtle">
                          답변 없이 종결하면 SME에게는 답변이 표시되지 않습니다.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

export default InquiryInboxPage;
