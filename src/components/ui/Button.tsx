import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** true면 스피너를 띄우고 버튼을 잠급니다. */
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover focus-visible:outline-primary',
  secondary: 'border border-border bg-card text-foreground-muted hover:border-primary hover:text-primary focus-visible:outline-primary',
  ghost: 'text-foreground-muted hover:bg-muted hover:text-foreground focus-visible:outline-primary',
  danger: 'border border-destructive-border bg-destructive-muted text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-destructive',
};

// 모바일에서는 어느 크기든 터치 타깃 44px(min-h-11)을 확보하고,
// sm 브레이크포인트부터 컨트롤 높이 토큰 32/40/48로 내려갑니다.
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 sm:min-h-control-sm gap-1.5 px-3 text-xs',
  md: 'min-h-11 sm:min-h-control-md gap-1.5 px-4 text-sm',
  lg: 'min-h-control-lg gap-2 px-5 text-sm',
};

const spinnerSize: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
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
        'disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size],
        variants[variant],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && <Loader2 size={spinnerSize[size]} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export default Button;
