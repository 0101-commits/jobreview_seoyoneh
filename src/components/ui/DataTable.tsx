/*
 * DataTable + ListCell — 표 한 벌(montage Table / ListCell 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: 표가 여덟 화면에 있는데 sticky 열·최소 폭·헤더 색·빈 상태가 제각각이었고,
 * 모바일 대응은 비교 뷰 한 곳만 카드 스택이었다(나머지는 가로 스크롤).
 *
 * montage 규약:
 *  · Table은 데스크톱 전용. 머리 줄은 고정 색, 좌측 여백 고정.
 *  · 좁은 화면은 ListCell 스택 — leading / label / description / trailing 네 자리.
 * 그래서 이 컴포넌트는 한 벌의 columns 정의로 두 모양을 함께 그린다.
 */
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** 셀 내용. 표와 모바일 목록이 같은 함수를 쓴다. */
  cell: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  /** 모바일 카드에서 어디에 놓을지. 기본은 본문(줄 목록). */
  mobile?: 'title' | 'trailing' | 'body' | 'hidden';
  className?: string;
  /** 가로 스크롤에서 고정할 첫 열. */
  sticky?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  caption,
  minWidth = '640px',
  className = '',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** 행이 없을 때 그릴 것(FallbackView를 넣는다). */
  empty?: ReactNode;
  /** 낭독기용 표 설명. 화면에는 보이지 않는다. */
  caption: string;
  minWidth?: string;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const align = (a?: Column<T>['align']) =>
    a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';

  const titleCol = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const trailingCols = columns.filter((c) => c.mobile === 'trailing');
  const bodyCols = columns.filter((c) => c !== titleCol && c.mobile !== 'trailing' && c.mobile !== 'hidden');

  return (
    <div className={className}>
      {/* 데스크톱 — 표 */}
      <div className="hidden overflow-x-auto rounded-container border border-border bg-card sm:block">
        <table className="w-full text-left t-label-2" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-fill-alt text-foreground-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-4 py-3 font-medium ${align(c.align)} ${
                    c.sticky ? 'sticky left-0 z-[1] bg-fill-alt' : ''
                  } ${c.className ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-border last:border-0 ${
                  onRowClick ? 'cursor-pointer transition hover:bg-fill-strong' : ''
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 text-foreground-muted ${align(c.align)} ${
                      c.sticky ? 'sticky left-0 z-[1] bg-card' : ''
                    } ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일 — 줄 목록(ListCell 스택) */}
      <ul className="divide-y divide-border rounded-container border border-border bg-card sm:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <ListCell
              label={titleCol.cell(row)}
              trailing={trailingCols.map((c) => (
                <span key={c.key}>{c.cell(row)}</span>
              ))}
              description={
                bodyCols.length > 0 ? (
                  <dl className="mt-1 space-y-0.5">
                    {bodyCols.map((c) => (
                      <div key={c.key} className="flex gap-2">
                        <dt className="shrink-0 text-foreground-subtle">{c.header}</dt>
                        <dd className="min-w-0 flex-1">{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null
              }
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 좁은 화면의 한 줄(montage ListCell) — leading / label / description / trailing. */
export function ListCell({
  leading,
  label,
  description,
  trailing,
  onClick,
}: {
  leading?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <div className="flex w-full items-start gap-3 px-4 py-3 text-left">
      {leading && <span className="shrink-0">{leading}</span>}
      <div className="min-w-0 flex-1">
        <div className="t-label font-medium text-foreground">{label}</div>
        {description && <div className="t-caption text-foreground-muted">{description}</div>}
      </div>
      {trailing && <div className="flex shrink-0 flex-col items-end gap-1">{trailing}</div>}
    </div>
  );

  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-11 transition hover:bg-fill-strong focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
    >
      {body}
    </button>
  );
}

export default DataTable;
