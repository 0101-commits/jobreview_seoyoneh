/*
 * StatusBadge — 상태 배지 한 벌(montage ContentBadge 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: 같은 "제출"을 세 곳이 다르게 불렀다.
 *  · shared/StatusBadge — 검토 상태 5종(제출 완료)
 *  · 진행 현황 매트릭스의 셀 칩 — 같은 5종을 다른 라벨(제출)로
 *  · 문의 배지 2벌 — 인박스와 '내 문의'가 각자 마크업
 * 라벨 사전을 한 곳에 두고, 색은 상태 토큰만 쓴다(Tailwind 원색 금지 — 다크 값이 없다).
 *
 * domain으로 어느 사전을 쓸지 고른다. 새 도메인이 생기면 여기 사전만 늘린다.
 */
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'progress' | 'positive' | 'attention' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-fill-alt text-foreground-muted',
  progress: 'bg-warning-muted text-warning',
  positive: 'bg-success-muted text-success',
  attention: 'bg-destructive-muted text-destructive',
  info: 'bg-primary-subtle text-primary',
};

/** 검토 상태(reviews.status의 화면 라벨) — 이 다섯이 이 앱의 표준 문언이다. */
export const REVIEW_BADGE: Record<string, BadgeTone> = {
  미시작: 'neutral',
  '작성 중': 'progress',
  '제출 완료': 'positive',
  '재검토 요청': 'attention',
  '재제출 완료': 'info',
  미배정: 'neutral',
};

/** 문의 상태(inquiries.status). */
export const INQUIRY_BADGE: Record<string, BadgeTone> = {
  대기: 'progress',
  답변: 'positive',
  종결: 'neutral',
};

const DICTS = { review: REVIEW_BADGE, inquiry: INQUIRY_BADGE } as const;

export function StatusBadge({
  status,
  domain = 'review',
  size = 'md',
  icon,
  className = '',
}: {
  status: string;
  domain?: keyof typeof DICTS;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  className?: string;
}) {
  const tone = DICTS[domain][status] ?? 'neutral';
  const pad = size === 'sm' ? 'px-2 py-0.5 t-caption' : 'px-2.5 py-1 t-label-2';
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-inner font-medium ${pad} ${TONE[tone]} ${className}`}
    >
      {icon}
      {status}
    </span>
  );
}

export default StatusBadge;
