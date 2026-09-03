import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

/*
 * 폭 4단은 montage 규격(small 360 / medium 400 / large 480 / xlarge 560px)을 그대로 옮긴 것이다.
 * v2는 448 / 512 / 672 세 단이었고 내부 여백이 세 단 모두 24px로 고정이라
 * 좁은 모달은 답답하고 넓은 모달은 헐거웠다.
 *
 * 'wide'(720px)는 montage에 없는 이 앱의 단계다. montage는 모바일 우선 시스템이라 560px에서
 * 끊기지만, 이 앱에는 관리자가 데스크톱에서 표를 미리 보는 모달이 하나 있다
 * (SmeBulkUploadModal의 SME 명부 미리보기). 그 한 곳만 이 단계를 쓴다.
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'wide';

export interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 제목 아래 보조 설명. */
  description?: string;
  /** 제목 왼쪽 아이콘(lucide 등). */
  icon?: React.ReactNode;
  /** 본문 아래 고정 버튼 줄. 본문이 길어져도 항상 보입니다. */
  footer?: React.ReactNode;
  size?: ModalSize;
  /**
   * 저장하지 않은 변경이 있으면 true.
   * 배경 클릭·ESC로 닫으려 할 때 확인을 한 번 거칩니다(폼이 통째로 날아가는 사고 방지).
   */
  dirty?: boolean;
  /** 처리 중이라 닫기를 막아야 할 때(예: 삭제 진행 중). */
  closeDisabled?: boolean;
  /**
   * 우상단 [X]를 감춘다.
   * montage 규약 — 닫기 버튼과 [X]를 한 창에 중복해 두지 않는다. footer에 '취소'가 있으면 이걸 켠다.
   * ESC와 배경 클릭은 그대로 살아 있으므로 닫는 길이 사라지지는 않는다.
   */
  hideClose?: boolean;
}

/*
 * 크기마다 폭·내부 여백·반경이 함께 움직인다(montage: "크기를 키우면 여백도 같이 커져야 밀도가 유지된다").
 * montage 여백은 20/20/24/32px, 반경은 12/12/20/20px이다. 반경은 이 앱의 토큰으로 받는다 —
 * rounded-container(10px) ≈ montage 12px, rounded-page(16px) ≈ montage 20px.
 * 새 반경 값을 만들지 않으려고 가까운 토큰에 붙였다.
 */
