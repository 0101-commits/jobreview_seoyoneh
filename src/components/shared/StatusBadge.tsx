// 검토 상태 배지 — 관리자(ADMIN) 검토 현황과 SME 검토 이력이 함께 사용한다.
import type { Status } from '@/types';

const statusStyle: Record<Status, string> = {
  미시작: 'bg-slate-100 text-slate-600',
  '작성 중': 'bg-amber-50 text-amber-700',
  '제출 완료': 'bg-emerald-50 text-emerald-700',
  '재검토 요청': 'bg-rose-50 text-rose-700',
  '재제출 완료': 'bg-blue-50 text-blue-700',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium ${statusStyle[status]}`}>
      {status}
    </span>
  );
}
