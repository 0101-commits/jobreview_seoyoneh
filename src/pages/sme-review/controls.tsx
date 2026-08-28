// SME 검토 화면 전용 공통 조각.
// 적합성 3지선다 / 자동 높이 textarea / 항목 카드 / 신규 제안 편집기.
// 이전에는 같은 마크업이 5곳에 복붙돼 있었고 섹션마다 색 언어가 달랐다. 여기 하나로 모은다.
import React, { useLayoutEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  MessageSquareText,
  Plus,
  Trash2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SuggestionInput } from '@/lib/reviewApi';
import type { Feedback, Suitability } from '@/types';

type Choice = Exclude<Suitability, ''>;

// 색만으로 상태를 알리지 않도록 선택지마다 아이콘을 함께 둔다(색각 이상 대응).
const OPTIONS: { value: Choice; Icon: LucideIcon; on: string }[] = [
  { value: '적합', Icon: CheckCircle2, on: 'border-success bg-success-muted text-success' },
  { value: '일부 수정 필요', Icon: AlertTriangle, on: 'border-warning bg-warning-muted text-warning' },
  { value: '부적합', Icon: XCircle, on: 'border-destructive bg-destructive-muted text-destructive' },
];

const OFF = 'border-border bg-card text-foreground-muted hover:border-primary hover:text-primary';

const SUITABILITY_ICON: Record<Choice, LucideIcon> = {
  적합: CheckCircle2,
  '일부 수정 필요': AlertTriangle,
  부적합: XCircle,
};

const TONE_TEXT: Record<Choice, string> = {
  적합: 'text-success',
  '일부 수정 필요': 'text-warning',
  부적합: 'text-destructive',
};

/**
 * 적합성 3지선다. role="radiogroup" + aria-checked, 좌우/상하 방향키 이동.
 * 클릭으로 고르면 nextFocusId 쪽으로 포커스를 넘겨 다음 항목으로 바로 이어지게 한다
 * (방향키 이동 중에는 넘기지 않는다 — 그러면 방향키 탐색 자체가 끊긴다).
 */
