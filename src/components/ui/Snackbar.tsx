import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDismissTimer } from '@/components/ui/Toast';

/*
 * Snackbar — "결과 + 조치"를 전하는 알림(montage Snackbar 규약, v3 T3 신설).
 *
 * Toast와 갈리는 기준은 액션 유무 하나다.
 *   · 결과 한 문장            → Toast    (액션·닫기 없음, 3초/5초)
 *   · 결과 + 조치(실행 취소 등) → Snackbar (닫기 허용, 4초/16초)  ← 이 파일
 *   · 되돌릴 수 없는 확인      → 둘 다 아니고 ConfirmDialog
 *   · 사라지면 안 되는 설명    → SectionMessage
 *
 * 왜 필요했나: v2에는 실행 취소를 줄 자리가 없어서, 계정 삭제·배정 해제 같은 조작이
 * "지웠어요" 한 문장만 남기고 사라졌다. 되돌리려면 다시 만들어야 했다.
 * duration: 0으로 화면에 박아 두던 오류 알림도 닫을 방법이 없어 여기로 옮긴다.
 *
 * 한 화면에서 Toast와 Snackbar를 동시에 띄우지 않는다 — 같은 자리(하단 중앙)에 뜬다.
 */

export type SnackbarType = 'normal' | 'success' | 'error' | 'warning';

/** montage Snackbar 노출 시간 — short 4초 · long 16초. 그 사이 임의값은 두지 않는다. */
export const SNACKBAR_SHORT = 4000;
export const SNACKBAR_LONG = 16000;

export interface SnackbarMessage {
  type: SnackbarType;
  msg: string;
  /**
   * 'short'(4초, 기본) · 'long'(16초) · 0(사용자가 닫을 때까지).
   * long과 0에는 닫기 버튼이 함께 뜬다 — 짧은 4초 알림에 닫기 버튼은 불필요하다(montage).
   */
  duration?: 'short' | 'long' | 0;
  /** 되돌리기·다음 행동. 누르면 알림이 닫힌다. */
  action?: { label: string; onClick: () => void };
}

function durationMs(s: SnackbarMessage): number {
  if (s.duration === 0) return 0;
  return s.duration === 'long' ? SNACKBAR_LONG : SNACKBAR_SHORT;
}

export function useSnackbar() {
  const [snackbar, setSnackbar] = useState<SnackbarMessage | null>(null);
  const dismiss = useCallback(() => setSnackbar(null), []);
  const showSnackbar = useCallback((s: SnackbarMessage) => setSnackbar(s), []);
  return { snackbar, showSnackbar, dismiss };
}

const styles: Record<SnackbarType, string> = {
  normal: 'border-border bg-elevated text-foreground',
  success: 'border-success-border bg-success-muted text-success',
  error: 'border-destructive-border bg-destructive-muted text-destructive',
  warning: 'border-warning-border bg-warning-muted text-warning',
};

const icons: Record<SnackbarType, typeof CheckCircle2 | null> = {
  normal: null,
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
};

export function Snackbar({
  snackbar,
  onDismiss,
}: {
  snackbar: SnackbarMessage | null;
  onDismiss: () => void;
}) {
  const total = snackbar ? durationMs(snackbar) : 0;
  const hold = useDismissTimer(snackbar, total, onDismiss);
  const Icon = snackbar ? icons[snackbar.type] : null;
  // 닫기 버튼은 오래 띄우는 알림에만 준다(montage). 4초 알림은 알아서 사라진다.
  const closable = snackbar ? total === 0 || total >= SNACKBAR_LONG : false;

  return createPortal(
    // Snackbar는 항상 status/polite다(montage) — 조치를 담고 있어 낭독을 가로채지 않는다.
    <div
      role="region"
      aria-label="알림"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-10"
    >
      {snackbar && (
        <div
          role="status"
          onMouseEnter={hold.pause}
          onMouseLeave={hold.resume}
          onFocus={hold.pause}
          onBlur={hold.resume}
          className={`pointer-events-auto flex w-full max-w-[420px] items-start gap-2 rounded-element border px-4 py-3 t-label shadow-2 sm:min-w-[356px] ${styles[snackbar.type]}`}
        >
          {Icon && <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line">{snackbar.msg}</p>
          {snackbar.action && (
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 shrink-0 font-semibold text-current underline"
              onClick={() => {
                snackbar.action?.onClick();
                onDismiss();
              }}
            >
              {snackbar.action.label}
            </Button>
          )}
          {closable && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="알림 닫기"
              className="-my-1 -mr-1.5 shrink-0 rounded-element p-1 opacity-60 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

export default Snackbar;
