// 검토 이력 — SME 화면. 본인이 작성한 검토 기록만 보여 준다.
// 제출 → 재검토 요청 → 재제출 왕복은 review_history를 타임라인으로 펼친다.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox } from 'lucide-react';
import { fetchReviewStatusResult, mapReviewStatus, type ReviewStatusRow } from '@/lib/jobApi';
import { supabase } from '@/lib/supabase';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import type { User } from '@/types';

type HistoryEvent = { id: string; review_id: string; action: string; note: string; created_at: string };

const ACTION_LABEL: Record<string, string> = {
  IN_PROGRESS: '작성 중으로 변경',
  SUBMITTED: '검토 제출',
  REVIEW_REQUESTED: '재검토 요청 받음',
  RESUBMITTED: '재제출',
};

function formatAt(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

/** 내 검토들의 이력을 한 번에 읽는다. RLS가 본인 기록만 내려 준다. */
async function fetchHistory(reviewIds: string[]): Promise<HistoryEvent[]> {
  if (!supabase || reviewIds.length === 0) return [];
  const { data, error } = await supabase
    .from('review_history')
    .select('id, review_id, action, note, created_at')
    .in('review_id', reviewIds)
    .order('created_at', { ascending: true });
  if (error) throw new Error('제출 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return (data || []) as HistoryEvent[];
}

export function HistoryPage({ user }: { user: User }) {
  const [rows, setRows] = useState<ReviewStatusRow[]>([]);
  const [events, setEvents] = useState<Record<string, HistoryEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setHistoryError('');
    const res = await fetchReviewStatusResult(user.company_id ?? null);
    if (!res.ok) {
      setRows([]);
      setEvents({});
      setError(res.error);
      setLoading(false);
      return;
    }
    // 서버(RPC)도 본인 기준으로 막혀 있지만, 화면에서도 본인 것만 남긴다.
    const mine = res.data.filter((r) => r.sme_id === user.id);
    setRows(mine);
    setLoading(false);

    try {
      const list = await fetchHistory(mine.map((r) => r.review_id).filter((id): id is string => !!id));
      const grouped: Record<string, HistoryEvent[]> = {};
      for (const e of list) (grouped[e.review_id] ||= []).push(e);
      setEvents(grouped);
    } catch (e) {
      setEvents({});
      setHistoryError(e instanceof Error ? e.message : '제출 이력을 불러오지 못했습니다.');
    }
  }, [user.id, user.company_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="mb-6">
        <p className="mb-1 text-sm text-foreground-subtle">
          내가 작성한 검토 기록{user.company_name && ` · ${user.company_name}`}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">검토 이력</h2>
      </div>

      {loading ? (
        <Skeleton.Card count={2} />
      ) : error ? (
        <div className="rounded-container border border-destructive-border bg-destructive-muted p-6 text-center">
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
          <p className="text-sm font-medium text-foreground">검토 이력이 없습니다</p>
          <p className="mt-1 text-xs text-foreground-muted">내 검토 목록에서 배정된 직무를 먼저 검토해 주세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {historyError && (
            <p className="rounded-element border border-warning-border bg-warning-muted px-4 py-2 text-xs text-warning">
              {historyError}
            </p>
          )}
          {rows.map((r) => (
            <div className="rounded-container border border-border bg-card p-5 shadow-1" key={r.review_id || r.job_id}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">{r.job_name}</h3>
                    <StatusBadge status={mapReviewStatus(r.review_status)} />
                  </div>
                  <p className="mt-2 text-sm text-foreground-muted">
                    {r.group_name} · {r.series_name}
                  </p>
                  <p className="mt-1 text-xs text-foreground-subtle">최종 제출일 {formatAt(r.submitted_at)}</p>
                </div>
                <Link
                  to={`/review/${r.job_id}`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-element border border-border px-4 text-xs font-medium text-foreground-muted transition hover:border-primary hover:text-primary sm:min-h-control-sm"
                >
                  검토내용 보기
                </Link>
              </div>

              <Timeline events={(r.review_id && events[r.review_id]) || []} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Timeline({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0)
    return <p className="mt-4 border-t border-border pt-3 text-xs text-foreground-subtle">아직 제출 이력이 없어요.</p>;

  return (
    <ol className="mt-4 space-y-3 border-t border-border pt-4 pl-4">
      {events.map((e, i) => (
        <li key={e.id} className="relative pl-4">
          {i < events.length - 1 && (
            <span className="absolute -left-[1px] top-3 h-full w-px bg-border" aria-hidden="true" />
          )}
          <span
            className="absolute -left-[4px] top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-card"
            aria-hidden="true"
          />
          <p className="text-xs font-medium text-foreground">{ACTION_LABEL[e.action] || e.action}</p>
          <p className="text-[11px] text-foreground-subtle">{formatAt(e.created_at)}</p>
          {e.note && <p className="mt-1 text-xs text-foreground-muted">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}
