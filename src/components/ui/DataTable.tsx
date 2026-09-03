/*
 * DataTable + ListCell — 표 한 벌(montage Table / ListCell 규약 차용, v2 §6-4 · v3 T3).
 *
 * 왜 필요한가: 표가 여덟 화면에 있는데 sticky 열·최소 폭·헤더 색·빈 상태가 제각각이었고,
 * 모바일 대응은 비교 뷰 한 곳만 카드 스택이었다(나머지는 가로 스크롤).
 *
 * montage 규약:
 *  · Table은 데스크톱 전용. 머리 줄은 고정 색, 좌측 여백 고정.
 *  · 좁은 화면은 ListCell 스택 — leading / label / description / trailing 네 자리.
 * 그래서 이 컴포넌트는 한 벌의 columns 정의로 두 모양을 함께 그린다.
 *
 * v3 T3에서 고친 것 넷
 *  ① 행을 키보드로 열 수 있다. onRowClick이 있으면 tabIndex·role·Enter/Space를 붙인다.
 *     v2는 <tr onClick>에 cursor-pointer만 있어 마우스 없이는 표 여덟 곳의 행을 열 수 없었다
 *     (WCAG 2.2 · 2.1.1 키보드). 낭독기에도 누를 수 있다는 사실이 전달되지 않았다.
 *  ② 표 머리를 스크롤에 고정할 수 있다(stickyHead). 수십 행을 넘기면 열 뜻을 잃었다.
 *  ③ 표와 목록 중 한쪽만 렌더한다. 둘 다 그려 놓고 CSS로 숨겨 행이 DOM에 두 벌이었다.
 *     전환선은 montage가 표/목록을 가르는 768px(md)로 올렸다 — v2는 640px(sm)이었다.
 *  ④ 머리와 본문의 밀도·색을 나눈다. montage는 머리 세로 8px·본문 16px로 본문이 두 배
 *     여유롭고, 머리가 더 작고 굵고 흐리며 본문이 더 크고 진하다. v2는 둘 다 py-3·muted였다.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { BP, useMediaQuery } from '@/lib/useMediaQuery';

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
  stickyHead = false,
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
  /**
   * 표 머리를 스크롤 상단에 고정한다. 행이 화면 한 장을 넘는 표에 켠다.
   * 표를 감싼 상자가 스크롤 컨테이너가 되므로 maxHeight를 함께 주는 화면에서만 의미가 있다.
   */
  stickyHead?: boolean;
  className?: string;
}) {
  // 768px 미만은 목록, 이상은 표. 한쪽만 렌더한다(§ 위 ③).
  const wide = useMediaQuery(BP.md);

  if (rows.length === 0 && empty) return <>{empty}</>;

  const align = (a?: Column<T>['align']) =>
    a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';

  const titleCol = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const trailingCols = columns.filter((c) => c.mobile === 'trailing');
  const bodyCols = columns.filter((c) => c !== titleCol && c.mobile !== 'trailing' && c.mobile !== 'hidden');

  // 행 전체가 누를 수 있는 표라면 키보드로도 열려야 한다.
  const onRowKeyDown = (row: T) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!onRowClick) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // 셀 안의 버튼·링크를 누른 것이면 행 클릭으로 삼지 않는다(중복 실행 방지).
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    onRowClick(row);
  };

  if (wide) {
    return (
      <div className={className}>
        <div className="overflow-x-auto rounded-container border border-border bg-card">
          <table className="w-full text-left" style={{ minWidth }}>
            <caption className="sr-only">{caption}</caption>
            {/*
              머리는 작고 굵고 흐리게, 본문은 크고 진하게(montage 표 타이포 위계).
              sticky일 때 z는 전역 층이 아니라 지역 겹침이므로 z-[1]을 쓴다.
            */}
            <thead className={stickyHead ? 'sticky top-0 z-[1]' : undefined}>
              <tr className="border-b border-border bg-fill-alt text-foreground-muted">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`h-11 px-5 py-2 t-label-2 font-bold ${align(c.align)} ${
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
                  onKeyDown={onRowClick ? onRowKeyDown(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  className={`border-b border-border last:border-0 ${
                    onRowClick
                      ? 'cursor-pointer transition hover:bg-fill-strong focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
                      : ''
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-5 py-4 t-label text-foreground ${align(c.align)} ${
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
      </div>
    );
  }

  return (
    <div className={className}>
      <ul aria-label={caption} className="divide-y divide-border rounded-container border border-border bg-card">
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
