'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { Money } from '@/lib/money';
import {
  createVariantSchema,
  generateVariantsSchema,
  updateVariantSchema,
} from '@/modules/catalogue/catalogue.schema';
import { ActionFailure, StatusBadge, useCatalogueAction } from './catalogue-actions';

export type VariantItem = Readonly<{
  id: string;
  sku: string;
  optionValues: unknown;
  mrpPaise: number;
  pricePaise: number;
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}>;

export type VariantOptionDefinition = Readonly<{
  code: string;
  label: string;
  isRequired: boolean;
  allowedValues: readonly string[] | null;
}>;

type Dialog = { kind: 'create' } | { kind: 'generate' } | { kind: 'edit'; variant: VariantItem };

const measurementFields = [
  ['mrpPaise', 'MRP (paise)'],
  ['pricePaise', 'Price (paise)'],
  ['weightGrams', 'Weight (grams)'],
  ['lengthMm', 'Length (mm)'],
  ['breadthMm', 'Breadth (mm)'],
  ['heightMm', 'Height (mm)'],
] as const;
const optionValuesSchema = z.record(z.string(), z.string());
const formId = 'variant-form';

function rupees(paise: number): string {
  return Money.formatRupees(Money.fromPaise(paise));
}

function optionsText(optionValues: unknown): string {
  const parsed = optionValuesSchema.safeParse(optionValues);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return 'No options';
  return Object.entries(parsed.data)
    .map(([code, value]) => `${code}: ${value}`)
    .join(', ');
}

function readMeasurements(read: (name: string) => string) {
  return Object.fromEntries(measurementFields.map(([name]) => [name, Number(read(name))]));
}

function MeasurementFields({
  variant,
  errors,
}: Readonly<{ variant: VariantItem | null; errors: FieldErrors }>) {
  return (
    <div className="grid grid-cols-1 gap-md md:grid-cols-2">
      {measurementFields.map(([name, label]) => (
        <FormField
          key={name}
          label={label}
          name={name}
          type="number"
          inputMode="numeric"
          defaultValue={variant === null ? '' : String(variant[name])}
          error={errors[name]}
        />
      ))}
    </div>
  );
}

const nextStatusActions: Record<
  VariantItem['status'],
  readonly { status: VariantItem['status']; label: string }[]
> = {
  ACTIVE: [
    { status: 'INACTIVE', label: 'Deactivate' },
    { status: 'ARCHIVED', label: 'Archive' },
  ],
  INACTIVE: [
    { status: 'ACTIVE', label: 'Activate' },
    { status: 'ARCHIVED', label: 'Archive' },
  ],
  ARCHIVED: [{ status: 'ACTIVE', label: 'Restore' }],
};

