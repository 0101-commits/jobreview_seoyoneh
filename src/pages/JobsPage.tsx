// 직무정보 관리 — 관리자(ADMIN) 화면. 직무 목록(표·검색·정렬)과 엑셀 내보내기, 행 클릭 시 상세로 전환.
// 100건이 넘으면 카드로는 훑을 수 없어 표로 바꿨고, 상태를 읽지 않던 '활성' 하드코딩 배지는
// 실제 검토 진행 상태 열로 대체했다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  FileSpreadsheet,
  RotateCw,
  Search,
} from 'lucide-react';
import {
  exportAllJobsToExcel,
  fetchAllJobsResult,
  fetchReviewStatusResult,
  mapReviewStatus,
  type JobListItem,
} from '@/lib/jobApi';
import { fetchCompanies, type Company } from '@/lib/jobApi';
import { JobDetailPage } from '@/components/JobDetailPage';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
// shared/StatusBadge는 검토 상태(Status)로 타입이 좁혀져 있어 '미배정'이 들어가지 않는다.
// 사전은 ui/StatusBadge 한 곳이므로 여기서는 그것을 직접 쓴다(색·라벨은 같다).
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FallbackView } from '@/components/ui/FallbackView';
import { SectionMessage } from '@/components/ui/SectionMessage';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Status } from '@/types';

type ReviewLabel = Status | '미배정';

interface JobRow extends JobListItem {
  reviewLabel: ReviewLabel;
  assigned: number;
  submitted: number;
}

// 정렬용 순서 — 진행이 덜 된 직무를 먼저 보게 한다.
const LABEL_RANK: Record<ReviewLabel, number> = {
  미배정: 0,
  미시작: 1,
  '작성 중': 2,
  '재검토 요청': 3,
  '재제출 완료': 4,
  '제출 완료': 5,
};

type SortKey = 'name' | 'group_name' | 'series_name' | 'review';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: '직무명' },
  { key: 'group_name', label: '직군' },
  { key: 'series_name', label: '직렬' },
  { key: 'review', label: '검토 진행 상태' },
];

