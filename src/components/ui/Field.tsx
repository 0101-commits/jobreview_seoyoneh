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

/**
 * 래퍼 모드에서 자식 컨트롤이 실제로 달아야 하는 접근성 속성 묶음.
 * 함수형 children이 이 값을 받아 입력 칸에 직접 펼쳐 씁니다.
 */
export interface FieldControlA11y {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

interface FieldWrapperProps extends FieldBase {
  /**
   * 래퍼 모드 — select·textarea 등 임의의 컨트롤을 감쌉니다.
   * 컨트롤을 div 등으로 한 번 감싸야 한다면 함수형으로 받아 입력 칸에 직접 속성을 답니다.
   */
  children: React.ReactNode | ((a11y: FieldControlA11y) => React.ReactNode);
  value?: never;
  onChange?: never;
}

export type FieldProps = FieldInputProps | FieldWrapperProps;

/** 라벨·aria를 이어 붙여도 되는 DOM 태그. 이 밖의 태그(예: div)는 라벨이 가리킬 대상이 아닙니다. */
const FORM_CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

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

  // 별표(*)는 aria-hidden이라 보조기기에 닿지 않습니다. 필수 여부는 컨트롤이 직접 전달합니다.
  // 네이티브 required가 아니라 aria-required인 이유 — 브라우저 기본 검증(제출 차단·말풍선)을
  // 래퍼 모드에 새로 끌어들이면 기존 호출부의 제출 흐름이 바뀝니다. 알림만 정확히 하고 동작은 그대로 둡니다.
  const a11y: FieldControlA11y = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };

  let control: React.ReactNode;
  let labelFor: string | undefined = id;
  if ('children' in props && props.children !== undefined) {
    const child = props.children;
    if (typeof child === 'function') {
      // 함수형 children — 감싼 div가 꼭 필요한 자리에서 aria 연결 대상을 입력 칸으로 지정합니다.
      control = child(a11y);
    } else if (React.isValidElement(child)) {
      if (typeof child.type === 'string' && !FORM_CONTROL_TAGS.has(child.type)) {
        // 자식이 폼 컨트롤이 아니면 id·aria를 넘겨도 라벨이 <div>를 가리키게 될 뿐이라 넘기지 않습니다.
        // 근본 수정은 호출부에서 입력 칸을 직접 자식으로 두거나 함수형 children을 쓰는 것입니다.
        if (import.meta.env.DEV) {
          console.warn(
            `[Field] "${label}" 의 자식이 <${child.type}>라 라벨·설명을 이어 붙이지 못했습니다. ` +
              '입력 칸을 직접 자식으로 두거나 함수형 children으로 id·aria-describedby를 받아 주세요.',
          );
        }
        control = child;
        labelFor = undefined;
      } else {
        // 자식이 단일 폼 컨트롤이면 접근성 속성을 그대로 이어 붙입니다.
        // 자식이 자기 id를 이미 가졌으면 라벨이 그 id를 가리키게 합니다(htmlFor가 빈 곳을 가리키지 않도록).
        labelFor = (child.props as { id?: string }).id ?? id;
        control = React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          ...a11y,
          id: labelFor,
        });
      }
    } else {
      control = child;
    }
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
      <label htmlFor={labelFor} className="mb-1.5 block text-sm font-medium text-foreground">{labelNode}</label>
      {description && <p id={descId} className="mb-1.5 text-xs text-foreground-muted">{description}</p>}
      {control}
      {error && <p id={errId} className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default Field;
