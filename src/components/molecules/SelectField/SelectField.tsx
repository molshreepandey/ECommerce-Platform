'use client';

import { useId } from 'react';
import { Select } from '@/components/atoms/Select';
import { Text } from '@/components/atoms/Text';
import type { SelectFieldProps } from './select-field.types';

// A labelled Select: the label names the trigger (aria-labelledby) and errors are described.
export function SelectField({ label, error, hint, ...selectProps }: SelectFieldProps) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((id) => id !== null)
    .join(' ');
  return (
    <div className="flex flex-col gap-xs">
      <span id={labelId} className="text-body2-medium text-headings">
        {label}
      </span>
      <Select
        {...selectProps}
        id={fieldId}
        aria-labelledby={labelId}
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
