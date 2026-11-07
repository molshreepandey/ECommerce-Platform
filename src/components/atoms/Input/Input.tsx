import { fieldControlClassNames } from '../field-control';
import type { InputProps } from './input.types';

export function Input({
  size = 'md',
  isInvalid = false,
  type = 'text',
  ...inputAttributes
}: InputProps) {
  return (
    <input
      {...inputAttributes}
      type={type}
      aria-invalid={isInvalid}
      className={fieldControlClassNames({ size, isInvalid })}
    />
  );
}
