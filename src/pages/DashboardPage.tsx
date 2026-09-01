// 관리자 대시보드 — 관리자(ADMIN) 홈 화면. 전체 검토 현황 요약을 보여준다.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  MessageSquareText,
  RotateCw,
  Upload,
  UserX,
} from 'lucide-react';
import { fetchCompanies, fetchReviewStatusResult, type Company, type ReviewStatusRow } from '@/lib/jobApi';
import { fetchDashboardStats, type DashboardStats } from '@/lib/adminApi';
import { Button } from '@/components/ui/Button';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { setReviewTablePrefilter, type StatusChip } from '@/pages/ReviewStatusPage';

const timeFormat: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeStyle: 'short' };
const dateFormat: Intl.DateTimeFormatOptions = { dateStyle: 'long' };

// ── §6-3 ⓐ 상단 4지표 ───────────────────────────────────────────────

/**
 * 마감 D-day 문구. dDay는 adminApi가 survey_settings.due_date로 계산한다.
 * 미설정이면 숫자를 지어내지 않고 "마감일 미설정"으로 둔다 —
 * 없는 마감일을 그럴듯한 D-30으로 그리는 순간 그 화면이 잘못된 근거가 된다.
 */
function dDayText(dDay: number | null): string {
  if (dDay === null) return '';
  if (dDay > 0) return `D-${dDay}`;
  if (dDay === 0) return 'D-day';
  return `D+${-dDay}`;
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  Icon,
  to,
  linkLabel,
  state,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
  Icon: typeof CalendarClock;
  to: string;
  linkLabel: string;
  /** 'loading' · 'error'일 때는 값을 그리지 않는다. 0과 구분되지 않기 때문이다. */
  state: 'ready' | 'loading' | 'error';
}) {
  return (
    <Link
      to={to}
      className="flex min-h-11 flex-col border border-border bg-card p-4 shadow-sm transition hover:border-primary"
    >
      <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
        <Icon size={13} className="shrink-0" aria-hidden="true" />
        {label}
      </p>
      <p
        className={`mt-3 font-semibold ${value.length > 5 ? 'text-lg' : 'text-2xl'} ${
          state === 'ready' ? tone : 'text-foreground-subtle'
        }`}
      >
        {state === 'ready' ? value : '–'}
      </p>
      <p className="mt-1 text-[11px] text-foreground-subtle">
        {state === 'loading' ? '불러오는 중…' : state === 'error' ? '조회 실패' : sub}
      </p>
      <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
        {linkLabel}
        <ArrowRight size={11} aria-hidden="true" />
      </p>
    </Link>
  );
}

