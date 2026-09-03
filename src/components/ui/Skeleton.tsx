/*
 * Skeleton — 불러오는 동안의 자리표시(montage Skeleton 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: "불러오는 중…" 텍스트가 20곳 넘게 있었다. 표가 통째로 사라졌다가 나타나
 * 화면이 튀고, 얼마나 기다려야 하는지도 알 수 없었다.
 *
 * montage 규약: pulse 2초, 실제로 올 내용과 같은 모양·같은 자리. 정적 요소에는 쓰지 않는다.
 * prefers-reduced-motion에서는 index.css가 애니메이션을 0.01ms로 줄인다(전역 규칙).
 * 펄스 값(2초 ease-in-out · 불투명도 0.5↔1)은 Tailwind animate-pulse와 정확히 같아 그대로 쓴다.
 *
 * v3 T3 — 줄 높이를 12px에서 montage text 규격 22px로 올렸다. 실제로 올 텍스트가 20px 행간인데
 * 자리표시가 그 절반이라 로딩이 끝나는 순간 화면이 튀었다. Circle도 함께 넣었다 —
 * SME 목록·담당자 이니셜 자리에 쓸 원형이 없어 그 자리만 사각형으로 그려졌다.
 */
const BASE = 'animate-pulse bg-fill-alt';

/** 텍스트 한 줄 자리. 높이 22px는 montage text 규격이다. */
function Line({ className = '' }: { className?: string }) {
  return <span className={`block h-[22px] rounded-inner ${BASE} ${className}`} />;
}

/** 아바타·이니셜 자리. size는 지름(px). */
function Circle({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`block shrink-0 rounded-full ${BASE} ${className}`}
      style={{ width: size, height: size }}
    />
  );
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

export const Skeleton = { Line, Circle, Table, Card, Text };

export default Skeleton;
