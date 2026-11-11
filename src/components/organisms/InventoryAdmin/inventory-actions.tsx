'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { useToast } from '@/components/atoms/Toast';
import { type ApiFailure, sendJson } from '@/lib/api-client';
import { formatQuantity } from './inventory-format';

type Method = 'POST' | 'PUT' | 'PATCH';

// Calls the admin inventory API, toasts on success and refreshes the server-rendered data. A stale-stock
// conflict refreshes too, so the dialog shows the current quantity next to the error, and so does a
// failure that leaves the outcome unknown (network error, 5xx), so the page shows what was saved.
export function outcomeIsUnknown(failure: ApiFailure): boolean {
  return failure.status === 0 || (failure.status >= 500 && failure.code !== 'TRANSACTION_TIMEOUT');
}

export function useInventoryAction() {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function run(
    request: {
      url: string;
      method: Method;
      body: unknown;
      idempotencyKey?: string;
    },
    successMessage: string,
  ): Promise<unknown> {
    setIsPending(true);
    setFailure(null);
    const result = await sendJson(request.url, {
      method: request.method,
      body: request.body,
      ...(request.idempotencyKey === undefined
        ? {}
        : { headers: { 'Idempotency-Key': request.idempotencyKey } }),
    });
    setIsPending(false);
    if (!result.ok) {
      setFailure(result.failure);
      if (result.failure.code === 'STALE_STOCK' || outcomeIsUnknown(result.failure)) {
        router.refresh();
      }
      return null;
    }
    showToast({ title: successMessage, tone: 'success' });
    router.refresh();
    return result.data ?? {};
  }

  return {
    run,
    isPending,
    failure,
    clearFailure: () => {
      setFailure(null);
    },
  };
}

const staleDetails = z.object({
  expectedOnHandQuantity: z.number(),
  currentOnHandQuantity: z.number(),
});
const belowReservedDetails = z.object({
  onHandQuantity: z.number(),
  reservedQuantity: z.number(),
  requestedOnHandQuantity: z.number(),
});
const limitDetails = z.object({ maximumOnHandQuantity: z.number() });
const retryDetails = z.object({ retryAfterSeconds: z.number() });

// The words shown for a failed inventory change. Conflicts name the numbers involved, so the person can
// see what changed; every other failure keeps the server's message (never internal details).
const unknownOutcome =
  'The server did not confirm this change, so it may or may not have been saved. Check the numbers on the page; sending the same change again will not apply it twice.';

export function inventoryFailureMessage(failure: ApiFailure): string {
  if (outcomeIsUnknown(failure)) return unknownOutcome;
  if (failure.status === 403 && failure.code !== 'ORIGIN_NOT_ALLOWED') {
    return 'You do not have permission to make this change.';
  }
  switch (failure.code) {
    case 'STALE_STOCK': {
      const details = staleDetails.safeParse(failure.details);
      return details.success
        ? `The stock changed while you were editing: on hand is now ${formatQuantity(details.data.currentOnHandQuantity)}, not ${formatQuantity(details.data.expectedOnHandQuantity)}. Check the new number and try again.`
        : failure.message;
    }
    case 'STOCK_BELOW_RESERVED': {
      const details = belowReservedDetails.safeParse(failure.details);
      if (!details.success) return failure.message;
      const { onHandQuantity, reservedQuantity, requestedOnHandQuantity } = details.data;
      if (requestedOnHandQuantity < 0) {
        return `You cannot remove more than is on hand (${formatQuantity(onHandQuantity)}).`;
      }
      return `This would leave ${formatQuantity(requestedOnHandQuantity)} on hand, but ${formatQuantity(reservedQuantity)} are reserved for orders.`;
    }
    case 'ON_HAND_LIMIT_EXCEEDED': {
      const details = limitDetails.safeParse(failure.details);
      return details.success
        ? `This would take the stock on hand above the largest quantity allowed (${formatQuantity(details.data.maximumOnHandQuantity)}).`
        : failure.message;
    }
    case 'RATE_LIMITED': {
      const details = retryDetails.safeParse(failure.details);
      return details.success
        ? `Too many changes in a short time. Wait ${String(details.data.retryAfterSeconds)} seconds and try again.`
        : failure.message;
    }
    default:
      return failure.message;
  }
}

export function InventoryFailure({ failure }: Readonly<{ failure: ApiFailure | null }>) {
  if (failure === null) return null;
  return <InlineAlert tone="danger">{inventoryFailureMessage(failure)}</InlineAlert>;
}

export function InventoryReadOnlyNotice({
  canWrite,
  what,
}: Readonly<{ canWrite: boolean; what: string }>) {
  if (canWrite) return null;
  return (
    <Text variant="body3" tone="muted">
      {`You can view ${what} but not change it.`}
    </Text>
  );
}