export function SuitabilityControl({
  value,
  onChange,
  focusId,
  nextFocusId,
  label = '적합성 평가',
}: {
  value: Suitability;
  onChange: (value: Choice) => void;
  focusId?: string;
  nextFocusId?: string;
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const advance = () => {
    if (!nextFocusId) return;
    // 목록이 다시 그려진 뒤에 찾아야 한다(평가 즉시 접히거나 필터에서 빠질 수 있다).
    requestAnimationFrame(() => document.getElementById(nextFocusId)?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + OPTIONS.length) % OPTIONS.length;
    refs.current[next]?.focus();
    onChange(OPTIONS[next].value);
  };

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {OPTIONS.map((o, i) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            id={i === 0 ? focusId : undefined}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!value && i === 0) ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => {
              onChange(o.value);
              advance();
            }}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-element border px-3 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected ? o.on : OFF}`}
          >
            <o.Icon size={15} aria-hidden="true" className={selected ? '' : 'opacity-50'} />
            {o.value}
          </button>
        );
      })}
    </div>
  );
}

/** 내용에 따라 최대 10줄까지 늘어나는 textarea. 고정 rows보다 긴 의견을 읽기 쉽다. */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  minRows = 2,
  maxRows = 10,
  id,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  id?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const LINE = 24; // leading-6
    const PAD = 22; // py-2.5 + 테두리
    el.style.height = `${Math.min(el.scrollHeight, maxRows * LINE + PAD)}px`;
  }, [value, maxRows]);

  return (
    <textarea
      id={id}
      ref={ref}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      placeholder={placeholder}
      className="textarea resize-none overflow-auto"
    />
  );
}

/** 의견 + 수정 제안 두 칸. 카드형·섹션형이 함께 쓴다. */
export function FeedbackNotes({
  feedback,
  onChange,
  suggestionLabel = '수정 제안',
  minRows = 2,
}: {
  feedback: Feedback;
  onChange: (v: Partial<Feedback>) => void;
  suggestionLabel?: string;
  minRows?: number;
}) {
  const needsComment = !!feedback.suitability && feedback.suitability !== '적합';
  return (
    <>
      <label>
        <span className="label">
          개선 필요사항{' '}
          {needsComment && (
            <em className="not-italic text-destructive" title="적합이 아니면 사유를 적어 주세요.">
              *
            </em>
          )}
        </span>
        <AutoTextarea
          value={feedback.comment}
          onChange={(v) => onChange({ comment: v })}
          placeholder="의견을 입력해 주세요."
          minRows={minRows}
        />
      </label>
      <label>
        <span className="label">{suggestionLabel}</span>
        <AutoTextarea
          value={feedback.suggestion}
          onChange={(v) => onChange({ suggestion: v })}
          placeholder="수정안을 입력해 주세요."
          minRows={minRows}
        />
      </label>
    </>
  );
}

/**
 * 과업·Skill·수행요건 항목 카드. 평가가 끝난 항목은 한 줄 요약으로 접어 25장짜리 목록을 견딜 만하게 만든다.
 * 접힘 여부는 부모가 정한다(부모가 "완료 항목 접기" 토글과 펼침 목록을 들고 있다).
 */
export function ReviewItemCard({
  eyebrow,
  title,
  counter,
  details,
  feedback,
  onChange,
  collapsed,
  onExpand,
  focusId,
  nextFocusId,
  suggestionLabel = '수정 제안',
  removeLabel,
}: {
  eyebrow: string;
  title: string;
  counter?: string;
  details?: React.ReactNode;
  feedback: Feedback;
  onChange: (v: Partial<Feedback>) => void;
  collapsed: boolean;
  onExpand: () => void;
  focusId: string;
  nextFocusId?: string;
  suggestionLabel?: string;
  removeLabel?: string;
}) {
  if (collapsed) {
    const choice = feedback.suitability as Choice;
    const Icon = SUITABILITY_ICON[choice];
    const notes = [
      feedback.comment.trim() && '의견 있음',
      feedback.suggestion.trim() && '제안 있음',
      feedback.remove && '삭제 요청',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <button
        type="button"
        id={focusId}
        onClick={onExpand}
        aria-expanded={false}
        className="flex w-full min-h-11 items-center gap-3 rounded-element border border-border bg-muted px-4 py-3 text-left transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon size={16} aria-hidden="true" className={`shrink-0 ${TONE_TEXT[choice]}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <span className={`shrink-0 text-xs font-medium ${TONE_TEXT[choice]}`}>{choice}</span>
        {notes && (
          <span className="hidden shrink-0 items-center gap-1 text-xs text-foreground-muted sm:inline-flex">
            <MessageSquareText size={13} aria-hidden="true" />
            {notes}
          </span>
        )}
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-foreground-subtle" />
        <span className="sr-only">펼쳐서 수정하기</span>
      </button>
    );
  }

  return (
    <div className="rounded-element border border-border p-4 lg:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold text-primary">{eyebrow}</span>
          <h4 className="mt-1 font-semibold text-foreground">{title}</h4>
        </div>
        {counter && (
          <span className="shrink-0 rounded-inner bg-muted px-2 py-1 text-[11px] text-foreground-muted">{counter}</span>
        )}
      </div>
      {details}
      <div className="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-[260px_1fr_1fr]">
        <div>
          <span className="label">적합성 평가</span>
          <SuitabilityControl
            value={feedback.suitability}
            onChange={(v) => onChange({ suitability: v })}
            focusId={focusId}
            nextFocusId={nextFocusId}
            label={`${title} 적합성 평가`}
          />
          {removeLabel && (
            <label className="mt-3 flex min-h-11 items-center gap-2 text-xs text-foreground-muted">
              <input
                type="checkbox"
                checked={!!feedback.remove}
                onChange={(e) => onChange({ remove: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--destructive))]"
              />
              {removeLabel}
            </label>
          )}
        </div>
        <FeedbackNotes feedback={feedback} onChange={onChange} suggestionLabel={suggestionLabel} />
      </div>
    </div>
  );
}

