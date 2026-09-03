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
  Timer,
  Upload,
  UserX,
} from 'lucide-react';
import { fetchCompanies, fetchReviewStatusResult, type Company, type ReviewStatusRow } from '@/lib/jobApi';
import { fetchDashboardStats, type DashboardStats } from '@/lib/adminApi';
import { fetchDurationStats, MIN_SAMPLE, type DurationStats } from '@/lib/durationApi';
import { Button } from '@/components/ui/Button';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { Skeleton } from '@/components/ui/Skeleton';
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
      className="flex min-h-11 flex-col rounded-container border border-border bg-card p-4 shadow-1 transition hover:border-primary"
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

// ── §11-2 Phase 5 2번 · §12 오픈이슈 1: 직무당 소요 실측 ─────────────

/** "중앙값 12.5분"처럼 소수 자리가 있을 때만 붙인다. */
const minuteText = (v: number): string => `${v % 1 === 0 ? v : v.toFixed(1)}분`;

/**
 * 직무당 소요 중앙값 카드. 관리자 전용 값이다.
 *
 * §6-1은 "화면에는 예상 소요 약 N분(관리자 설정값)만 표시하고, 실측치는 관리자 화면에서만
 * 노출한다(SME 압박 방지)"라고 정했다. 대시보드가 관리자 전용 라우트이긴 하지만 그 한 겹에만
 * 기대지 않는다 — durationApi가 profiles.role을 직접 확인해 관리자가 아니면 stats 자체를
 * null로 돌려주고, 이 카드는 stats가 없으면 아무것도 그리지 않는다(불러오는 중에도 그리지 않는다).
 */
