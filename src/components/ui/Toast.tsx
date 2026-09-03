import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastMessage {
  type: ToastType;
  msg: string;
  /** ms. 생략하면 4초 뒤 자동으로 사라집니다. 0이면 자동 해제 없음. */
  duration?: number;
}

/*
 * 규격은 montage Toast 규약을 따른다(v2 §6-4).
 *  · 기본 4초. 사용자가 조작해야 하는 알림은 16초(duration으로 직접 준다).
 *  · 최대 폭 420px · 최대 2줄 · 데스크톱은 화면 하단 40px에 고정.
 * 예전에는 화면마다 흐름 안에 인라인으로 그려 위치와 지속 시간이 15곳에서 달랐다.
 * 호출부(useToast + <Toast toast onDismiss/>)는 그대로 두고 렌더 위치만 포털로 옮겼다 —
 * 15개 화면을 고치지 않고 규격을 한 번에 통일하기 위해서다.
 */
const DEFAULT_DURATION = 4000;
export const TOAST_ACTION_DURATION = 16000;

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
  /** @deprecated 포털로 옮겨 위치를 규격화했다(v2 §6-4). 남은 호출부 호환용이며 무시된다. */
  className?: string;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const Icon = toast ? icons[toast.type] : null;

  // 화면 흐름 밖(body)에 그린다 — 모달·표·고정 바 위에 언제나 같은 자리에서 뜬다.
  // 서버 렌더가 없는 앱이라 document는 항상 있다.
  return createPortal(
    // 컨테이너는 항상 렌더링해야 aria-live가 이후 변경을 읽어 줍니다.
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-10"
    >
      {toast && Icon && (
        <div
          className={`pointer-events-auto flex w-full max-w-[420px] items-start gap-2 rounded-element border px-4 py-3 t-label shadow-2 ${styles[toast.type]}`}
        >
          <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line">{toast.msg}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="알림 닫기"
            className="-my-1 -mr-1.5 shrink-0 rounded-element p-1 opacity-60 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

export default Toast;
