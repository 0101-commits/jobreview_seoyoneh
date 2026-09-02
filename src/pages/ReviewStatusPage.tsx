// SME 검토 현황 표 — 관리자(ADMIN) '검토 현황' 화면.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RotateCw, Search } from 'lucide-react';
import {
  fetchCompanies,
  fetchReviewStatusResult,
  mapReviewStatus,
  type Company,
  type ReviewStatusRow,
} from '@/lib/jobApi';
import {
  fetchReviewFeedback,
  toSuitabilityLabel,
  type JobFeedbackSection,
  type ReviewFeedbackData,
} from '@/lib/reviewApi';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { FilterChips } from '@/components/ui/FilterChips';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';

// ── 다른 화면에서 넘어올 때의 초기 필터 ──────────────────────────────
// ponytail: 화면 사이로 필터를 넘길 통로가 없어 sessionStorage를 임시로 쓴다.
// /reviews 라우트가 ?status=&q= 쿼리를 받게 되면 이 두 함수를 지우고 useSearchParams로 바꾸면 된다.

export type StatusChip = 'ALL' | 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'REVIEW_REQUESTED';

export interface ReviewTablePrefilter {
  status: StatusChip;
  query?: string;
  companyFilter?: string;
}

const PREFILTER_KEY = 'jobreview.reviewTable.prefilter';

export function setReviewTablePrefilter(prefilter: ReviewTablePrefilter) {
  try {
    sessionStorage.setItem(PREFILTER_KEY, JSON.stringify(prefilter));
  } catch {
    /* 저장이 막힌 브라우저면 필터 없이 열린다. */
  }
}

/** 한 번 읽고 지운다(뒤로 갔다 다시 와도 옛 필터가 되살아나지 않게). */
function takePrefilter(): ReviewTablePrefilter | null {
  try {
    const raw = sessionStorage.getItem(PREFILTER_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILTER_KEY);
    return JSON.parse(raw) as ReviewTablePrefilter;
  } catch {
    return null;
  }
}

// ── 표시용 상수 ─────────────────────────────────────────────────────

const CHIPS: { key: StatusChip; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'NOT_STARTED', label: '미시작' },
  { key: 'IN_PROGRESS', label: '작성 중' },
  { key: 'SUBMITTED', label: '제출' },
  { key: 'REVIEW_REQUESTED', label: '재검토 요청' },
];

/** '제출' 칩은 제출 완료와 재제출 완료를 함께 센다(대시보드 KPI와 같은 기준). */
function matchesChip(status: string, chip: StatusChip) {
  if (chip === 'ALL') return true;
  if (chip === 'SUBMITTED') return status === 'SUBMITTED' || status === 'RESUBMITTED';
  return status === chip;
}

const STATUS_RANK: Record<string, number> = {
  REVIEW_REQUESTED: 0,
  IN_PROGRESS: 1,
  NOT_STARTED: 2,
  SUBMITTED: 3,
  RESUBMITTED: 4,
};

const SECTION_LABEL: Record<JobFeedbackSection, string> = {
  NAME: '직무명',
  DEFINITION: '직무 정의',
  REQ_EDUCATION: '요구 학력',
  REQ_MAJOR: '요구 전공',
  REQ_CERTIFICATIONS: '요구 자격증',
};

type SortKey = 'sme' | 'job' | 'status' | 'submitted';

const PAGE_SIZE = 20;

/** 1 … 4 5 6 … 12 형태. 항상 첫 장·마지막 장과 현재 앞뒤 1장을 남긴다. */
function pageItems(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const keep = new Set([1, totalPages, current, current - 1, current + 1]);
  const items: (number | '…')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (keep.has(p)) items.push(p);
    else if (items[items.length - 1] !== '…') items.push('…');
  }
  return items;
}

