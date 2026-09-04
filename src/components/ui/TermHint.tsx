/*
 * 용어 힌트 — 라벨 옆 물음표 (기획서 GUIDE v4 §5 G1).
 *
 * 화면에 처음 나오는 낱말 옆에 붙어, 눌렀을 때 그 자리에서 한두 문장을 보여 준다.
 * 문안은 짓지 않는다 — sme-review/glossary.ts가 유일한 원천이다.
 *
 * 왜 <button>이 아니라 role="button"인가.
 *   검토 화면의 입력 전체가 <fieldset disabled>로 잠긴다(제출 완료·읽기 전용 상태).
 *   fieldset[disabled]는 후손의 폼 컨트롤을 전부 비활성화하므로 <button>으로 만들면
 *   "제출한 검토를 다시 읽는" 바로 그 상황에서 설명이 열리지 않는다. span은 폼 컨트롤이
 *   아니라 잠금과 무관하다. 대신 키보드 동작(Enter·Space)과 이름을 직접 준다.
 *
 * 왜 모달이 아니라 그 자리에서 펼치는가.
 *   기획서 초안은 좁은 화면에서 ModalShell을 쓰기로 했다. 실제로 붙여 보면 두 가지가 걸린다 —
 *   ModalShell은 포털이 아니라 제자리에 그려져 위 fieldset 문제를 그대로 물려받고,
 *   배경 스크롤까지 잠근다. 한두 문장을 읽자고 화면을 덮을 이유가 없어 한 코드 경로로 줄였다.
 *   폭은 min(18rem, 화면폭-2.5rem)으로 묶어 390px에서도 화면 밖으로 나가지 않는다.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { HelpCircle } from 'lucide-react';
import { findTerm, termHintLabel, type TermId } from '@/pages/sme-review/glossary';

export function TermHint({ id }: { id: TermId }) {
  const term = findTerm(id);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);

  // 바깥을 누르면 닫는다. 열려 있을 때만 듣는다(물음표가 한 화면에 열 개 넘게 붙는다).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      markRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  if (!term) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    setOpen((v) => !v);
  };

  return (
    <span
      ref={wrapRef}
      className="relative inline-block align-middle"
      /*
        이 조각은 <label> 안에 들어가는 일이 많다(개선 필요사항·수정 제안 칸).
        기본 동작대로 두면 물음표를 누를 때마다 라벨이 옆 입력 칸으로 포커스를 넘겨,
        설명을 열자마자 모바일 키보드가 올라와 그 설명을 덮는다.
      */
      onClick={(e) => e.preventDefault()}
    >
      <span
        ref={markRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={termHintLabel(term.term)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`ml-1 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          open
            ? 'border-primary bg-primary-subtle text-primary'
            : 'border-border bg-card text-foreground-subtle hover:border-primary hover:text-primary'
        }`}
      >
        <HelpCircle size={13} aria-hidden="true" />
      </span>

      {open && (
        <span
          id={panelId}
          role="note"
          className="absolute left-0 top-full z-10 mt-1.5 block w-[min(18rem,calc(100vw-2.5rem))] rounded-element border border-border bg-elevated p-3 text-left font-normal normal-case tracking-normal shadow-2"
        >
          <span className="block t-caption font-semibold text-foreground">{term.term}</span>
          <span className="mt-1 block t-caption leading-5 text-foreground">{term.short}</span>
          {/* FTE 항목만 long이 두 문단이다(착수보고 고정 문언 + 덧붙임). 줄바꿈을 살린다. */}
          <span className="mt-1.5 block whitespace-pre-line t-caption leading-5 text-foreground-muted">
            {term.long}
          </span>
        </span>
      )}
    </span>
  );
}

export default TermHint;
