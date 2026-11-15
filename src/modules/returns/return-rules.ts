import type { ReturnRequestStatus, ReturnRequestType } from '@/generated/prisma/enums';

// D43: request → approve/reject → pickup → received at the warehouse → restock → manual refund (a
// return) or a replacement order (an exchange).
export const returnTransitions: Readonly<
  Record<ReturnRequestStatus, readonly ReturnRequestStatus[]>
> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PICKED_UP'],
  PICKED_UP: ['RECEIVED'],
  RECEIVED: ['RESTOCKED'],
  RESTOCKED: ['REFUNDED', 'EXCHANGED'],
  REJECTED: [],
  REFUNDED: [],
  EXCHANGED: [],
};

export function canMoveReturn(
  from: ReturnRequestStatus,
  to: ReturnRequestStatus,
  requestType: ReturnRequestType,
): boolean {
  if (!returnTransitions[from].includes(to)) return false;
  if (to === 'REFUNDED') return requestType === 'RETURN';
  if (to === 'EXCHANGED') return requestType === 'EXCHANGE';
  return true;
}

// C37: a unit can be returned only if it was delivered (never an RTO unit, L60), within the window
// counted from its own package's delivery (L67), and only once in total over all requests that were not
// rejected. Requests do not record their package, so the cap is the smaller of the units still inside a
// window and the delivered units not yet requested.
export function returnableQuantity(input: {
  deliveredQuantity: number;
  deliveredInOpenWindowQuantity: number;
  alreadyRequestedQuantity: number;
}): number {
  return Math.max(
    0,
    Math.min(
      input.deliveredInOpenWindowQuantity,
      input.deliveredQuantity - input.alreadyRequestedQuantity,
    ),
  );
}

export function returnWindowEndsAt(deliveredAt: Date, returnWindowDays: number): Date {
  return new Date(deliveredAt.getTime() + returnWindowDays * 86_400_000);
}

// What the customer actually paid per unit of a line after the order's coupon, rounded down so a refund
// never exceeds the payment.
export function refundablePerUnitPaise(input: {
  unitPricePaise: number;
  subtotalPaise: number;
  discountPaise: number;
}): number {
  if (input.subtotalPaise === 0) return 0;
  return Math.floor(
    (input.unitPricePaise * (input.subtotalPaise - input.discountPaise)) / input.subtotalPaise,
  );
}
