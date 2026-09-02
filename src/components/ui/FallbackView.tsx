/*
 * FallbackView — 빈 상태·오류 상태·권한 없음 한 벌(montage FallbackView 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: "아직 없습니다" 화면이 10곳 넘게 각자 다른 문장·구조로 그려져 있었다.
 * 어떤 곳은 아이콘만, 어떤 곳은 두 문장, 어떤 곳은 재시도 버튼이 없었다.
 *
 * montage 규약에서 가져온 것:
 *  · 아이콘(또는 그림) + heading(강조가 필요할 때만) + description 2줄 이내 + 조치 1개
 *  · 문구는 '해요'체 — "아직 도착한 문의가 없어요 / SME가 남기면 여기에 도착해요"
 *  · compact — 카드·패널 안에 들어갈 때 여백을 줄인 변형
 */
import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Lock } from 'lucide-react';

export type FallbackKind = 'empty' | 'error' | 'forbidden';

const DEFAULT_ICON: Record<FallbackKind, typeof Inbox> = {
  empty: Inbox,
  error: AlertCircle,
  forbidden: Lock,
};

export function FallbackView({
  kind = 'empty',
  heading,
  description,
  action,
  icon,
  compact = false,
  className = '',
}: {
  kind?: FallbackKind;
  /** 강조가 필요할 때만 준다(montage). 목록 안의 빈 상태는 보통 description 한 줄로 충분하다. */
  heading?: string;
  /** 두 줄 이내. 다음에 무엇이 일어나는지를 적는다. */
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const Icon = DEFAULT_ICON[kind];
  const tone = kind === 'error' ? 'text-destructive' : 'text-foreground-subtle';

  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16'} ${className}`}
    >
      <span className={`shrink-0 ${tone}`} aria-hidden="true">
        {icon ?? <Icon size={compact ? 24 : 32} />}
      </span>
      {heading && <p className="t-headline text-foreground">{heading}</p>}
      <p className="max-w-[36rem] t-label text-foreground-muted">{description}</p>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export default FallbackView;
