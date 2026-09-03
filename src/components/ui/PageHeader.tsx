/*
 * PageHeader — 화면 제목 줄(montage SectionHeader 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: "부제 p + h2 + 우측 필터/버튼" 마크업이 17개 화면에 복붙돼 있었다.
 * 제목 크기가 화면마다 .t-title / .t-heading 없이 text-2xl·text-xl로 갈렸고, 우측 정렬 방식도 달랐다.
 *
 * 규약: eyebrow(보조 설명) → 제목(t-title) → 우측 trailing. 데스크톱에서 한 줄, 좁은 화면에서 두 줄.
 * 제목은 최대 2줄까지만 (montage), 그 뒤는 줄바꿈이 아니라 문구를 줄인다.
 */
import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  trailing,
  headingContent,
  className = '',
}: {
  /** 제목 위 한 줄 — 건수·범위·마지막 갱신 같은 맥락. */
  eyebrow?: ReactNode;
  title: string;
  /** 오른쪽 조작 묶음(필터·버튼·페이지네이션). */
  trailing?: ReactNode;
  /** 제목 옆에 붙는 칩·아이콘. */
  headingContent?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 t-label text-foreground-subtle">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="t-title text-foreground">{title}</h2>
          {headingContent}
        </div>
      </div>
      {trailing && <div className="flex flex-wrap items-center gap-3">{trailing}</div>}
    </div>
  );
}

export default PageHeader;
