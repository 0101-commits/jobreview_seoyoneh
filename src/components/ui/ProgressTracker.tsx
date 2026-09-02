/*
 * ProgressTracker — 단계 표시 한 벌(montage ProgressTracker 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: 단계 표시가 두 벌이었다 — 마법사의 StepChecklist(세로 5단계)와
 * 업로드 화면의 StepIndicator(가로 4단계). 완료·현재·미도달 표기가 서로 달랐다.
 *
 * montage 규약: 3~5단계, 가로/세로, 모바일 라벨 6자 이하, 현재 단계는 aria-current="step".
 * 이 앱의 마법사는 "갈 수 있는 단계"라는 개념이 하나 더 있어(게이트) reachable을 함께 받는다.
 */
import { Check } from 'lucide-react';

export interface TrackerItem {
  /** 1부터 시작하는 단계 번호. 화면에 그대로 그린다. */
  step: number;
  label: string;
  complete: boolean;
  /** 아직 갈 수 없는 단계면 false. 누를 수 없고 흐리게 그린다. */
  reachable?: boolean;
  /** "3/12" 같은 진행 표기. 없으면 그리지 않는다. */
  hint?: string;
}

export function ProgressTracker({
  items,
  current,
  orientation = 'horizontal',
  onSelect,
  label = '진행 단계',
  className = '',
}: {
  items: TrackerItem[];
  current: number;
  orientation?: 'horizontal' | 'vertical';
  /** 주면 단계를 눌러 이동할 수 있다(마법사). 주지 않으면 표시 전용이다(업로드). */
  onSelect?: (step: number) => void;
  label?: string;
  className?: string;
}) {
  const vertical = orientation === 'vertical';

  return (
    <ol
      aria-label={label}
      className={`${vertical ? 'space-y-1' : 'flex flex-wrap items-center gap-x-2 gap-y-1'} ${className}`}
    >
      {items.map((item) => {
        const active = item.step === current;
        const reachable = item.reachable ?? true;
        const tone = active
          ? 'border-primary bg-primary-subtle text-primary'
          : item.complete
            ? 'border-border bg-card text-foreground-muted'
            : 'border-border bg-card text-foreground-subtle';

        const inner = (
          <>
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full t-caption font-semibold ${
                item.complete ? 'bg-success text-success-foreground' : active ? 'bg-primary text-primary-foreground' : 'bg-fill-alt text-foreground-muted'
              }`}
            >
              {item.complete ? <Check size={13} aria-hidden="true" /> : item.step}
            </span>
            <span className="min-w-0 flex-1 truncate t-label-2 font-medium">{item.label}</span>
            {item.hint && <span className="shrink-0 t-caption tabular-nums text-foreground-subtle">{item.hint}</span>}
          </>
        );

        const shared = `flex min-h-11 w-full items-center gap-2 rounded-element border px-3 ${tone}`;

        return (
          <li key={item.step} className={vertical ? '' : 'flex-1'} aria-current={active ? 'step' : undefined}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(item.step)}
                disabled={!reachable}
                className={`${shared} text-left transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
              >
                {inner}
              </button>
            ) : (
              <div className={shared}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default ProgressTracker;
