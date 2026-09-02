/*
 * ConfirmDialog + useConfirm — 되돌릴 수 없는 조작을 묻는 한 벌(montage Alert 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: window.confirm이 9곳에 흩어져 있었다. 브라우저 기본 창은
 *  · 문구를 다듬을 수 없고(제목·본문·버튼 위계가 없다)
 *  · 파괴적 조작과 단순 확인이 똑같이 생기고
 *  · 모바일에서는 주소창 아래 시스템 알림으로 떠 맥락이 끊기고
 *  · 화면 스타일·다크 값과 무관하게 그려진다.
 *
 * montage Alert 규약에서 가져온 것: heading(선택) + body + 조치 2개(normal/negative),
 * 시스템 dimmer 위에 뜨고, 파괴적 조작의 확인 버튼만 negative 색을 쓴다.
 *
 * 쓰는 법 — 두 가지 다 된다.
 *   ① 선언형:  {open && <ConfirmDialog … onConfirm onCancel />}
 *   ② 명령형:  const { confirm, dialog } = useConfirm();
 *              if (await confirm({ title, body })) …   // dialog를 화면 어딘가에 그려 둔다
 * ②는 window.confirm을 쓰던 자리를 그대로 옮길 수 있어 교체가 짧다.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { ModalShell } from './ModalShell';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** negative면 확인 버튼이 파괴적 색(danger)으로 그려진다. */
  tone?: 'normal' | 'negative';
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'normal',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <ModalShell
      title={title}
      onClose={onCancel}
      size="sm"
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'negative' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body ? <div className="t-label leading-6 text-foreground-muted">{body}</div> : null}
    </ModalShell>
  );
}

/**
 * window.confirm 자리에 그대로 들어가는 명령형 확인.
 * dialog를 반드시 화면에 그려야 한다 — 그리지 않으면 약속이 영원히 해결되지 않는다.
 */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setPending(options);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setPending(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(ok);
  }, []);

  const dialog = pending ? (
    <ConfirmDialog {...pending} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
  ) : null;

  return { confirm, dialog };
}

export default ConfirmDialog;