const sizes: Record<ModalSize, { w: string; pad: string; radius: string }> = {
  sm: { w: 'max-w-[360px]', pad: 'px-5', radius: 'rounded-container' },
  md: { w: 'max-w-[400px]', pad: 'px-5', radius: 'rounded-container' },
  lg: { w: 'max-w-[480px]', pad: 'px-6', radius: 'rounded-page' },
  xl: { w: 'max-w-[560px]', pad: 'px-8', radius: 'rounded-page' },
  wide: { w: 'max-w-[720px]', pad: 'px-8', radius: 'rounded-page' },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell({
  title,
  onClose,
  children,
  description,
  icon,
  footer,
  size = 'md',
  dirty = false,
  closeDisabled = false,
  hideClose = false,
}: ModalShellProps) {
  const box = sizes[size];
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  // 저장하지 않은 입력이 있는데 닫으려 할 때 뜨는 확인. window.confirm을 앱 안의 창으로 바꿨습니다(v2 §6-4).
  const [askClose, setAskClose] = useState(false);

  // 닫기 요청 하나로 ESC·배경 클릭·X 버튼을 모두 처리합니다(가드가 한 곳에만 있게).
  const requestClose = useCallback(() => {
    if (closeDisabled) return;
    if (dirty) {
      setAskClose(true);
      return;
    }
    onClose();
  }, [closeDisabled, dirty, onClose]);

  /*
   * 열릴 때 첫 포커스 → 닫힐 때 트리거로 복귀.
   *
   * v3 T3에서 첫 포커스를 '첫 입력 칸'에서 '창 자신'으로 바꿨다(montage 규약).
   * 폼 모달을 열자마자 커서가 첫 칸에 들어가면 낭독기가 제목을 읽지 못한 채 입력 칸부터
   * 읽는다. 창에 포커스를 주면 제목(aria-labelledby)과 설명(aria-describedby)이 먼저 읽히고,
   * Tab 한 번으로 첫 칸에 닿는다.
   *
   * preventScroll — 포커스 때문에 뒤 배경이 스크롤되어 창이 튀는 것을 막는다.
   */
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    (panelRef.current ?? closeBtnRef.current)?.focus({ preventScroll: true });
    return () => trigger?.focus?.();
  }, []);

  // 배경 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC 닫기 + 포커스 트랩
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [requestClose]);

  return (
    <div
      className="anim-scrim fixed inset-0 z-modal flex items-center justify-center scrim p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`anim-panel flex max-h-[calc(100dvh-2rem)] w-full ${box.w} flex-col ${box.radius} bg-elevated shadow-2 outline-none`}
      >
        <div className={`flex items-start justify-between gap-3 ${box.pad} pb-4 pt-6`}>
          <div className="flex items-start gap-2">
            {icon}
            <div>
              <h3 id={titleId} className="t-headline text-foreground">{title}</h3>
              {description && <p id={descId} className="mt-1 t-label-reading text-foreground-muted">{description}</p>}
            </div>
          </div>
          {/* montage — footer에 '취소'가 있으면 [X]를 두지 않는다(hideClose). ESC와 배경 클릭은 그대로다. */}
          {!hideClose && (
            <button
              ref={closeBtnRef}
              type="button"
              onClick={requestClose}
              disabled={closeDisabled}
              aria-label="닫기"
              className="-mr-1.5 -mt-1.5 rounded-element p-1.5 text-foreground-subtle transition hover:bg-muted hover:text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* 본문만 스크롤 — 8필드 폼에서도 하단 버튼이 화면 밖으로 밀리지 않습니다. */}
        <div className={`min-h-0 flex-1 overflow-y-auto ${box.pad} pb-6`}>{children}</div>

        {/*
          액션 줄. montage는 배치를 폭이 결정한다고 본다 — 오른쪽 정렬(Compact)은 560px 이상에서만
          쓰고, 그보다 좁으면 세로로 쌓아 main을 위에 둔다.
          좁은 화면에서는 어느 크기든 세로로 쌓고 버튼을 폭 전체로 늘린다. flex-col-reverse라
          footer에 (보조, main) 순으로 넘긴 것이 화면에서는 main이 위에 온다.
        */}
        {footer && (
          <div
            className={`flex flex-col-reverse gap-2 border-t border-border ${box.pad} py-4 [&>*]:w-full sm:flex-row sm:flex-wrap sm:justify-end sm:[&>*]:w-auto`}
          >
            {footer}
          </div>
        )}
      </div>

      {/*
        닫기 확인. ConfirmDialog를 쓰지 않고 여기에 직접 그립니다 —
        ConfirmDialog가 ModalShell 위에 서 있어 서로 가져오면 순환 참조가 됩니다.
        모양·문구 규칙(제목 + 본문 + 조치 2개, 파괴적 조치는 destructive)은 같습니다.
      */}
      {askClose && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${titleId}-close-ask`}
          className="absolute inset-0 z-[1] flex items-center justify-center scrim p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAskClose(false);
          }}
        >
          <div className="w-full max-w-sm rounded-container bg-elevated p-6 shadow-2">
            <h4 id={`${titleId}-close-ask`} className="t-headline text-foreground">
              작성 중인 내용이 사라져요
            </h4>
            <p className="mt-2 t-label-reading text-foreground-muted">
              저장하지 않은 변경 내용이 있어요. 창을 닫으면 입력한 내용이 사라집니다.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setAskClose(false)}
                className="min-h-11 rounded-element border border-border bg-card px-4 t-label font-medium text-foreground-muted transition hover:border-primary hover:text-primary sm:min-h-control-md"
              >
                계속 작성
              </button>
              <button
                type="button"
                onClick={() => {
                  setAskClose(false);
                  onClose();
                }}
                className="min-h-11 rounded-element border border-destructive-border bg-destructive-muted px-4 t-label font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground sm:min-h-control-md"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ModalShell;
