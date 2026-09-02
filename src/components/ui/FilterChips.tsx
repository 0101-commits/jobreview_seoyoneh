/*
 * FilterChips — 상태 필터 칩 한 줄(montage FilterButton 규약 차용, v2 §6-4).
 *
 * 왜 필요한가: 같은 마크업이 다섯 화면(검토 현황·진행 현황·문의 인박스·배정 관리·FTE 분포)에
 * 복붙돼 있었다. aria-pressed·선택 색·건수 표기가 조금씩 달랐다.
 *
 * 규약: 단일 선택, 선택된 칩만 채운 색, 건수는 라벨 뒤 괄호, 44px 터치 타깃 유지.
 */
export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** 옆에 붙는 건수. 주지 않으면 표시하지 않는다. */
  count?: number;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** 이 칩 줄이 무엇을 거르는지 — 낭독기가 그룹 이름으로 읽는다. */
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-11 items-center gap-1 rounded-element border px-3 t-label-2 font-medium transition sm:min-h-control-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              active
                ? 'border-primary bg-primary-subtle text-primary'
                : 'border-border bg-card text-foreground-muted hover:border-primary hover:text-primary'
            }`}
          >
            {option.label}
            {option.count !== undefined && <span className="tabular-nums">({option.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

export default FilterChips;
