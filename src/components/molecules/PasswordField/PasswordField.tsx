'use client';

import { useId, useState } from 'react';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Icon } from '@/components/atoms/Icon';
import { Input } from '@/components/atoms/Input';
import { Text } from '@/components/atoms/Text';
import type { PasswordFieldProps } from './password-field.types';

export function PasswordField({
  label,
  name,
  error,
  hint,
  ...inputAttributes
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((id) => id !== null)
    .join(' ');
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={inputId} className="text-body2-medium text-headings">
        {label}
      </label>
      <div className="relative">
        <Input
          {...inputAttributes}
          id={inputId}
          name={name}
          type={isVisible ? 'text' : 'password'}
          isInvalid={error !== undefined}
          {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
        />
        <button
          type="button"
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          aria-pressed={isVisible}
          aria-controls={inputId}
          onClick={() => {
            setIsVisible((visible) => !visible);
          }}
          className={`absolute inset-y-0 end-0 inline-flex w-10 items-center justify-center rounded-default text-subtitles hover:text-headings ${focusRingClassNames}`}
        >
          <Icon name={isVisible ? 'eye-off' : 'eye'} size="sm" />
        </button>
      </div>
      {hint === undefined ? null : (
        <Text id={hintId} variant="body3" tone="muted">
          {hint}
        </Text>
      )}
      {error === undefined ? null : (
        <Text id={errorId} variant="body3" tone="danger">
          {error}
        </Text>
      )}
    </div>
  );
}