/** 섹션 제목 + "12개 중 8개 평가함" 진행 표시. */
export function SectionHeading({ title, done, total }: { title: string; done: number; total: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {total > 0 && (
        <span className={`text-xs ${done === total ? 'text-success' : 'text-foreground-muted'}`}>
          {total}개 중 {done}개 평가함
        </span>
      )}
    </div>
  );
}

/** 미평가만 보기 + 완료 항목 접기 토글 한 줄. 항목이 여러 개인 섹션에서만 쓴다. */
export function ListControls({
  onlyUnrated,
  setOnlyUnrated,
  collapseDone,
  setCollapseDone,
  hiddenCount,
}: {
  onlyUnrated: boolean;
  setOnlyUnrated: (v: boolean) => void;
  collapseDone: boolean;
  setCollapseDone: (v: boolean) => void;
  hiddenCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-element bg-muted px-4 py-2">
      <label className="flex min-h-11 items-center gap-2 text-xs text-foreground-muted">
        <input
          type="checkbox"
          checked={onlyUnrated}
          onChange={(e) => setOnlyUnrated(e.target.checked)}
          className="h-4 w-4 accent-[rgb(var(--primary))]"
        />
        미평가만 보기
      </label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-foreground-muted">
        <input
          type="checkbox"
          checked={collapseDone}
          onChange={(e) => setCollapseDone(e.target.checked)}
          className="h-4 w-4 accent-[rgb(var(--primary))]"
        />
        평가 완료 항목 접기
      </label>
      {onlyUnrated && hiddenCount > 0 && (
        <span className="text-xs text-foreground-subtle">평가한 {hiddenCount}개는 숨겨져 있어요.</span>
      )}
    </div>
  );
}

/**
 * 신규 과업/Skill 제안 편집기.
 * 예전에는 onClick 없는 점선 버튼이라 눌러도 아무 일이 없었다. 실제로 목록에 행을 추가한다.
 */
export function SuggestionEditor({
  kind,
  items,
  onChange,
}: {
  kind: string;
  items: SuggestionInput[];
  onChange: (items: SuggestionInput[]) => void;
}) {
  const patch = (i: number, v: Partial<SuggestionInput>) =>
    onChange(items.map((item, idx) => (idx === i ? { ...item, ...v } : item)));

  return (
    <div className="mt-4">
      {items.length > 0 && (
        <ul className="mb-3 space-y-3">
          {items.map((item, i) => (
            <li key={i} className="rounded-element border border-dashed border-primary-border bg-primary-subtle p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-primary">
                  신규 {kind} 제안 {i + 1}
                </span>
                <button
                  type="button"
                  aria-label={`신규 ${kind} 제안 ${i + 1} 삭제`}
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-element text-foreground-subtle transition hover:bg-destructive-muted hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <label>
                  <span className="label">
                    {kind}명 <em className="not-italic text-destructive">*</em>
                  </span>
                  <input
                    className="input"
                    value={item.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                    placeholder={`추가할 ${kind}명을 입력해 주세요.`}
                  />
                </label>
                <label>
                  <span className="label">설명</span>
                  <AutoTextarea
                    value={item.description}
                    onChange={(v) => patch(i, { description: v })}
                    placeholder="어떤 일인지 적어 주세요."
                  />
                </label>
                <label>
                  <span className="label">추가가 필요한 이유</span>
                  <AutoTextarea
                    value={item.reason}
                    onChange={(v) => patch(i, { reason: v })}
                    placeholder="왜 필요한지 적어 주세요."
                  />
                </label>
              </div>
              {!item.name.trim() && (
                <p className="mt-2 text-xs text-warning">
                  {kind}명이 비어 있으면 저장되지 않아요. 이름을 입력하거나 이 제안을 삭제해 주세요.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        onClick={() => onChange([...items, { name: '', description: '', reason: '' }])}
        className="w-full border-dashed"
      >
        <Plus size={15} aria-hidden="true" /> 신규 {kind} 제안 추가
      </Button>
    </div>
  );
}
