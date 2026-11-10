import { z } from 'zod';

import type { AttributeDataType, AttributeScope } from '@/generated/prisma/enums';

export interface AttributeRule {
  code: string;
  label: string;
  dataType: AttributeDataType;
  scope: AttributeScope;
  isRequired: boolean;
  allowedValues: readonly string[] | null;
}

export type AttributeValue = string | number | boolean | readonly string[];
export type AttributeValues = Readonly<Record<string, AttributeValue>>;
export type OptionValues = Readonly<Record<string, string>>;
export type FieldErrors = Record<string, string[]>;

export type ValidationResult<Values> =
  { success: true; values: Values } | { success: false; fieldErrors: FieldErrors };

export const maximumTextAttributeLength = 500;

function allowedValuesOf(rule: AttributeRule): readonly string[] {
  return rule.allowedValues ?? [];
}

function singleChoiceSchema(rule: AttributeRule) {
  const allowedValues = allowedValuesOf(rule);
  return z.string().refine((value) => allowedValues.includes(value), {
    message: `Choose one of: ${allowedValues.join(', ')}`,
  });
}

function multipleChoiceSchema(rule: AttributeRule) {
  const allowedValues = allowedValuesOf(rule);
  return z
    .array(z.string())
    .min(1, 'Choose at least one value')
    .refine((values) => new Set(values).size === values.length, {
      message: 'Each value can be chosen only once',
    })
    .refine((values) => values.every((value) => allowedValues.includes(value)), {
      message: `Choose from: ${allowedValues.join(', ')}`,
    });
}

function valueSchema(rule: AttributeRule): z.ZodType<AttributeValue> {
  switch (rule.dataType) {
    case 'TEXT':
      return z.string().trim().min(1, 'Enter a value').max(maximumTextAttributeLength);
    case 'NUMBER':
      return z.number({ error: 'Enter a number' });
    case 'BOOLEAN':
      return z.boolean({ error: 'Choose yes or no' });
    case 'ENUM':
      return singleChoiceSchema(rule);
    case 'MULTI_ENUM':
      return multipleChoiceSchema(rule);
  }
}

function fieldSchema(rule: AttributeRule): z.ZodType<AttributeValue | undefined> {
  const schema = valueSchema(rule);
  return rule.isRequired ? schema : schema.optional();
}

function issuesToFieldErrors(issues: readonly z.core.$ZodIssue[], prefix: string): FieldErrors {
  const fieldErrors: FieldErrors = {};
  const addError = (field: string, message: string) => {
    (fieldErrors[`${prefix}.${field}`] ??= []).push(message);
  };
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) addError(key, 'This product type has no such attribute');
      continue;
    }
    const field = issue.path[0];
    if (field === undefined) {
      (fieldErrors[prefix] ??= []).push(issue.message);
      continue;
    }
    addError(String(field), issue.message);
  }
  return fieldErrors;
}

function validateAgainst<Values>(
  rules: readonly AttributeRule[],
  input: unknown,
  options: { prefix: string; schemaFor: (rule: AttributeRule) => z.ZodType },
): ValidationResult<Values> {
  const shape = Object.fromEntries(rules.map((rule) => [rule.code, options.schemaFor(rule)]));
  const result = z.strictObject(shape).safeParse(input);
  if (!result.success) {
    return {
      success: false,
      fieldErrors: issuesToFieldErrors(result.error.issues, options.prefix),
    };
  }
  const values = Object.fromEntries(
    Object.entries(result.data).filter(([, value]) => value !== undefined),
  );
  // Zod has checked every value against its rule above, so the shape is known at this boundary.
  return { success: true, values: values as Values };
}

// Product-level attributes: every key must be an active PRODUCT definition of the product's type.
export function validateProductAttributes(
  rules: readonly AttributeRule[],
  input: unknown,
): ValidationResult<AttributeValues> {
  return validateAgainst(
    rules.filter((rule) => rule.scope === 'PRODUCT'),
    input,
    { prefix: 'attributes', schemaFor: fieldSchema },
  );
}

// Variant options are always single-choice (enforced by the database for VARIANT_OPTION definitions).
export function validateVariantOptions(
  rules: readonly AttributeRule[],
  input: unknown,
): ValidationResult<OptionValues> {
  return validateAgainst(
    rules.filter((rule) => rule.scope === 'VARIANT_OPTION'),
    input,
    {
      prefix: 'optionValues',
      schemaFor: (rule) =>
        rule.isRequired ? singleChoiceSchema(rule) : singleChoiceSchema(rule).optional(),
    },
  );
}

// For activation: stored values must satisfy today's active definitions. Keys of archived
// definitions are ignored here (they are dropped on the next attribute edit).
export function attributeProblemsForActivation(
  rules: readonly AttributeRule[],
  storedAttributes: Readonly<Record<string, unknown>>,
): string[] {
  const productRules = rules.filter((rule) => rule.scope === 'PRODUCT');
  const relevantValues = Object.fromEntries(
    Object.entries(storedAttributes).filter(([code]) =>
      productRules.some((rule) => rule.code === code),
    ),
  );
  const result = validateProductAttributes(productRules, relevantValues);
  if (result.success) return [];
  return Object.entries(result.fieldErrors).map(
    ([field, messages]) => `${field}: ${messages.join('; ')}`,
  );
}

// The canonical identity of a combination, e.g. "colour=White|size=S" (codes sorted, as in the seed).
export function optionSignature(optionValues: OptionValues): string {
  return Object.keys(optionValues)
    .sort()
    .map((code) => `${code}=${optionValues[code] ?? ''}`)
    .join('|');
}
