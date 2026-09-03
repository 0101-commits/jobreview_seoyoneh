import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';

/*
 * Toast — "결과 한 문장"만 전하는 알림(montage Toast 규약, v3 T3).
 *
 * v2까지 이 부품 하나가 Toast와 Snackbar 두 몫을 하고 있었다. montage는 부품 자체를 가른다.
 *   · 결과 한 문장            → Toast    (액션·닫기 버튼 없음, 3초/5초)
 *   · 결과 + 조치(실행 취소 등) → Snackbar (닫기 허용, 4초/16초)
 * 그래서 이 파일에서 닫기 X 버튼을 뺐다. 사용자가 조작해야 하는 알림은 Snackbar를 쓴다
 * (src/components/ui/Snackbar.tsx). 사라지면 안 되는 상황 설명은 둘 다 아니고 SectionMessage다.
 *
 * 바로잡은 것 넷
 *  ① 기본 노출 4000ms → 3000ms. 4000은 montage 기준 Snackbar의 값이고 Toast의 값이 아니다.
 *  ② 낭독 우선순위를 종류별로 나눈다. v2는 컨테이너가 role=status·aria-live=polite로 고정이라
 *     저장 실패도 성공 알림과 같은 우선순위로 조용히 읽혔다.
 *  ③ 커서 장치에서 마우스를 올리면 타이머를 세우고 남은 시간부터 다시 센다. 터치에서는 하지
 *     않는다 — hover가 붙어 버려 영영 닫히지 않는다.
 *  ④ 중립 종류(normal) 추가. v2는 success/error/warning 3종이라 "복사했어요"처럼 성공도
 *     실패도 아닌 알림이 success로 흘러갔다.
 */

/** normal = 중립 알림(아이콘 없이 낸다). montage Toast 4종. */
export type ToastType = 'normal' | 'success' | 'error' | 'warning';

/** montage Toast 노출 시간 — short 3초 · long 5초. 3초를 넘겨야 읽히는 내용은 Toast로 낼 것이 아니다. */
export const TOAST_SHORT = 3000;
export const TOAST_LONG = 5000;

export interface ToastMessage {
  type: ToastType;
  msg: string;
  /**
   * 'short'(3초, 기본) · 'long'(5초) · ms 숫자.
   * 0은 자동 해제 없음이지만 Toast에는 닫기 버튼이 없어 화면에 박힌다 —
   * 사용자가 닫아야 하는 알림은 Snackbar를 쓰세요.
   */
  duration?: 'short' | 'long' | number;
}

function durationMs(t: ToastMessage): number {
  if (t.duration === undefined || t.duration === 'short') return TOAST_SHORT;
  if (t.duration === 'long') return TOAST_LONG;
  return t.duration;
}

/**
 * 기존 `const [toast, setToast] = useState<...>(null)` 자리에 그대로 들어갑니다.
 * showToast는 객체를 받으므로 onToast 콜백에도 바로 넘길 수 있습니다.
 *
 * 자동 해제 타이머는 이 훅이 아니라 <Toast>가 든다 — 마우스가 올라갔는지 아는 것은
 * DOM을 그리는 쪽이고, 그래야 호출부 15곳을 고치지 않고 hover 정지가 전부에 걸린다.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismiss = useCallback(() => setToast(null), []);
  const showToast = useCallback((t: ToastMessage) => setToast(t), []);
  return { toast, showToast, dismiss };
}

const styles: Record<ToastType, string> = {
  normal: 'border-border bg-elevated text-foreground',
  success: 'border-success-border bg-success-muted text-success',
  error: 'border-destructive-border bg-destructive-muted text-destructive',
  warning: 'border-warning-border bg-warning-muted text-warning',
};

const icons: Record<ToastType, typeof CheckCircle2 | null> = {
  normal: null,
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
  const hold = useDismissTimer(toast, toast ? durationMs(toast) : 0, onDismiss);

  /*
    낭독 우선순위(montage) — 실패 알림만 낭독을 가로챈다.
    라이브 리전을 하나만 두고 그 긴급도를 현재 알림 종류에 맞춘다. 컨테이너와 항목에
    각각 aria-live를 걸면(중첩 라이브 리전) 낭독기가 같은 문장을 두 번 읽을 수 있다.
  */
  const assertive = toast?.type === 'error';

  // 화면 흐름 밖(body)에 그린다 — 모달·표·고정 바 위에 언제나 같은 자리에서 뜬다.
  // 서버 렌더가 없는 앱이라 document는 항상 있다.
  return createPortal(
    // 컨테이너는 항상 렌더링해야 aria-live가 이후 변경을 읽어 줍니다.
    <div
      role="region"
      aria-label="알림"
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-10"
    >
      {toast && (
        <div
          role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
          onMouseEnter={hold.pause}
          onMouseLeave={hold.resume}
          onFocus={hold.pause}
          onBlur={hold.resume}
          /* montage 규격 — 최대 폭 420px, 768px 이상에서 최소 폭 356px, 텍스트 최대 2줄. */
          className={`pointer-events-auto flex w-full max-w-[420px] items-start gap-2 rounded-element border px-4 py-3 t-label shadow-2 sm:min-w-[356px] ${styles[toast.type]}`}
        >
          {Icon && <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line">{toast.msg}</p>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * 자동 해제 타이머 한 벌. Toast와 Snackbar가 같은 규칙을 쓴다.
 *
 * hover 정지를 커서 장치에서만 하는 이유(montage): 터치 기기는 탭하면 hover가 붙은 채
 * 남아서 pause만 걸리고 resume이 오지 않는다 — 알림이 영영 닫히지 않는다.
 * ms가 0 이하면 자동 해제를 하지 않는다(Snackbar의 '사용자가 닫을 때까지' 모드).
 */
export function useDismissTimer(item: unknown, total: number, onDone: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const left = useRef(0);
  const startedAt = useRef(0);

  const canHover = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;

  const run = useCallback(
    (ms: number) => {
      if (ms <= 0) return;
      left.current = ms;
      startedAt.current = Date.now();
      timer.current = setTimeout(onDone, ms);
    },
    [onDone],
  );

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const pause = useCallback(() => {
    if (!timer.current || !canHover()) return;
    left.current = Math.max(0, left.current - (Date.now() - startedAt.current));
    stop();
  }, [stop]);

  const resume = useCallback(() => {
    if (timer.current || !canHover() || left.current <= 0) return;
    run(left.current);
  }, [run]);

  useEffect(() => {
    stop();
    if (!item) return;
    run(total);
    return stop;
    // total은 item에서 파생된다 — item이 바뀔 때만 타이머를 다시 건다.
  }, [item, total, run, stop]);

  return { pause, resume };
}

export default Toast;