export function Dashboard({
  go,
  companyFilter,
  setCompanyFilter,
}: {
  go: (page: string) => void;
  /** App.tsx가 회사 필터를 내려주면 다른 화면과 같은 값을 쓴다. 아직 안 내려주므로 없으면 자체 상태로 동작한다. */
  companyFilter?: string;
  setCompanyFilter?: (v: string) => void;
}) {
  const [localFilter, setLocalFilter] = useState('all');
  const filter = setCompanyFilter ? (companyFilter ?? 'all') : localFilter;
  const setFilter = setCompanyFilter ?? setLocalFilter;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [reviewRows, setReviewRows] = useState<ReviewStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // §6-3 ⓐ 상단 4지표. 검토 현황 조회와 별개로 실패할 수 있으므로 상태를 따로 둔다
  // (한쪽이 실패했다고 다른 쪽까지 '–'로 지우면 볼 수 있는 수치를 잃는다).
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    (async () => {
      const result = await fetchDashboardStats(filter === 'all' ? null : filter);
      if (cancelled) return;
      if (result.ok) {
        setStats(result.data);
        setStatsError('');
      } else {
        setStats(null);
        setStatsError(result.error);
      }
      setStatsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await fetchReviewStatusResult(filter === 'all' ? null : filter);
      if (cancelled) return;
      if (result.ok) {
        setReviewRows(result.data);
        setError('');
        setLoadedAt(new Date());
      } else {
        setReviewRows([]);
        setError(result.error);
        setLoadedAt(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  // 카드·행을 누르면 검토 현황 화면이 그 범위로 걸러진 채 열린다.
  const openReviews = useCallback(
    (status: StatusChip, query = '') => {
      setReviewTablePrefilter({ status, query, companyFilter: filter });
      go('reviews');
    },
    [filter, go],
  );

  const total = reviewRows.length;
  const smeNames = [...new Set(reviewRows.map((r) => r.sme_name))];
  const cnt = (s: string) => reviewRows.filter((r) => r.review_status === s).length;
  const notStarted = cnt('NOT_STARTED');
  const inProgress = cnt('IN_PROGRESS');
  const submitted = cnt('SUBMITTED') + cnt('RESUBMITTED');
  const resubmit = cnt('REVIEW_REQUESTED');
  const completionRate = total ? Math.round((submitted / total) * 1000) / 10 : 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  const smeRows = smeNames.map((name) => {
    const items = reviewRows.filter((r) => r.sme_name === name);
    return {
      name,
      organization: items[0]?.organization || '',
      title: items[0]?.title || '',
      total: items.length,
      submitted: items.filter((r) => r.review_status === 'SUBMITTED' || r.review_status === 'RESUBMITTED').length,
      inProgress: items.filter((r) => r.review_status === 'IN_PROGRESS').length,
      notStarted: items.filter((r) => r.review_status === 'NOT_STARTED').length,
      resubmit: items.filter((r) => r.review_status === 'REVIEW_REQUESTED').length,
    };
  });

  // 로딩·오류일 때는 값을 0으로 그리지 않는다(진짜 0건과 구분되지 않기 때문).
  const ready = !loading && !error;
  const cards: { label: string; value: string | number; sub: string; tone: string; status: StatusChip }[] = [
    { label: '전체 SME 수', value: smeNames.length, sub: '등록 계정 기준', tone: 'text-foreground', status: 'ALL' },
    {
      label: '미실시',
      value: notStarted,
      sub: `전체의 ${pct(notStarted)}%`,
      tone: 'text-foreground-muted',
      status: 'NOT_STARTED',
    },
    {
      label: '작성 중',
      value: inProgress,
      sub: `전체의 ${pct(inProgress)}%`,
      tone: 'text-warning',
      status: 'IN_PROGRESS',
    },
    {
      label: '제출 완료',
      value: submitted,
      sub: `전체의 ${pct(submitted)}%`,
      tone: 'text-success',
      status: 'SUBMITTED',
    },
    {
      label: '재검토 요청',
      value: resubmit,
      sub: `전체의 ${pct(resubmit)}%`,
      tone: 'text-destructive',
      status: 'REVIEW_REQUESTED',
    },
    {
      label: '검토 완료율',
      value: `${completionRate}%`,
      sub: `${submitted} / ${total}건`,
      tone: 'text-primary',
      status: 'ALL',
    },
  ];

  const dist: { label: string; n: number; color: string; status: StatusChip }[] = [
    { label: '제출 완료', n: submitted, color: 'rgb(var(--success))', status: 'SUBMITTED' },
    { label: '작성 중', n: inProgress, color: 'rgb(var(--warning))', status: 'IN_PROGRESS' },
    { label: '재검토 요청', n: resubmit, color: 'rgb(var(--destructive))', status: 'REVIEW_REQUESTED' },
    { label: '미실시', n: notStarted, color: 'rgb(var(--foreground-subtle))', status: 'NOT_STARTED' },
  ];

  // total 0 가드가 없으면 conic-gradient에 NaNdeg가 들어가 도넛이 통째로 깨진다.
  let acc = 0;
  const conic = dist
    .map(({ n, color }) => {
      const start = acc;
      acc += total ? (n / total) * 360 : 0;
      return `${color} ${start}deg ${acc}deg`;
    })
    .join(', ');
  const donutLabel = `검토 상태 분포. 전체 ${total}건. ${dist.map((d) => `${d.label} ${d.n}건 ${pct(d.n)}%`).join(', ')}.`;

  // ── §6-3 ⓐ 상단 4지표: 응답률(제출/배정) · 마감 D-day · 미시작 SME 수 · 미답 문의 수 ──
  const statsState: 'ready' | 'loading' | 'error' = statsLoading ? 'loading' : statsError ? 'error' : 'ready';
  const responseRatePct = stats ? Math.round(stats.responseRate * 1000) / 10 : 0;
  // 마감일은 계열사별로 다르므로 '전체 회사'에서는 adminApi가 하나로 합치지 않고 null을 준다.
  // 이때 '미설정'이라고 단정하면 거짓이 되므로 왜 안 보이는지를 그대로 적는다.
  const dueSub = stats?.dueDate
    ? `${new Date(stats.dueDate).toLocaleDateString('ko-KR', dateFormat)} 마감`
    : filter === 'all'
      ? '계열사를 선택하면 마감일이 표시됩니다'
      : '— 운영 설정에서 지정';
  const kpis: Parameters<typeof KpiCard>[0][] = [
    {
      label: '응답률(제출/배정)',
      value: `${responseRatePct}%`,
      sub: `제출 ${stats?.submittedCount ?? 0} / 배정 ${stats?.assignedCount ?? 0}건`,
      tone: 'text-primary',
      Icon: ClipboardCheck,
      to: '/workbench',
      linkLabel: '검토 워크벤치 열기',
      state: statsState,
    },
    {
      label: '마감 D-day',
      value: stats && stats.dDay !== null ? dDayText(stats.dDay) : '마감일 미설정',
      sub: dueSub,
      tone: stats && stats.dDay !== null && stats.dDay < 0 ? 'text-destructive' : 'text-foreground',
      Icon: CalendarClock,
      to: '/progress',
      linkLabel: '진행 현황 보기',
      state: statsState,
    },
    {
      label: '미시작 SME 수',
      value: `${stats?.notStartedSme ?? 0}명`,
      sub: '아직 한 번도 검토를 열지 않은 SME',
      tone: 'text-warning',
      Icon: UserX,
      to: '/progress',
      linkLabel: '진행 현황 보기',
      state: statsState,
    },
    {
      label: '미답 문의 수',
      value: `${stats?.openInquiries ?? 0}건`,
      sub: '답변을 기다리는 문의',
      tone: 'text-destructive',
      Icon: MessageSquareText,
      to: '/inbox',
      linkLabel: '문의 인박스 열기',
      state: statsState,
    },
  ];

  return (
    <>
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            {loading
              ? '검토 현황을 불러오는 중이에요.'
              : loadedAt
                ? `${loadedAt.toLocaleString('ko-KR', timeFormat)} 조회 기준`
                : '조회 시각을 확인할 수 없어요.'}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">검토 현황을 확인하세요.</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={filter} onChange={setFilter} />
          <Button onClick={() => go('upload')}>
            <Upload size={16} /> 직무정보 업로드
          </Button>
        </div>
      </div>

      {statsError && (
        <div className="mb-5 flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>상단 지표를 불러오지 못했어요. {statsError} 잠시 후 다시 시도해 주세요.</span>
          </p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
            <RotateCw size={14} /> 다시 시도
          </Button>
        </div>
      )}

      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {error && (
        <div className="mb-5 flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>검토 현황을 불러오지 못했어요. {error} 잠시 후 다시 시도해 주세요.</span>
          </p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
            <RotateCw size={14} /> 다시 시도
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(({ label, value, sub, tone, status }) => (
          <button
            key={label}
            type="button"
            onClick={() => openReviews(status)}
            disabled={!ready}
            className="border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary disabled:cursor-default disabled:hover:border-border"
          >
            <p className="text-xs text-foreground-muted">{label}</p>
            <p className={`mt-3 text-2xl font-semibold ${ready ? tone : 'text-foreground-subtle'}`}>
              {ready ? value : '–'}
            </p>
            <p className="mt-1 text-[11px] text-foreground-subtle">
              {loading ? '불러오는 중…' : error ? '조회 실패' : sub}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-foreground">SME별 검토 현황</h3>
              <p className="mt-1 text-xs text-foreground-subtle">SME별 제출 완료 · 작성 중 · 미실시 건수</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => openReviews('ALL')}>
              전체보기
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted text-xs text-foreground-muted">
                  <th scope="col" className="px-4 py-3 font-medium">
                    SME
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    소속 / 직급
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-medium">
                    담당
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-medium">
                    제출 완료
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-medium">
                    작성 중
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-medium">
                    재검토 요청
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-medium">
                    미실시
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-foreground-subtle">
                      불러오는 중…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-destructive">
                      검토 현황을 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요.
                    </td>
                  </tr>
                ) : smeRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-foreground-subtle">
                      검토 대상이 없습니다. 직무정보를 업로드하고 SME에게 배정해 주세요.
                    </td>
                  </tr>
                ) : (
                  smeRows.map((r) => (
                    <tr
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-primary-subtle"
                      key={r.name}
                      onClick={() => openReviews('ALL', r.name)}
                    >
                      <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => openReviews('ALL', r.name)}
                        >
                          {r.name}
                        </button>
                      </th>
                      <td className="px-4 py-3 text-foreground-muted">
                        <span className="text-xs text-foreground-subtle">
                          {r.organization} · {r.title}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-foreground-muted">{r.total}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-success">{r.submitted}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-warning">{r.inProgress}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-destructive">{r.resubmit}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-foreground-muted">{r.notStarted}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border border-border bg-card p-5 shadow-sm">
          <h3 className="font-semibold text-foreground">검토 상태 분포</h3>
          <p className="mt-1 text-xs text-foreground-subtle">
            {loading
              ? '불러오는 중…'
              : error
                ? '조회에 실패해 분포를 계산할 수 없어요.'
                : `전체 ${total}건 기준 · 검토 완료율 ${completionRate}%`}
          </p>
          {ready && total > 0 ? (
            <div className="mt-7 flex flex-col items-center gap-7 sm:flex-row">
              <div
                role="img"
                aria-label={donutLabel}
                className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full"
                style={{ background: `conic-gradient(${conic})` }}
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-card text-center">
                  <span className="text-xl font-semibold text-foreground">
                    {completionRate}
                    <small className="text-xs">%</small>
                  </span>
                </div>
              </div>
              <ul className="w-full space-y-1 text-xs">
                {dist.map(({ label, n, color, status }) => (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => openReviews(status)}
                      className="flex w-full items-center justify-between gap-2 px-1 py-2 hover:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: color }}
                          aria-hidden="true"
                        />
                        <span className="text-foreground-muted">{label}</span>
                      </span>
                      <span className="flex items-baseline gap-1.5">
                        <b className="text-foreground">{n}건</b>
                        <span className="text-foreground-subtle">({pct(n)}%)</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-7 border border-dashed border-border p-6 text-center text-xs text-foreground-subtle">
              {loading
                ? '검토 현황을 불러오는 중이에요.'
                : error
                  ? '데이터를 불러오면 분포가 표시돼요.'
                  : '아직 검토 대상이 없어 분포를 그릴 수 없어요. 직무정보를 업로드하고 SME에게 배정해 주세요.'}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
