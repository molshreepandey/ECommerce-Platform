'use client';

import { z } from 'zod';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import type { ApiFailure } from '@/lib/api-client';
import { outcomeIsUnknown, useAdminAction } from '../AdminActions/use-admin-action';
import { formatQuantity } from './inventory-format';

export { outcomeIsUnknown } from '../AdminActions/use-admin-action';

const inventoryRefreshCodes = ['STALE_STOCK'] as const;

// Inventory dialogs: a stale-stock conflict refreshes too, so the dialog shows the current quantity.
export function useInventoryAction() {
  return useAdminAction({ refreshOnFailureCodes: inventoryRefreshCodes });
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
