import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastMessage {
  type: ToastType;
  msg: string;
  /** ms. 생략하면 4초 뒤 자동으로 사라집니다. 0이면 자동 해제 없음. */
  duration?: number;
}

const DEFAULT_DURATION = 4000;

/**
 * 기존 `const [toast, setToast] = useState<...>(null)` 자리에 그대로 들어갑니다.
 * showToast는 객체를 받으므로 onToast 콜백에도 바로 넘길 수 있습니다.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const dismiss = useCallback(() => setToast(null), []);
  const showToast = useCallback((t: ToastMessage) => setToast(t), []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!toast) return;
    const ms = toast.duration ?? DEFAULT_DURATION;
    if (ms <= 0) return;
    timer.current = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(timer.current);
  }, [toast]);

  return { toast, showToast, dismiss };
}

const styles: Record<ToastType, string> = {
  success: 'border-success-border bg-success-muted text-success',
  error: 'border-destructive-border bg-destructive-muted text-destructive',
  warning: 'border-warning-border bg-warning-muted text-warning',
};

const icons: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
};

export interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  className?: string;
}

export function Toast({ toast, onDismiss, className = '' }: ToastProps) {
  const Icon = toast ? icons[toast.type] : null;
  return (
    // 컨테이너는 항상 렌더링해야 aria-live가 이후 변경을 읽어 줍니다.
    <div aria-live="polite" role="status" className={className}>
      {toast && Icon && (
        <div className={`mb-4 flex items-start gap-2 rounded-element border px-4 py-3 text-sm ${styles[toast.type]}`}>
          <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 whitespace-pre-line">{toast.msg}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="알림 닫기"
            className="-my-1 -mr-1.5 shrink-0 rounded-element p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export default Toast;
