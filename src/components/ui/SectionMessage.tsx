/*
 * SectionMessage — 화면 안의 상황 알림 한 줄(montage SectionMessage 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: 오류·주의·안내 상자가 20곳 넘게 각자 마크업으로 그려져 있었다.
 * 색·아이콘·여백·버튼 위치가 화면마다 달라 같은 무게의 알림이 다르게 읽혔다.
 *
 * montage 규약에서 가져온 것:
 *  · variant 4종 — info / positive / cautionary / negative (상태색은 여기에만 쓴다)
 *  · heading(선택) + description 구조, 짧은 메시지의 조치는 오른쪽(trailing), 긴 메시지는 아래(bottom)
 *  · 중요도가 낮은 알림만 닫기 버튼을 준다(onClose를 주지 않으면 닫히지 않는다)
 *
 * 토스트와의 구분: 결과 한 문장은 Toast, 원인·복구는 SectionMessage다(§6-6 문구 원칙).
 */
import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type SectionMessageVariant = 'info' | 'positive' | 'cautionary' | 'negative';

const TONE: Record<SectionMessageVariant, { box: string; Icon: typeof Info }> = {
  info: { box: 'border-border bg-muted text-foreground-muted', Icon: Info },
  positive: { box: 'border-success-border bg-success-muted text-success', Icon: CheckCircle2 },
  cautionary: { box: 'border-warning-border bg-warning-muted text-warning', Icon: AlertTriangle },
  negative: { box: 'border-destructive-border bg-destructive-muted text-destructive', Icon: AlertCircle },
};

export function SectionMessage({
  variant = 'info',
  heading,
  children,
  action,
  bottomAction,
  onClose,
  className = '',
}: {
  variant?: SectionMessageVariant;
  /** 한 줄 제목. 본문만으로 충분하면 생략한다(montage: 강조가 필요할 때만). */
  heading?: string;
  children: ReactNode;
  /** 짧은 메시지의 조치 — 오른쪽에 붙는다(재시도 등). */
  action?: ReactNode;
  /** 긴 메시지의 조치 — 아래 줄에 붙는다. */
  bottomAction?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const { box, Icon } = TONE[variant];
  // 오류·주의는 낭독기가 곧바로 읽어야 한다. 안내는 흐름을 끊지 않게 polite로 둔다.
  const assertive = variant === 'negative';

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      className={`flex items-start gap-2 rounded-element border px-4 py-3 t-label ${box} ${className}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {heading && <p className="font-semibold">{heading}</p>}
        <div className={`min-w-0 whitespace-pre-line ${heading ? 'mt-0.5' : ''}`}>{children}</div>
        {bottomAction && <div className="mt-3 flex flex-wrap gap-2">{bottomAction}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="알림 닫기"
          className="-my-1 -mr-1.5 shrink-0 rounded-element p-1 opacity-60 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default SectionMessage;