export function VariantManager({
  productId,
  variants,
  variantOptions,
  canEdit,
}: Readonly<{
  productId: string;
  variants: readonly VariantItem[];
  variantOptions: readonly VariantOptionDefinition[];
  canEdit: boolean;
}>) {
  const { run, pendingKey, failure, clearFailure } = useCatalogueAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [chosenOptions, setChosenOptions] = useState<Record<string, string>>({});
  const [generatorValues, setGeneratorValues] = useState<Record<string, string[]>>({});

  function open(next: Dialog) {
    clearFailure();
    setFieldErrors({});
    setChosenOptions({});
    setGeneratorValues({});
    setDialog(next);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog === null) return;
    const read = formReader(event.currentTarget);
    const measurements = readMeasurements(read);
    const parsed =
      dialog.kind === 'create'
        ? createVariantSchema.safeParse({
            sku: read('sku'),
            optionValues: chosenOptions,
            ...measurements,
          })
        : dialog.kind === 'generate'
          ? generateVariantsSchema.safeParse({
              skuPrefix: read('skuPrefix'),
              options: generatorValues,
              ...measurements,
            })
          : updateVariantSchema.safeParse(measurements);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const request =
      dialog.kind === 'create'
        ? { url: `/api/admin/products/${productId}/variants`, method: 'POST' as const }
        : dialog.kind === 'generate'
          ? { url: `/api/admin/products/${productId}/variants/generate`, method: 'POST' as const }
          : { url: `/api/admin/variants/${dialog.variant.id}`, method: 'PATCH' as const };
    const message = {
      create: 'Variant added',
      generate: 'Variants generated',
      edit: 'Variant updated',
    }[dialog.kind];
    const saved = await run('variant', { ...request, body: parsed.data }, message);
    if (saved !== null) setDialog(null);
  }

  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };
  return (
    <div className="flex flex-col gap-lg">
      {dialog === null ? <ActionFailure failure={failure} /> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-sm">
          <Button
            appearance="primary"
            iconBefore="plus"
            onClick={() => {
              open({ kind: 'create' });
            }}
          >
            Add variant
          </Button>
          <Button
            iconBefore="layers"
            onClick={() => {
              open({ kind: 'generate' });
            }}
            disabled={variantOptions.length === 0}
          >
            Generate variants
          </Button>
        </div>
      ) : null}
      {variants.length === 0 ? (
        <EmptyState
          icon="package"
          headingLevel={2}
          title="No variants yet"
          description="A product needs at least one active variant before it can be activated."
        />
      ) : (
        <ul aria-label="Variants" className="flex flex-col gap-sm">
          {variants.map((variant) => (
            <li
              key={variant.id}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-xs">
                <div className="flex flex-wrap items-center gap-sm">
                  <Text variant="body2-medium">{variant.sku}</Text>
                  <StatusBadge status={variant.status} />
                </div>
                <Text variant="body3" tone="muted">
                  {optionsText(variant.optionValues)} · MRP {rupees(variant.mrpPaise)} · price{' '}
                  {rupees(variant.pricePaise)} · {variant.weightGrams} g · {variant.lengthMm}×
                  {variant.breadthMm}×{variant.heightMm} mm
                </Text>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-xs">
                  {variant.status === 'ARCHIVED' ? null : (
                    <Button
                      size="sm"
                      iconBefore="pencil"
                      onClick={() => {
                        open({ kind: 'edit', variant });
                      }}
                    >
                      Edit {variant.sku}
                    </Button>
                  )}
                  {nextStatusActions[variant.status].map(({ status, label }) => (
                    <Button
                      key={status}
                      size="sm"
                      appearance="subtle"
                      isLoading={pendingKey === `${variant.id}-${status}`}
                      onClick={() =>
                        void run(
                          `${variant.id}-${status}`,
                          {
                            url: `/api/admin/variants/${variant.id}/status`,
                            method: 'POST',
                            body: { status },
                          },
                          `Variant ${label.toLowerCase()}d`,
                        )
                      }
                    >
                      {label} {variant.sku}
                    </Button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={dialog !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        size="lg"
        title={
          dialog?.kind === 'edit'
            ? `Edit ${dialog.variant.sku}`
            : dialog?.kind === 'generate'
              ? 'Generate variants'
              : 'Add variant'
        }
        footer={
          <>
            <Button
              onClick={() => {
                setDialog(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              appearance="primary"
              isLoading={pendingKey === 'variant'}
            >
              {dialog?.kind === 'generate' ? 'Generate' : 'Save variant'}
            </Button>
          </>
        }
      >
        {dialog === null ? null : (
          <form
            id={formId}
            noValidate
            className="flex flex-col gap-md"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <ActionFailure failure={failure} />
            {dialog.kind === 'edit' ? (
              <Text variant="body3" tone="muted">
                SKU and options cannot change. Archive this variant and add a new one instead.
              </Text>
            ) : null}
            {dialog.kind === 'create' ? (
              <>
                <FormField
                  label="SKU"
                  name="sku"
                  hint="Letters and numbers joined by hyphens, for example KURTA-M-INDIGO."
                  error={errors['sku']}
                  autoComplete="off"
                />
                {variantOptions.map((option) => (
                  <SelectField
                    key={option.code}
                    label={`${option.label}${option.isRequired ? ' (required)' : ''}`}
                    name={`optionValues.${option.code}`}
                    options={(option.allowedValues ?? []).map((value) => ({ value, label: value }))}
                    value={chosenOptions[option.code] ?? ''}
                    placeholder="Choose a value"
                    error={errors[`optionValues.${option.code}`]}
                    onValueChange={(value) => {
                      setChosenOptions({ ...chosenOptions, [option.code]: value });
                    }}
                  />
                ))}
              </>
            ) : null}
            {dialog.kind === 'generate' ? (
              <>
                <FormField
                  label="SKU prefix"
                  name="skuPrefix"
                  hint="Each variant gets the prefix plus its option values."
                  error={errors['skuPrefix']}
                  autoComplete="off"
                />
                {variantOptions.map((option) => (
                  <fieldset key={option.code} className="flex flex-col gap-xs">
                    <legend className="text-body2-medium text-headings">{option.label}</legend>
                    <div className="flex flex-wrap gap-md">
                      {(option.allowedValues ?? []).map((value) => {
                        const chosen = generatorValues[option.code] ?? [];
                        return (
                          <Checkbox
                            key={value}
                            label={value}
                            checked={chosen.includes(value)}
                            onCheckedChange={(checked) => {
                              const next =
                                checked === true
                                  ? [...chosen, value]
                                  : chosen.filter((item) => item !== value);
                              const others = Object.entries(generatorValues).filter(
                                ([code]) => code !== option.code,
                              );
                              setGeneratorValues(
                                Object.fromEntries(
                                  next.length === 0 ? others : [...others, [option.code, next]],
                                ),
                              );
                            }}
                          />
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
                {errors['options'] === undefined ? null : (
                  <Text variant="body3" tone="danger">
                    {errors['options']}
                  </Text>
                )}
              </>
            ) : null}
            <MeasurementFields
              variant={dialog.kind === 'edit' ? dialog.variant : null}
              errors={errors}
            />
          </form>
        )}
      </Modal>
    </div>
  );
}
