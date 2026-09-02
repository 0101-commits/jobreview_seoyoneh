/*
 * Skeleton — 불러오는 동안의 자리표시(montage Skeleton 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: "불러오는 중…" 텍스트가 20곳 넘게 있었다. 표가 통째로 사라졌다가 나타나
 * 화면이 튀고, 얼마나 기다려야 하는지도 알 수 없었다.
 *
 * montage 규약: pulse 2초, 실제로 올 내용과 같은 모양·같은 자리. 정적 요소에는 쓰지 않는다.
 * prefers-reduced-motion에서는 index.css가 애니메이션을 0.01ms로 줄인다(전역 규칙).
 */
const BASE = 'animate-pulse bg-fill-alt';

function Line({ className = '' }: { className?: string }) {
  return <span className={`block h-3 rounded-inner ${BASE} ${className}`} />;
}

/** 표 자리표시 — 머리 한 줄 + 본문 n줄. 실제 표와 같은 열 수를 주면 폭이 튀지 않는다. */
function Table({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="표를 불러오는 중" className="overflow-hidden rounded-container border border-border">
      <div className="flex gap-4 border-b border-border bg-fill-alt px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Line key={i} className="flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 px-4 py-4">
            {Array.from({ length: cols }, (_, c) => (
              <Line key={c} className="flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 카드 자리표시 — KPI·요약 카드 줄에 쓴다. */
function Card({ count = 1, className = '' }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="불러오는 중" className={`grid gap-4 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-container border border-border bg-card p-5">
          <Line className="w-24" />
          <Line className="mt-3 h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

/** 문단 자리표시 — 상세 패널·본문에 쓴다. */
function Text({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="불러오는 중" className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Line key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

export const Skeleton = { Line, Table, Card, Text };

export default Skeleton;