function DurationCard({
  stats,
  error,
}: {
  stats: DurationStats | null;
  error: string;
}) {
  // stats가 없으면 조회 중이거나 관리자가 아니다. 어느 쪽이든 수치를 그릴 근거가 없다.
  if (!stats) {
    if (!error) return null;
    return (
      <section className="mt-8 rounded-container border border-border bg-card p-5 text-sm text-foreground-subtle shadow-1">
        소요 실측을 불러오지 못했어요. {error}
      </section>
    );
  }

  const { medianMinutes, sampleSize, lowSample, missingRecordCount, steps, expectedMinutes, expectedSource } = stats;
  const hasMedian = medianMinutes !== null && !lowSample;
  const stepRows = steps.filter((s) => s.sampleSize > 0);
  const stepMax = Math.max(1, ...stepRows.map((s) => s.medianMinutes ?? 0));
  const diff = hasMedian && expectedMinutes !== null ? Math.round((medianMinutes - expectedMinutes) * 10) / 10 : null;

  return (
    <section className="mt-8 rounded-container border border-border bg-card p-5 shadow-1">
      <div className="flex items-start gap-2">
        <Timer size={15} className="mt-0.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-foreground">직무당 소요 중앙값(실측)</h3>
          {/* 이 화면이 무엇의 근거인지 한 줄로 남긴다(§6-1 · R4). */}
          <p className="mt-1 text-xs text-foreground-subtle">
            착수보고 11면 「현업 SME 1인당 예상 소요: 직무당 약 ○○분(착수 후 확정)」을 채우는 실측 근거입니다.
            SME가 검토 화면에 머문 구간의 합이며, 제출을 마친 검토만 셉니다. SME 화면에는 표시되지 않습니다.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="border border-border bg-muted p-4">
          {hasMedian ? (
            <>
              <p className="text-2xl font-semibold text-primary">{minuteText(medianMinutes)}</p>
              <p className="mt-1 text-xs text-foreground-muted">표본 {sampleSize}건(제출 완료 검토 기준)</p>
            </>
          ) : (
            <>
              {/* 표본이 적을 때 숫자를 단정하지 않는다 — 그 수가 그대로 계약 문구가 되기 때문이다. */}
              <p className="text-lg font-semibold text-foreground-muted">표본 부족</p>
              <p className="mt-1 text-xs text-foreground-muted">
                기록된 완료 검토 {sampleSize}건. {MIN_SAMPLE}건 이상 모이면 중앙값을 표시합니다.
              </p>
            </>
          )}
          {missingRecordCount > 0 && (
            <p className="mt-2 text-[11px] text-foreground-subtle">
              완료 검토 {missingRecordCount}건은 소요 기록이 없어 분모에서 제외했습니다(창을 닫아 구간이 열린 채 끝난
              경우).
            </p>
          )}
        </div>

        <div className="border border-dashed border-border p-4">
          <p className="text-xs font-medium text-foreground">운영 설정 「예상 소요」 반영</p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">
            {/*
              세 상태를 각각 다르게 말한다. 특히 조회 실패(FAILED)를 「비어 있습니다」로 적으면,
              값을 이미 넣어 둔 관리자에게 앱이 "안 넣으셨습니다"라고 되돌려 말하게 된다.
            */}
            {expectedSource === 'ALL_COMPANIES'
              ? '계열사를 선택하면 그 회사의 운영 설정값과 비교됩니다. 예상 소요는 계열사별로 따로 정합니다.'
              : expectedSource === 'FAILED'
                ? '운영 설정을 불러오지 못해 이번에는 비교하지 못했습니다. 위 실측값은 그대로 쓰셔도 됩니다. 설정값은 「운영 설정 열기」에서 직접 확인해 주세요.'
                : expectedMinutes === null
                  ? '운영 설정의 「예상 소요」가 비어 있습니다. 실측 중앙값이 확정되면 설정에 반영해 주세요 — 가이드 카드 ④의 소요 문장이 이 값에서 나옵니다.'
                  : diff === null
                    ? `현재 설정값 ${expectedMinutes}분. 표본이 ${MIN_SAMPLE}건 이상 모이면 실측값과 비교해 드립니다.`
                    : diff === 0
                      ? `현재 설정값 ${expectedMinutes}분 — 실측 중앙값과 같습니다. 그대로 두셔도 됩니다.`
                      : `현재 설정값 ${expectedMinutes}분, 실측 중앙값 ${minuteText(medianMinutes as number)}로 ${minuteText(Math.abs(diff))} ${diff > 0 ? '더 걸립니다' : '덜 걸립니다'}. 실측 중앙값을 운영 설정의 「예상 소요」에 반영해 주세요.`}
          </p>
          <Link
            to="/settings"
            className="mt-3 inline-flex min-h-11 items-center gap-1 text-[11px] font-medium text-primary"
          >
            운영 설정 열기
            <ArrowRight size={11} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {stepRows.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium text-foreground">단계별 중앙값</p>
          <p className="mt-1 text-[11px] text-foreground-subtle">
            어느 단계가 오래 걸리는지가 부담을 줄일 자리입니다. 단계마다 표본 수가 다릅니다.
          </p>
          <ul className="mt-3 space-y-1.5">
            {stepRows.map((s) => (
              <li key={s.step} className="flex items-center gap-3 text-xs">
                <span className="w-44 shrink-0 truncate text-foreground-muted">{s.label}</span>
                <span className="h-2 min-w-[2px] bg-primary" style={{ width: `${((s.medianMinutes ?? 0) / stepMax) * 55}%` }} aria-hidden="true" />
                <span className="text-foreground">{s.medianMinutes === null ? '–' : minuteText(s.medianMinutes)}</span>
                <span className="text-foreground-subtle">
                  (표본 {s.sampleSize}건{s.sampleSize < MIN_SAMPLE ? ' · 표본 부족' : ''})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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

  // §11-2 Phase 5 2번 — 소요 실측. 관리자가 아니면 durationApi가 null을 주고 카드가 그려지지 않는다.
  const [duration, setDuration] = useState<DurationStats | null>(null);
  const [durationError, setDurationError] = useState('');

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
    // 다시 조회하는 동안 이전 범위의 실측치를 남겨 두지 않는다 — 바뀐 계열사의 값으로 읽히기 때문이다.
    setDuration(null);
    setDurationError('');
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

      // 소요 실측은 검토 현황과 같은 범위(계열사 필터)로 세야 하므로 같은 흐름에서 잇는다.
      // 별도 effect로 두면 필터를 바꾼 직후 한 번은 이전 범위의 검토 목록으로 집계하게 된다.
      if (!result.ok) {
        setDuration(null);
        setDurationError(result.error);
        return;
      }
      const durationResult = await fetchDurationStats(
        result.data.map((r) => ({ reviewId: r.review_id, status: r.review_status })),
        filter === 'all' ? null : filter,
      );
      if (cancelled) return;
      if (durationResult.ok) {
        setDuration(durationResult.data);
        setDurationError('');
      } else {
        setDuration(null);
        setDurationError(durationResult.error);
      }
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

  // 검토 목록은 이제 「SME별 검토 현황」 표에만 쓴다(v2 §6-5 — 지표는 fetchDashboardStats 하나가 원천).
  const smeNames = [...new Set(reviewRows.map((r) => r.sme_name))];

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

  /*
    v2 §6-5 — KPI 단일화.
    예전에는 같은 화면이 같은 사실을 두 번, 서로 다른 모집단으로 말했다(U2):
      · 상단 KPI 4장은 fetchDashboardStats(배정 기준)
      · 그 아래 카드 6장과 도넛은 get_review_status(검토 기준)
    그래서 "미시작 SME 수"와 "미실시", "응답률"과 "검토 완료율"이 서로 어긋나 보였다.
    이제 카드 6장을 없애고 그 수치를 도넛 범례로 흡수하며, 모집단은 fetchDashboardStats 하나다.
    「SME별 검토 현황」 표는 남긴다(사람 단위로 보는 유일한 자리 — 그쪽은 검토 목록이 원천이다).
  */
  const statusCounts = stats?.statusCounts;
  const distTotal = stats?.assignedCount ?? 0;
  const distPct = (n: number) => (distTotal ? Math.round((n / distTotal) * 1000) / 10 : 0);
  const distRate = distTotal ? Math.round(((stats?.submittedCount ?? 0) / distTotal) * 100) : 0;

  /*
    상태 분포. 색은 상태 토큰을 쓴다 — 이 차트의 계열이 곧 상태이므로 상태색이 의미를 그대로 옮긴다
    (montage의 "semantic ≠ chart"는 임의 계열에 상태색을 빌려 쓰지 말라는 규약이다).
    범례 항목을 누르면 그 상태로 걸러진 검토 현황으로 간다 — 없앤 카드 6장이 하던 일이다.
  */
  const dist: { label: string; n: number; color: string; status: StatusChip }[] = [
    {
      label: '제출 완료',
      n: (statusCounts?.SUBMITTED ?? 0) + (statusCounts?.RESUBMITTED ?? 0),
      color: 'rgb(var(--success))',
      status: 'SUBMITTED',
    },
    { label: '작성 중', n: statusCounts?.IN_PROGRESS ?? 0, color: 'rgb(var(--warning))', status: 'IN_PROGRESS' },
    {
      label: '재검토 요청',
      n: statusCounts?.REVIEW_REQUESTED ?? 0,
      color: 'rgb(var(--destructive))',
      status: 'REVIEW_REQUESTED',
    },
    { label: '미실시', n: statusCounts?.NOT_STARTED ?? 0, color: 'rgb(var(--foreground-subtle))', status: 'NOT_STARTED' },
  ];

  // total 0 가드가 없으면 conic-gradient에 NaNdeg가 들어가 도넛이 통째로 깨진다.
  let acc = 0;
  const conic = dist
    .map(({ n, color }) => {
      const start = acc;
      acc += distTotal ? (n / distTotal) * 360 : 0;
      return `${color} ${start}deg ${acc}deg`;
    })
    .join(', ');
  const donutLabel = `검토 상태 분포. 배정 ${distTotal}건. ${dist
    .map((d) => `${d.label} ${d.n}건 ${distPct(d.n)}%`)
    .join(', ')}.`;

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
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
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

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <DurationCard stats={duration} error={durationError} />

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-container border border-border bg-card p-5 shadow-1">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-foreground">SME별 검토 현황</h3>
              <p className="mt-1 text-xs text-foreground-subtle">SME별 제출 완료 · 작성 중 · 미실시 건수</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => openReviews('ALL')}>
              전체보기
            </Button>
          </div>
          {loading ? (
            <Skeleton.Table rows={4} cols={5} />
          ) : error ? (
            <FallbackView
              kind="error"
              compact
              description="검토 현황을 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요."
            />
          ) : (
            // v2 §6-5: 공용 DataTable — 좁은 화면에서는 줄 목록으로 쌓인다.
            <DataTable
              caption="SME별 검토 현황"
              minWidth="620px"
              className="border-0"
              rows={smeRows}
              rowKey={(r) => r.name}
              onRowClick={(r) => openReviews('ALL', r.name)}
              empty={
                <FallbackView
                  compact
                  heading="검토 대상이 없어요"
                  description="직무정보를 업로드하고 SME에게 배정하면 여기에 나타나요."
                />
              }
              columns={[
                {
                  key: 'sme',
                  header: 'SME',
                  mobile: 'title',
                  cell: (r) => <span className="font-medium text-foreground">{r.name}</span>,
                },
                {
                  key: 'org',
                  header: '소속 / 직급',
                  cell: (r) => (
                    <span className="t-caption text-foreground-subtle">
                      {r.organization} · {r.title}
                    </span>
                  ),
                },
                { key: 'total', header: '담당', align: 'center', cell: (r) => r.total },
                {
                  key: 'submitted',
                  header: '제출 완료',
                  align: 'center',
                  mobile: 'trailing',
                  cell: (r) => <span className="font-semibold text-success">{r.submitted}</span>,
                },
                {
                  key: 'inProgress',
                  header: '작성 중',
                  align: 'center',
                  cell: (r) => <span className="font-semibold text-warning">{r.inProgress}</span>,
                },
                {
                  key: 'resubmit',
                  header: '재검토 요청',
                  align: 'center',
                  cell: (r) => <span className="font-semibold text-destructive">{r.resubmit}</span>,
                },
                {
                  key: 'notStarted',
                  header: '미실시',
                  align: 'center',
                  cell: (r) => <span className="font-semibold text-foreground-muted">{r.notStarted}</span>,
                },
              ]}
            />
          )}
        </section>

        <section className="rounded-container border border-border bg-card p-5 shadow-1">
          <h3 className="font-semibold text-foreground">검토 상태 분포</h3>
          <p className="mt-1 t-caption text-foreground-subtle">
            {statsState === 'loading'
              ? '불러오는 중…'
              : statsState === 'error'
                ? '조회에 실패해 분포를 계산할 수 없어요.'
                : `배정 ${distTotal}건 기준 · SME ${stats?.smeCount ?? 0}명 · 응답률 ${distRate}%`}
          </p>
          {statsState === 'ready' && distTotal > 0 ? (
            <div className="mt-8 flex flex-col items-center gap-8 sm:flex-row">
              <div
                role="img"
                aria-label={donutLabel}
                className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full"
                style={{ background: `conic-gradient(${conic})` }}
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-card text-center">
                  <span className="text-xl font-semibold text-foreground">
                    {distRate}
                    <small className="t-caption">%</small>
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
                        <span className="text-foreground-subtle">({distPct(n)}%)</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <FallbackView
              compact
              kind={statsState === 'error' ? 'error' : 'empty'}
              className="mt-8 rounded-element border border-dashed border-border"
              description={
                statsState === 'loading'
                  ? '검토 현황을 불러오는 중이에요.'
                  : statsState === 'error'
                    ? '지표를 불러오면 분포가 표시돼요.'
                    : '아직 배정된 검토가 없어 분포를 그릴 수 없어요. 직무정보를 업로드하고 SME에게 배정해 주세요.'
              }
            />
          )}
        </section>
      </div>
    </>
  );
}