export function JobsPage({
  userId,
  selectedJobId: controlledJobId,
  onSelectJob,
  companyFilter,
  setCompanyFilter,
  focusSmeId,
}: {
  userId: string;
  /** 라우터 연결(담당 2) 후에는 URL이 원천이 된다. 주지 않으면 내부 상태로 동작한다. */
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string | null) => void;
  /** 공통 회사 필터(App 보유). 'all'이면 전 회사 직무를 함께 본다 — v2 F4로 회사명 하드코딩을 걷어냈다. */
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
  /** 검토 현황에서 넘어온 SME — 상세의 피드백 패널이 그 카드로 스크롤한다(v2 §6-5). */
  focusSmeId?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statusWarning, setStatusWarning] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });
  const [internalJobId, setInternalJobId] = useState<string | null>(null);

  // 'all'은 전 회사다(회사 없이 조회하면 서버가 전체를 준다).
  const companyId = companyFilter === 'all' ? null : companyFilter;
  const selectedJobId = controlledJobId !== undefined ? controlledJobId : internalJobId;
  const selectJob = useCallback(
    (jobId: string | null) => {
      if (onSelectJob) onSelectJob(jobId);
      if (controlledJobId === undefined) setInternalJobId(jobId);
    },
    [onSelectJob, controlledJobId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setStatusWarning('');

    const jobs = await fetchAllJobsResult(companyId);
    if (!jobs.ok) {
      // 조회 실패를 '등록된 직무 0건'으로 보여 주지 않는다.
      setRows([]);
      setLoadError(`직무 목록을 불러오지 못했어요. (${jobs.error}) 잠시 후 다시 시도해 주세요.`);
      setLoading(false);
      return;
    }

    const statuses = await fetchReviewStatusResult(companyId);
    const byJob = new Map<string, { assigned: number; submitted: number; started: number; rereview: number }>();
    if (statuses.ok) {
      for (const r of statuses.data) {
        const acc = byJob.get(r.job_id) ?? { assigned: 0, submitted: 0, started: 0, rereview: 0 };
        const label = mapReviewStatus(r.review_status);
        acc.assigned++;
        if (label === '제출 완료' || label === '재제출 완료') acc.submitted++;
        if (label !== '미시작') acc.started++;
        if (label === '재검토 요청') acc.rereview++;
        byJob.set(r.job_id, acc);
      }
    } else {
      setStatusWarning(`검토 진행 상태를 불러오지 못했어요. (${statuses.error}) 직무 목록만 표시합니다.`);
    }

    setRows(
      jobs.data.map((j) => {
        const acc = byJob.get(j.id);
        let reviewLabel: ReviewLabel = '미배정';
        if (acc && acc.assigned > 0) {
          if (acc.rereview > 0) reviewLabel = '재검토 요청';
          else if (acc.submitted === acc.assigned) reviewLabel = '제출 완료';
          else if (acc.started > 0) reviewLabel = '작성 중';
          else reviewLabel = '미시작';
        }
        return { ...j, reviewLabel, assigned: acc?.assigned ?? 0, submitted: acc?.submitted ?? 0 };
      }),
    );
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((j) => `${j.group_name}${j.series_name}${j.name}`.toLowerCase().includes(q))
      : rows.slice();
    list.sort((a, b) => {
      const diff =
        sort.key === 'review'
          ? LABEL_RANK[a.reviewLabel] - LABEL_RANK[b.reviewLabel]
          : String(a[sort.key]).localeCompare(String(b[sort.key]), 'ko');
      return sort.asc ? diff : -diff;
    });
    return list;
  }, [rows, query, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, asc: !prev.asc } : { key, asc: true }));
  }

  if (selectedJobId) {
    // 직군·직렬 후보와 중복 검사는 그 직무가 속한 회사 기준이어야 한다('전체' 필터에서도).
    const jobCompanyId = rows.find((r) => r.id === selectedJobId)?.company_id ?? companyId;
    return (
      <JobDetailPage
        jobId={selectedJobId}
        onBack={() => selectJob(null)}
        userId={userId}
        companyId={jobCompanyId}
        focusSmeId={focusSmeId}
      />
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            총 {rows.length}개 직무{query && ` · 검색 결과 ${visible.length}개`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">직무정보 관리</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
          <Button variant="secondary" onClick={() => exportAllJobsToExcel(companyId)} disabled={loading}>
            <Download size={16} aria-hidden="true" /> 전체 직무정보 다운로드
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-3 text-foreground-subtle" size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="직무명, 직군, 직렬 검색"
              aria-label="직무 검색"
              className="input w-full pl-10 md:w-72"
            />
          </div>
        </div>
      </div>

      {statusWarning && (
        <SectionMessage variant="cautionary" className="mb-4">
          {statusWarning}
        </SectionMessage>
      )}

      {loading ? (
        <Skeleton.Table rows={6} cols={4} />
      ) : loadError ? (
        <FallbackView
          kind="error"
          heading="직무 목록을 불러오지 못했어요"
          description={loadError}
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              <RotateCw size={14} aria-hidden="true" /> 다시 불러오기
            </Button>
          }
        />
      ) : (
        // v2 §6-5: 공용 DataTable — 좁은 화면에서는 줄 목록(ListCell)으로 쌓인다.
        // 정렬은 이 화면의 사정이라 헤더에 버튼을 그대로 넣어 전달한다.
        <DataTable
          caption="등록된 직무 목록"
          minWidth="760px"
          rows={visible}
          rowKey={(j) => j.id}
          onRowClick={(j) => selectJob(j.id)}
          empty={
            <FallbackView
              icon={<FileSpreadsheet size={28} aria-hidden="true" />}
              heading={query ? '검색 조건에 맞는 직무가 없어요' : '등록된 직무가 없어요'}
              description={
                query
                  ? '검색어를 바꾸거나 회사 필터를 확인해 주세요.'
                  : "'직무정보 업로드'에서 Excel 파일로 직무를 등록할 수 있어요."
              }
            />
          }
          columns={SORT_COLUMNS.map((col) => {
            const activeSort = sort.key === col.key;
            const Icon = !activeSort ? ChevronsUpDown : sort.asc ? ArrowUp : ArrowDown;
            const header = (
              <button
                type="button"
                onClick={() => toggleSort(col.key)}
                aria-label={`${col.label} 기준으로 정렬`}
                className="inline-flex items-center gap-1 rounded-inner transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {col.label}
                <Icon size={13} aria-hidden="true" className={activeSort ? 'text-primary' : 'opacity-50'} />
              </button>
            );
            if (col.key === 'name')
              return {
                key: col.key,
                header,
                mobile: 'title' as const,
                cell: (j: JobRow) => <span className="font-semibold text-foreground">{j.name}</span>,
              };
            if (col.key === 'review')
              return {
                key: col.key,
                header,
                mobile: 'trailing' as const,
                cell: (j: JobRow) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={j.reviewLabel} />
                    {j.assigned > 0 && (
                      <span className="t-caption text-foreground-subtle">
                        제출 {j.submitted}/{j.assigned}명
                      </span>
                    )}
                  </div>
                ),
              };
            return {
              key: col.key,
              header,
              cell: (j: JobRow) => (col.key === 'group_name' ? j.group_name : j.series_name),
            };
          })}
        />
      )}
    </>
  );
}