export function ReviewTable({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const prefilter = useRef<ReviewTablePrefilter | null>(takePrefilter()).current;

  const [query, setQuery] = useState(prefilter?.query ?? '');
  const [chip, setChip] = useState<StatusChip>(prefilter?.status ?? 'ALL');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'status', asc: true });
  const [page, setPage] = useState(1);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [reviewRows, setReviewRows] = useState<ReviewStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [detailRow, setDetailRow] = useState<ReviewStatusRow | null>(null);

  // 대시보드에서 넘어왔다면 그쪽 회사 필터를 그대로 이어받는다.
  useEffect(() => {
    if (prefilter?.companyFilter && prefilter.companyFilter !== companyFilter)
      setCompanyFilter(prefilter.companyFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await fetchReviewStatusResult(companyFilter === 'all' ? null : companyFilter);
      if (cancelled) return;
      if (result.ok) {
        setReviewRows(result.data);
        setError('');
      } else {
        setReviewRows([]);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilter, reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = reviewRows.filter(
      (r) =>
        matchesChip(r.review_status, chip) &&
        (!q || `${r.sme_name}${r.organization}${r.job_name}`.toLowerCase().includes(q)),
    );
    const dir = sort.asc ? 1 : -1;
    const value = (r: ReviewStatusRow) => {
      if (sort.key === 'sme') return r.sme_name || '';
      if (sort.key === 'job') return r.job_name || '';
      if (sort.key === 'status') return String(STATUS_RANK[r.review_status] ?? 9);
      return r.submitted_at || '';
    };
    return [...rows].sort((a, b) => value(a).localeCompare(value(b), 'ko') * dir);
  }, [reviewRows, query, chip, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // 조건이 바뀌면 1페이지로 되돌린다(3페이지에서 필터를 좁히면 빈 화면이 되는 문제).
  useEffect(() => {
    setPage(1);
  }, [query, chip, companyFilter, sort]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
  }, []);

  // 컴포넌트가 아니라 함수로 호출한다(렌더마다 새 컴포넌트가 되면 정렬 버튼이 다시 마운트돼 포커스를 잃는다).
  const sortHeader = (label: string, sortKey: SortKey, className = '') => (
    <th
      key={sortKey}
      scope="col"
      className={`px-5 py-3 font-medium ${className}`}
      aria-sort={sort.key === sortKey ? (sort.asc ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-primary"
      >
        {label}
        {sort.key === sortKey ? (
          sort.asc ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : (
            <ArrowDown size={12} aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            {loading ? '불러오는 중…' : error ? '조회 실패' : `총 ${filtered.length}건`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">SME별 검토 현황</h2>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        </div>
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

      <div className="rounded-container border border-border bg-card shadow-1">
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-foreground-subtle" size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-9"
              placeholder="SME 이름, 조직, 직무 검색"
              aria-label="SME 이름, 조직, 직무 검색"
            />
          </div>
          <FilterChips
            label="검토 상태 필터"
            value={chip}
            onChange={setChip}
            options={CHIPS.map(({ key, label }) => ({
              value: key,
              label,
              // 조회 실패·로딩 중에는 건수를 숨긴다 — 0으로 보이면 "없다"는 다른 사실이 된다.
              count:
                loading || error
                  ? undefined
                  : key === 'ALL'
                    ? reviewRows.length
                    : reviewRows.filter((r) => matchesChip(r.review_status, key)).length,
            }))}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-xs text-foreground-muted">
                {sortHeader('SME', 'sme', 'sticky left-0 z-10 bg-muted')}
                <th scope="col" className="px-5 py-3 font-medium">
                  조직 / 직급
                </th>
                {sortHeader('담당 직무', 'job')}
                {sortHeader('검토상태', 'status')}
                {sortHeader('제출일', 'submitted')}
                <th scope="col" className="px-5 py-3 font-medium">
                  평가 결과
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  검토 내용
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-foreground-subtle">
                    불러오는 중…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-destructive">
                    검토 현황을 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요.
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-foreground-subtle">
                    {reviewRows.length === 0
                      ? '검토 대상이 없습니다. 직무정보를 업로드하고 SME에게 배정해 주세요.'
                      : '조건에 맞는 검토가 없어요. 상태 필터나 검색어를 바꿔 보세요.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <tr
                    className="group cursor-pointer border-b border-border last:border-0 hover:bg-primary-subtle"
                    key={r.review_id || `${r.sme_id}-${r.job_id}`}
                    onClick={() => setDetailRow(r)}
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-card px-5 py-4 text-left font-normal group-hover:bg-primary-subtle"
                    >
                      <p className="font-medium text-foreground">{r.sme_name}</p>
                      <p className="mt-1 text-xs text-foreground-subtle">{r.sme_email}</p>
                    </th>
                    <td className="px-5 py-4 text-foreground-muted">
                      {r.organization}
                      <br />
                      <span className="text-xs text-foreground-subtle">{r.title}</span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-foreground">{r.job_name}</p>
                      <p className="mt-1 text-xs text-foreground-subtle">
                        {r.group_name} · {r.series_name}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={mapReviewStatus(r.review_status)} />
                    </td>
                    <td className="px-5 py-4 text-foreground-muted">
                      {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('ko-KR') : '-'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2 text-xs">
                        <span className="text-success">적합 {r.suitable_count}</span>
                        <span className="text-warning">수정 {r.needs_edit_count}</span>
                        <span className="text-destructive">부적합 {r.unsuitable_count}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailRow(r);
                        }}
                      >
                        보기
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && !error && filtered.length > PAGE_SIZE && (
          <nav
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"
            aria-label="검토 현황 페이지"
          >
            <p className="text-xs text-foreground-subtle">
              {filtered.length}건 중 {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)}건
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label="이전 페이지"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </Button>
              {pageItems(current, totalPages).map((item, i) =>
                item === '…' ? (
                  <span key={`gap-${i}`} className="px-2 text-xs text-foreground-subtle" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    variant={item === current ? 'primary' : 'ghost'}
                    size="sm"
                    aria-label={`${item}페이지`}
                    aria-current={item === current ? 'page' : undefined}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </Button>
                ),
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label="다음 페이지"
                disabled={current === totalPages}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </nav>
        )}
      </div>

      {detailRow && <ReviewDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </>
  );
}

// ── 검토 내용 요약 패널 ─────────────────────────────────────────────
// 담당 4가 JobDetailPage에 만드는 SME 피드백 패널로 통합 필요.
// 여기서는 항목 이름(과업·스킬 명칭)까지 다시 조회하지 않고 저장된 개수와 직무 항목 의견만 보여준다.

function ReviewDetailModal({ row, onClose }: { row: ReviewStatusRow; onClose: () => void }) {
  const [data, setData] = useState<ReviewFeedbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!row.review_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchReviewFeedback(row.review_id)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '검토 내용을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.review_id]);

  const jobFeedback = (data?.job || []).filter((f) => f.suitability || f.comment || f.suggestion);

  return (
    <ModalShell
      title={`${row.sme_name} · ${row.job_name}`}
      description={`${row.group_name} · ${row.series_name} · ${mapReviewStatus(row.review_status)}`}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-foreground-subtle">불러오는 중…</p>
      ) : error ? (
        <p className="flex items-start gap-2 border border-destructive-border bg-destructive-muted p-3 text-sm text-destructive">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error} 잠시 후 다시 열어 주세요.</span>
        </p>
      ) : !row.review_id || !data ? (
        <p className="py-6 text-center text-sm text-foreground-subtle">
          아직 검토를 시작하지 않았어요. SME가 저장하면 내용이 표시됩니다.
        </p>
      ) : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['직무 항목 의견', jobFeedback.length],
              ['과업 의견', data.tasks.length],
              ['스킬 의견', data.skills.length],
              ['신규 제안', data.newTasks.length + data.newSkills.length],
            ].map(([label, n]) => (
              <div key={label as string} className="border border-border bg-muted p-3">
                <dt className="text-xs text-foreground-muted">{label}</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">{n}</dd>
              </div>
            ))}
          </dl>

          {jobFeedback.length === 0 ? (
            <p className="text-foreground-subtle">직무 항목에 남긴 의견이 없어요.</p>
          ) : (
            <ul className="space-y-3">
              {jobFeedback.map((f) => (
                <li key={f.section} className="border border-border p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <b className="text-foreground">{SECTION_LABEL[f.section] || f.section}</b>
                    <span className="text-xs text-foreground-muted">
                      {toSuitabilityLabel(f.suitability) || '판단 없음'}
                    </span>
                  </p>
                  {f.comment && <p className="mt-2 whitespace-pre-wrap text-foreground-muted">{f.comment}</p>}
                  {f.suggestion && (
                    <p className="mt-2 whitespace-pre-wrap border-l-2 border-primary-border pl-3 text-foreground-muted">
                      제안: {f.suggestion}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-foreground-subtle">
            과업·스킬별 상세 의견은 직무정보 관리 화면의 직무 상세에서 확인할 수 있어요.
          </p>
        </div>
      )}
    </ModalShell>
  );
}
