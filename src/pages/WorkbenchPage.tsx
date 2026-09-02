// 검토 워크벤치 — 제출 큐(§6-3 ⓑ). 제출이 있는 직무 목록에서 비교 뷰(/workbench/:jobId)로 들어간다.
// 조회·계산은 전부 src/lib/adminApi.ts에 있다. 이 파일은 그 결과를 표로 그리기만 한다.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, RotateCw, Users } from 'lucide-react';
import { fetchCompanies, type Company } from '@/lib/jobApi';
import { fetchSubmissionQueue, type SubmissionQueueItem } from '@/lib/adminApi';
import { workshopDecisionOf } from '@/lib/workshopRules';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { SectionMessage } from '@/components/ui/SectionMessage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';

/**
 * 정렬(§6-3 ⓑ "정렬: 이견 신호 → 제출일").
 * 신호 수가 같으면 먼저 제출된 직무를 위로 올린다 — 오래 기다린 검토가 먼저 보여야 한다.
 * 제출일이 없는 행(있을 수 없지만 방어)은 맨 뒤로 보낸다.
 */
export function byQueueOrder(a: SubmissionQueueItem, b: SubmissionQueueItem) {
  if (a.signalCount !== b.signalCount) return b.signalCount - a.signalCount;
  return (a.submittedAt || '9999').localeCompare(b.submittedAt || '9999');
}

const formatDate = (value: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ko-KR');
};

/** 신호를 종류별로 묶는다. 배지 문구는 adminApi가 붙여 준 label을 그대로 쓴다(임계값 숫자를 화면이 다시 적지 않는다). */
function groupSignals(item: SubmissionQueueItem): { label: string; count: number }[] {
  const byLabel = new Map<string, number>();
  for (const s of item.signals) byLabel.set(s.label, (byLabel.get(s.label) ?? 0) + 1);
  return [...byLabel].map(([label, count]) => ({ label, count }));
}

