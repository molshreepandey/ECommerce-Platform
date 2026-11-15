'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { paiseToRupeesText, rupeesTextToPaise } from '@/lib/money';
import { type StoreSettings, storeSettingsSchema } from '@/modules/pricing/store-settings.schema';
import { useAdminAction } from '../AdminActions/use-admin-action';

const rupeeFields = [
  {
    name: 'shippingFeePaise',
    label: 'Shipping fee (₹)',
    hint: 'Charged below the free-shipping amount.',
  },
  {
    name: 'freeShippingThresholdPaise',
    label: 'Free shipping from (₹)',
    hint: 'Applies to the amount after the coupon.',
  },
  {
    name: 'codFeePaise',
    label: 'Cash on Delivery fee (₹)',
    hint: 'Added only when paying on delivery.',
  },
  {
    name: 'maxCodOrderValuePaise',
    label: 'Largest Cash on Delivery order (₹)',
    hint: 'Larger orders must be paid online.',
  },
] as const;

function wholeNumber(text: string): number | string {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

// D47: tax default, fees, the COD limit, the return window and (Wave 16) the allocation strategy.
// Amounts are entered in rupees.
export function StoreSettingsForm({
  settings,
  canWrite,
}: Readonly<{ settings: StoreSettings; canWrite: boolean }>) {
  const { run, isPending, failure } = useAdminAction();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [allocationStrategy, setAllocationStrategy] = useState<string>(settings.allocationStrategy);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    const candidate = {
      ...Object.fromEntries(
        rupeeFields.map(({ name }) => [name, rupeesTextToPaise(text(name)) ?? text(name)]),
      ),
      defaultTaxRateBasisPoints: wholeNumber(text('defaultTaxRatePercent')),
      returnWindowDays: wholeNumber(text('returnWindowDays')),
      allocationStrategy,
    };
    const parsed = storeSettingsSchema.safeParse({
      ...candidate,
      defaultTaxRateBasisPoints:
        typeof candidate.defaultTaxRateBasisPoints === 'number'
          ? candidate.defaultTaxRateBasisPoints * 100
          : candidate.defaultTaxRateBasisPoints,
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    await run({ url: '/api/admin/settings', method: 'PUT', body: parsed.data }, 'Settings saved');
  }

  return (
    <form
      noValidate
      aria-label="Store settings"
      onSubmit={(event) => void save(event)}
      className="flex max-w-2xl flex-col gap-lg"
    >
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        {rupeeFields.map((field) => (
          <FormField
            key={field.name}
            label={field.label}
            name={field.name}
            hint={field.hint}
            inputMode="decimal"
            disabled={!canWrite}
            defaultValue={paiseToRupeesText(settings[field.name])}
            error={fieldErrors[field.name]}
          />
        ))}
        <FormField
          label="Default GST rate (%)"
          name="defaultTaxRatePercent"
          hint="Used for new product types; whole percent."
          inputMode="numeric"
          disabled={!canWrite}
          defaultValue={String(settings.defaultTaxRateBasisPoints / 100)}
          error={fieldErrors['defaultTaxRateBasisPoints']}
        />
        <FormField
          label="Return window (days)"
          name="returnWindowDays"
          inputMode="numeric"
          disabled={!canWrite}
          defaultValue={String(settings.returnWindowDays)}
          error={fieldErrors['returnWindowDays']}
        />
        <div className="md:col-span-2">
          <SelectField
            label="Warehouse for each order"
            name="allocationStrategy"
            options={[
              { value: 'PRIORITY', label: 'By warehouse priority' },
              { value: 'NEAREST_PINCODE', label: 'Nearest to the delivery pincode, then priority' },
            ]}
            value={allocationStrategy}
            onValueChange={setAllocationStrategy}
            disabled={!canWrite}
            error={fieldErrors['allocationStrategy']}
          />
        </div>
      </div>
      {canWrite ? (
        <div>
          <Button type="submit" appearance="primary" isLoading={isPending}>
            Save settings
          </Button>
        </div>
      ) : null}
    </form>
  );
}
