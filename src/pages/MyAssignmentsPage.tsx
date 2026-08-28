// 내 검토 목록 — SME 홈. 관리자가 나에게 배정한 직무만 보여 준다.
// 회사 전체 직무를 훑어 첫 번째를 임의로 고르던 자리를 대신한다.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import { fetchMyAssignments, type MyAssignment } from '@/lib/reviewApi';
import { mapReviewStatus } from '@/lib/jobApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/Button';
import type { User } from '@/types';

function formatSavedAt(value: string | null) {
  if (!value) return '아직 저장한 내용이 없어요';
  return `마지막 저장 ${new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function MyAssignmentsPage({ user }: { user: User }) {
  const [rows, setRows] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <>
      <div className="mb-6">
        <p className="mb-1 text-sm text-foreground-subtle">
          나에게 배정된 직무{user.company_name && ` · ${user.company_name}`}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">내 검토 목록</h2>
      </div>

      {loading ? (
        <div className="py-12 text-center text-foreground-subtle">불러오는 중…</div>
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
          <p className="text-sm font-medium text-foreground">배정된 직무가 없습니다</p>
          <p className="mt-1 text-xs text-foreground-muted">관리자에게 문의해 주세요.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.assignment_id}>
              <Link
                to={`/review/${r.job_id}`}
                className="flex min-h-11 items-center justify-between gap-4 rounded-container border border-border bg-card p-5 shadow-sm transition hover:border-primary-border hover:bg-primary-subtle"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">{r.job_name}</h3>
                    <StatusBadge status={mapReviewStatus(r.status)} />
                  </div>
                  <p className="mt-2 truncate text-sm text-foreground-muted">
                    {r.group_name} · {r.series_name}
                  </p>
                  <p className="mt-1 text-xs text-foreground-subtle">{formatSavedAt(r.last_saved_at)}</p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
