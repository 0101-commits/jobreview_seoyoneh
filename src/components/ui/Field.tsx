import React, { useId } from 'react';

interface FieldBase {
  label: string;
  /** 라벨 아래 보조 설명. */
  description?: string;
  /** 값이 있으면 오류 상태로 렌더링하고 aria-invalid를 켭니다. */
  error?: string;
  required?: boolean;
}

interface FieldInputProps extends FieldBase {
  /** 제어 입력 모드 — 내부에서 <input>을 직접 그립니다. */
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  name?: string;
  inputClassName?: string;
  children?: never;
}

interface FieldWrapperProps extends FieldBase {
  /** 래퍼 모드 — select·textarea 등 임의의 컨트롤을 감쌉니다. */
  children: React.ReactNode;
  value?: never;
  onChange?: never;
}

export type FieldProps = FieldInputProps | FieldWrapperProps;

export function Field(props: FieldProps) {
  const { label, description, error, required } = props;
  const id = useId();
  const descId = `${id}-desc`;
  const errId = `${id}-err`;
  const describedBy = [description && descId, error && errId].filter(Boolean).join(' ') || undefined;

  const labelNode = (
    <>
      {label}
      {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
    </>
  );

  // 오류 상태에서는 테두리로도 표시합니다(색만으로 알리지 않기).
  const controlState = error ? 'border-destructive focus:border-destructive focus:ring-destructive/10' : '';

  let control: React.ReactNode;
  if ('children' in props && props.children !== undefined) {
    // 자식이 단일 엘리먼트면 접근성 속성을 그대로 이어 붙입니다.
    control = React.isValidElement(props.children)
      ? React.cloneElement(props.children as React.ReactElement<Record<string, unknown>>, {
          id: (props.children.props as { id?: string }).id ?? id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
        })
      : props.children;
  } else {
    const p = props as FieldInputProps;
    control = (
      <input
        id={id}
        name={p.name}
        className={`input ${controlState} ${p.inputClassName ?? ''}`}
        value={p.value}
        onChange={e => p.onChange(e.target.value)}
        type={p.type}
        placeholder={p.placeholder}
        autoComplete={p.autoComplete}
        disabled={p.disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">{labelNode}</label>
      {description && <p id={descId} className="mb-1.5 text-xs text-foreground-muted">{description}</p>}
      {control}
      {error && <p id={errId} className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default Field;
