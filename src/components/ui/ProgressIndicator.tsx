/*
 * ProgressIndicator — 선형 진행 막대(montage Progress indicator 규약, v3 T3 신설).
 *
 * 언제 이걸 쓰나(montage 로딩 3종 선택 기준):
 *   · 완료율을 알 수 있다              → ProgressIndicator  ← 이 파일
 *   · 반복되는 카드·목록·표를 불러온다 → Skeleton
 *   · 버튼을 눌러 시간이 걸린다        → Button loading (버튼 안 스피너)
 *   · 단계에 이름이 있다(3~5단계)      → ProgressTracker
 * 한 화면에 로딩 표현을 두 개 동시에 적용하지 않는다.
 *
 * 왜 필요했나: 4시트 Excel 검증과 SME 일괄 등록은 "n건 중 m건"을 알 수 있는데도
 * 도는 스피너만 보여 줬다. 200건을 올리는 관리자는 끝나는 시점을 짐작할 수 없었다.
 *
 * 규격 — 높이 2/4/6px, 값 변화는 200ms cubic-bezier(0.4,0,0.2,1).
 * medium·large는 태블릿·데스크톱에서만 권장한다(montage).
 */
export function ProgressIndicator({
  value,
  min = 0,
  max = 100,
  size = 'medium',
  tone = 'primary',
  label,
  valueText,
  /** 화면에 "12 / 200" 같은 숫자를 함께 보일지. 낭독기에는 언제나 전달된다. */
  showValue = false,
  className = '',
}: {
  value: number;
  min?: number;
  max?: number;
  size?: 'small' | 'medium' | 'large';
  /** 파괴적 작업(삭제 진행)은 destructive를 쓴다. 그 밖에는 primary. */
  tone?: 'primary' | 'destructive';
  /** 낭독기용 이름. 무엇의 진행인지 적는다(예: "SME 명부 검증"). */
  label: string;
  /** 숫자만으로 뜻이 통하지 않을 때 낭독기에 읽힐 문장(예: "2단계 시트 검증"). */
  valueText?: string;
  showValue?: boolean;
  className?: string;
}) {
  const safeMax = max > min ? max : min + 100;
  const clamped = Math.min(Math.max(value, min), safeMax);
  const span = safeMax - min;
  const pct = span > 0 ? ((clamped - min) / span) * 100 : 0;
  const height = size === 'small' ? 'h-0.5' : size === 'large' ? 'h-1.5' : 'h-1';

  return (
    <div className={className}>
      {showValue && (
        <p className="mb-1 flex items-baseline justify-between gap-2 t-caption text-foreground-muted">
          <span>{label}</span>
          <span className="tabular-nums">
            {clamped} / {safeMax}
          </span>
        </p>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={min}
        aria-valuemax={safeMax}
        aria-valuetext={valueText ?? `${clamped} / ${safeMax}`}
        className={`w-full overflow-hidden rounded-inner bg-fill-alt ${height}`}
      >
        {/*
          transform이 아니라 width를 움직인다 — 이 앱의 막대는 화면 폭이 자주 바뀌는 곳(모달 안)에
          있어 scaleX로 그리면 좌우 여백에서 값이 어긋난다. 전이 규격은 그대로 base(200ms)다.
        */}
        <div
          className={`h-full rounded-inner transition-[width] duration-base ease-toggle ${
            tone === 'destructive' ? 'bg-destructive' : 'bg-primary'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressIndicator;
