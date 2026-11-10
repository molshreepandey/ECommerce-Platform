'use client';

import { useId } from 'react';
import { Checkbox } from '@/components/atoms/Checkbox';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import type { FieldErrors } from '@/lib/api-client';

export type AttributeFieldDefinition = Readonly<{
  code: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM';
  isRequired: boolean;
  allowedValues: readonly string[] | null;
}>;

export type AttributeValues = Readonly<Record<string, unknown>>;

const noValue = '__none__';

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function MultiChoiceField({
  definition,
  value,
  error,
  disabled,
  onChange,
}: Readonly<{
  definition: AttributeFieldDefinition;
  value: unknown;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: unknown) => void;
}>) {
  const errorId = useId();
  const chosen = asStringList(value);
  return (
    <fieldset
      className="flex flex-col gap-xs"
      {...(error === undefined ? {} : { 'aria-describedby': errorId })}
    >
      <legend className="text-body2-medium text-headings">
        {definition.label}
        {definition.isRequired ? ' (required)' : ''}
      </legend>
      <div className="flex flex-wrap gap-md">
        {(definition.allowedValues ?? []).map((option) => (
          <Checkbox
            key={option}
            label={option}
            checked={chosen.includes(option)}
            disabled={disabled}
            onCheckedChange={(checked) => {
              const next =
                checked === true ? [...chosen, option] : chosen.filter((item) => item !== option);
              onChange(next.length === 0 ? undefined : next);
            }}
          />
        ))}
      </div>
      {error === undefined ? null : (
        <Text id={errorId} variant="body3" tone="danger">
          {error}
        </Text>
      )}
    </fieldset>
  );
}

function AttributeField({
  definition,
  value,
  error,
  disabled,
  onChange,
}: Readonly<{
  definition: AttributeFieldDefinition;
  value: unknown;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: unknown) => void;
}>) {
  const label = `${definition.label}${definition.isRequired ? ' (required)' : ''}`;
  const name = `attributes.${definition.code}`;
  switch (definition.dataType) {
    case 'TEXT':
      return (
        <FormField
          label={label}
          name={name}
          value={typeof value === 'string' ? value : ''}
          error={error}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : event.target.value);
          }}
        />
      );
    case 'NUMBER':
      return (
        <FormField
          label={label}
          name={name}
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? String(value) : ''}
          error={error}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : Number(event.target.value));
          }}
        />
      );
    case 'BOOLEAN':
      return (
        <div className="flex flex-col gap-xs">
          <Checkbox
            label={definition.label}
            checked={value === true}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onChange(checked === true);
            }}
          />
          {error === undefined ? null : (
            <Text variant="body3" tone="danger">
              {error}
            </Text>
          )}
        </div>
      );
    case 'ENUM': {
      const options = (definition.allowedValues ?? []).map((option) => ({
        value: option,
        label: option,
      }));
      return (
        <SelectField
          label={label}
          name={name}
          options={
            definition.isRequired ? options : [{ value: noValue, label: 'None' }, ...options]
          }
          value={typeof value === 'string' ? value : definition.isRequired ? '' : noValue}
          placeholder="Choose a value"
          error={error}
          disabled={disabled}
          onValueChange={(next) => {
            onChange(next === noValue ? undefined : next);
          }}
        />
      );
    }
    case 'MULTI_ENUM':
      return (
        <MultiChoiceField
          definition={definition}
          value={value}
          error={error}
          disabled={disabled}
          onChange={onChange}
        />
      );
  }
}

// The form is built from the product type's attribute definitions, so a new type needs no code (D13).
export function AttributeFields({
  definitions,
  values,
  errors,
  disabled = false,
  onChange,
}: Readonly<{
  definitions: readonly AttributeFieldDefinition[];
  values: AttributeValues;
  errors: FieldErrors;
  disabled?: boolean;
  onChange: (values: AttributeValues) => void;
}>) {
  if (definitions.length === 0) {
    return (
      <Text variant="body3" tone="muted">
        This product type has no product attributes.
      </Text>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-md md:grid-cols-2">
      {definitions.map((definition) => (
        <AttributeField
          key={definition.code}
          definition={definition}
          value={values[definition.code]}
          error={errors[`attributes.${definition.code}`]}
          disabled={disabled}
          onChange={(value) => {
            const others = Object.entries(values).filter(([code]) => code !== definition.code);
            onChange(
              Object.fromEntries(
                value === undefined ? others : [...others, [definition.code, value]],
              ),
            );
          }}
        />
      ))}
    </div>
  );
}