export function WorkbenchPage({
  companyFilter,
  setCompanyFilter,
  onOpenJob,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
  /** 행 클릭 → /workbench/:jobId. 라우팅은 App.tsx가 맡는다(다른 관리자 화면과 같은 방식). */
  onOpenJob: (jobId: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [items, setItems] = useState<SubmissionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await fetchSubmissionQueue(companyFilter === 'all' ? null : companyFilter);
      if (cancelled) return;
      // 실패를 "0건"으로 위장하지 않는다 — 목록을 비우고 사유를 그대로 띄운다(jobApi.ts 상단 원칙).
      if (result.ok) {
        setItems(result.data);
        setError('');
      } else {
        setItems([]);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilter, reloadKey]);

  const rows = useMemo(() => [...items].sort(byQueueOrder), [items]);

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            {loading ? '불러오는 중…' : error ? '조회 실패' : `총 ${rows.length}건`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">제출 큐</h2>
        </div>
        <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
      </div>

      {error && (
        <SectionMessage
          variant="negative"
          className="mb-5"
          heading="제출 큐를 불러오지 못했어요"
          action={
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RotateCw size={14} aria-hidden="true" /> 다시 시도
            </Button>
          }
        >
          {error} 잠시 후 다시 시도해 주세요.
        </SectionMessage>
      )}

      <p className="mb-2 t-caption text-foreground-subtle">
        제출이 있는 직무 목록입니다. 이견 신호가 많은 순, 신호 수가 같으면 먼저 제출된 순으로 정렬합니다.
      </p>

      {loading ? (
        <Skeleton.Table rows={5} cols={5} />
      ) : error ? null : (
        // v2 §6-5: 공용 DataTable — 좁은 화면에서는 줄 목록으로 쌓인다.
        <DataTable
          caption="제출 큐 — 제출이 있는 직무 목록"
          minWidth="900px"
          rows={rows}
          rowKey={(item) => item.jobId}
          onRowClick={(item) => onOpenJob(item.jobId)}
          empty={
            <FallbackView
              heading="아직 제출된 검토가 없어요"
              description="SME가 제출하면 이 목록에 나타나요. 진행 상황은 「진행 현황」에서 볼 수 있어요."
            />
          }
          columns={[
            {
              key: 'job',
              header: '직무',
              sticky: true,
              mobile: 'title',
              cell: (item) => (
                <>
                  <p className="font-medium text-foreground">{item.jobName}</p>
                  <p className="mt-1 t-caption text-foreground-subtle">
                    {item.groupName} · {item.seriesName}
                  </p>
                </>
              ),
            },
            {
              key: 'submitted',
              header: '제출일',
              className: 'whitespace-nowrap',
              cell: (item) => formatDate(item.submittedAt),
            },
            {
              key: 'sme',
              header: 'SME',
              className: 'whitespace-nowrap',
              cell: (item) => (
                <span className="inline-flex items-center gap-1.5">
                  <Users size={14} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
                  {item.submittedSmeCount}/{item.assignedSmeCount}명 제출
                </span>
              ),
            },
            {
              key: 'signals',
              header: '이견 신호',
              mobile: 'trailing',
              cell: (item) => <SignalCell item={item} />,
            },
            { key: 'workshop', header: '워크숍 후보', cell: (item) => <WorkshopCell item={item} /> },
            {
              key: 'approved',
              header: '승인',
              className: 'whitespace-nowrap',
              cell: (item) => `${item.approvedSmeCount}/${item.submittedSmeCount} 승인`,
            },
            {
              key: 'compare',
              header: '비교',
              mobile: 'trailing',
              cell: (item) => (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`${item.jobName} SME 응답 비교 열기`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenJob(item.jobId);
                  }}
                >
                  비교 <ChevronRight size={14} aria-hidden="true" />
                </Button>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

/** 이견 신호 칸 — 색만으로 알리지 않도록 아이콘·건수·사유 문구를 함께 적는다. */
function SignalCell({ item }: { item: SubmissionQueueItem }) {
  const groups = groupSignals(item);
  if (item.signalCount === 0) return <span className="t-caption text-foreground-subtle">없음</span>;
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit items-center gap-1 rounded-inner border border-destructive-border bg-destructive-muted px-2 py-1 t-caption font-medium text-destructive">
        <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
        이견 신호 {item.signalCount}건
      </span>
      <span className="t-caption leading-5 text-foreground-muted">
        {groups.map((g) => `${g.label} ${g.count}`).join(' · ')}
      </span>
    </div>
  );
}

/**
 * 워크숍 후보 칸. 네 상태를 구분해서 적는다(판정은 workshopRules.workshopDecisionOf 하나로 한다 —
 * 비교 뷰 헤더와 같은 함수다).
 *  ① 지정됨 ② 사람이 해제함 ③ 자동 규칙에 걸렸지만 아직 지정 전 ④ 해당 없음.
 * 사유 문구는 adminApi·workshopThresholds가 만든 것을 그대로 쓴다.
 */
function WorkshopCell({ item }: { item: SubmissionQueueItem }) {
  const state = workshopDecisionOf(
    item.workshopSource ? { flagged: item.workshopFlagged, source: item.workshopSource } : null,
    item.autoReasons,
  );

  if (state === 'FLAGGED') {
    const reasons = item.workshopReasons.length > 0 ? item.workshopReasons : item.autoReasons;
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center gap-1 rounded border border-primary-border bg-primary-subtle px-2 py-1 text-[11px] font-medium text-primary">
          워크숍 후보 · {item.workshopSource === 'MANUAL' ? '수동 지정' : '자동 규칙'}
        </span>
        {reasons.length > 0 && (
          <span className="text-[11px] leading-5 text-foreground-muted">{reasons.join(' · ')}</span>
        )}
      </div>
    );
  }
  if (state === 'MANUAL_CLEARED') {
    // 사람이 내린 해제는 자동 규칙이 다시 걸려도 그대로 둔다. 자동 판정은 참고로만 덧붙인다.
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-[11px] font-medium text-foreground-muted">
          대상 아님 · 수동 해제
        </span>
        {item.autoReasons.length > 0 && (
          <span className="text-[11px] leading-5 text-foreground-muted">
            자동 규칙 {item.autoReasons.length}건 해당(참고) · {item.autoReasons.join(' · ')}
          </span>
        )}
      </div>
    );
  }
  if (state === 'AUTO_PENDING') {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center gap-1 rounded border border-warning-border bg-warning-muted px-2 py-1 text-[11px] font-medium text-warning">
          자동 규칙 해당 · 지정 전
        </span>
        <span className="text-[11px] leading-5 text-foreground-muted">{item.autoReasons.join(' · ')}</span>
      </div>
    );
  }
  return <span className="text-xs text-foreground-subtle">해당 없음</span>;
}

export default WorkbenchPage;
