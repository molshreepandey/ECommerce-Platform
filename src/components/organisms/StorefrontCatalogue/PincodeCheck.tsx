'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';

const responseSchema = z.object({
  serviceability: z.object({
    pincode: z.string(),
    isServiceable: z.boolean(),
    estimatedDeliveryDays: z.number().nullable(),
    isCashOnDeliveryAvailable: z.boolean(),
  }),
});

// C19: serviceable or not, estimated delivery days and whether Cash on Delivery is offered there.
export function PincodeCheck() {
  const [result, setResult] = useState<z.infer<typeof responseSchema>['serviceability'] | null>(
    null,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function check(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const pincode = formReader(event.currentTarget)('pincode').trim();
    if (!/^[1-9]\d{5}$/.test(pincode)) {
      setError('Enter a 6-digit pincode.');
      setResult(null);
      return;
    }
    setError(undefined);
    setIsPending(true);
    const response = await sendJson(`/api/store/serviceability?pincode=${pincode}`, {
      method: 'GET',
    });
    setIsPending(false);
    if (!response.ok) {
      setError(response.failure.message);
      return;
    }
    const parsed = responseSchema.safeParse(response.data);
    if (parsed.success) setResult(parsed.data.serviceability);
  }

  return (
    <div className="flex flex-col gap-sm rounded-card border border-lowlight bg-white p-md">
      <form
        noValidate
        aria-label="Check delivery"
        onSubmit={(event) => void check(event)}
        className="flex items-end gap-sm"
      >
        <div className="flex-1">
          <FormField
            label="Delivery pincode"
            name="pincode"
            inputMode="numeric"
            maxLength={6}
            error={error}
          />
        </div>
        <Button type="submit" isLoading={isPending}>
          Check
        </Button>
      </form>
      {result === null ? null : result.isServiceable ? (
        <Text variant="body3" tone="success">
          Delivers to {result.pincode} in about {String(result.estimatedDeliveryDays)} days ·{' '}
          {result.isCashOnDeliveryAvailable ? 'Cash on Delivery available' : 'Online payment only'}
        </Text>
      ) : (
        <Text variant="body3" tone="danger">
          We do not deliver to {result.pincode} yet.
        </Text>
      )}
    </div>
  );
}
