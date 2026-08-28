import React, { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg';

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
}

const sizes: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
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
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  // 닫기 요청 하나로 ESC·배경 클릭·X 버튼을 모두 처리합니다(가드가 한 곳에만 있게).
  const requestClose = useCallback(() => {
    if (closeDisabled) return;
    if (dirty && !window.confirm('저장하지 않은 변경 내용이 있어요. 창을 닫으면 입력한 내용이 사라집니다. 닫을까요?')) return;
    onClose();
  }, [closeDisabled, dirty, onClose]);

  // 열릴 때 첫 포커스 이동 → 닫힐 때 트리거로 복귀
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? closeBtnRef.current)?.focus();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${sizes[size]} flex-col rounded-container bg-card shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
          <div className="flex items-start gap-2">
            {icon}
            <div>
              <h3 id={titleId} className="text-lg font-semibold text-foreground">{title}</h3>
              {description && <p id={descId} className="mt-1 text-sm leading-6 text-foreground-muted">{description}</p>}
            </div>
          </div>
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
        </div>

        {/* 본문만 스크롤 — 8필드 폼에서도 하단 버튼이 화면 밖으로 밀리지 않습니다. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}

export default ModalShell;
