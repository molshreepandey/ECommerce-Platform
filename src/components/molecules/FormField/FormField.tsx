'use client';

import { useId } from 'react';
import { Input } from '@/components/atoms/Input';
import { Text } from '@/components/atoms/Text';
import type { FormFieldProps } from './form-field.types';

export function FormField({ label, name, error, hint, ...inputAttributes }: FormFieldProps) {
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
      <Input
        {...inputAttributes}
        id={inputId}
        name={name}
        isInvalid={error !== undefined}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
      />
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
