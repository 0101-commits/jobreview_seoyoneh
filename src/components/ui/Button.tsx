import React from 'react';
import { Loader2 } from 'lucide-react';

/*
 * Button — 버튼 한 벌(montage Button 규약, v2 §6-4 · v3 T3).
 *
 * montage는 버튼을 4단으로 본다. 한 화면의 메인 행동은 Level.4 하나로 한정하고,
 * 대체 행동(미리보기·임시저장처럼 메인과 나란히 놓이지만 주된 길이 아닌 것)은 Level.3로 내린다.
 *
 *   Level.4  solid  + primary    → variant="primary"    메인 행동
 *   Level.3  outlined+ primary   → variant="outline"    대체 행동   ← v3 T3 신설
 *   Level.2  solid  + assistive  → (이 앱에는 자리가 없다. 필요해지면 그때 만든다)
 *   Level.1  outlined+ assistive → variant="secondary"  닫기·취소·돌아가기
 *   그 밖에  텍스트만            → variant="ghost"
 *            파괴적 확인        → variant="danger"
 *
 * v3 T3에서 고친 것 셋
 *  ① outline(Level.3) 추가. v2에는 대체 행동을 놓을 자리가 없어 임시저장이 secondary로 내려가
 *     '취소'와 같은 위계로 보였다.
 *  ② 비활성 표현을 토큰으로 바꿨다. v2는 disabled:opacity-50이라 --interaction-disabled와
 *     --foreground-disabled를 정의해 두고 쓰지 않았다. 단 loading 중에는 색을 바꾸지 않는다 —
 *     진행 중인 버튼이 회색으로 죽으면 요청이 처리되고 있다는 신호가 사라진다.
 *  ③ iconOnly. 아이콘만 있는 버튼에 이름이 없으면 낭독기가 목적을 알 수 없다.
 *     montage는 이것을 린트로 막는데, 여기서는 타입으로 막는다 —
 *     iconOnly를 켜면 aria-label이 필수가 된다(빠뜨리면 컴파일이 실패한다).
 */

export type ButtonVariant = 'primary' | 'outline' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonBase extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** true면 스피너를 띄우고 버튼을 잠급니다. 색은 그대로 둡니다. */
  loading?: boolean;
}

/** 아이콘만 있는 버튼은 이름을 반드시 준다(montage 접근성 규칙). */
type IconOnlyProps = { iconOnly: true; 'aria-label': string };
type LabeledProps = { iconOnly?: false };

export type ButtonProps = ButtonBase & (IconOnlyProps | LabeledProps);

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-1 hover:bg-primary-hover active:bg-primary-heavy focus-visible:outline-primary',
  outline: 'border border-primary-border bg-card text-primary hover:bg-primary-subtle hover:border-primary focus-visible:outline-primary',
  secondary: 'border border-border bg-card text-foreground-muted hover:border-primary hover:text-primary focus-visible:outline-primary',
  ghost: 'text-foreground-muted hover:bg-muted hover:text-foreground focus-visible:outline-primary',
  danger: 'border border-destructive-border bg-destructive-muted text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-destructive',
};

// 모바일에서는 어느 크기든 터치 타깃 44px(min-h-11)을 확보하고,
// sm 브레이크포인트부터 컨트롤 높이 토큰 32/40/48로 내려갑니다.
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 sm:min-h-control-sm gap-1.5 px-3 t-caption',
  md: 'min-h-11 sm:min-h-control-md gap-1.5 px-4 t-label',
  lg: 'min-h-control-lg gap-2 px-5 t-label',
};

/** 아이콘 하나만 담을 때의 정사각 크기. 좌우 여백을 지우고 최소 폭을 높이와 맞춘다. */
const iconSizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 min-w-11 px-0 sm:min-h-control-sm sm:min-w-control-sm',
  md: 'min-h-11 min-w-11 px-0 sm:min-h-control-md sm:min-w-control-md',
  lg: 'min-h-control-lg min-w-control-lg px-0',
};

/*
 * 비활성 색. opacity로 통째 흐리는 대신 토큰을 쓴다(montage).
 * 테두리를 함께 지워 variant마다 다른 비활성 외형이 나오지 않게 한다.
 */
const DISABLED =
  'disabled:border-transparent disabled:bg-interaction-disabled disabled:text-foreground-disabled disabled:shadow-none';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconOnly = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center rounded-element font-medium transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed',
        // 진행 중인 버튼은 색을 잃지 않는다 — 잠겼을 뿐 아무 일도 안 하는 것이 아니다.
        loading ? '' : DISABLED,
        iconOnly ? iconSizes[size] : sizes[size],
        variants[variant],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && <Loader2 size={size === 'sm' ? 13 : size === 'md' ? 15 : 16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export default Button;
