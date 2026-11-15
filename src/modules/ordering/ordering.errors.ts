import { DomainError } from '@/lib/errors';

export const orderingErrors = {
  cartEmpty: () =>
    new DomainError({ kind: 'UNPROCESSABLE', code: 'CART_EMPTY', message: 'Your cart is empty.' }),
  customerBlocked: () =>
    new DomainError({
      kind: 'FORBIDDEN',
      code: 'CUSTOMER_BLOCKED',
      message: 'This account cannot place orders. Contact support.',
    }),
  addressNotFound: () =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'ADDRESS_NOT_FOUND',
      message: 'Choose one of your saved delivery addresses.',
    }),
  pincodeNotServiceable: (reason: string, message: string) =>
    new DomainError({ kind: 'UNPROCESSABLE', code: reason, message }),
  onlinePaymentUnavailable: () =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'ONLINE_PAYMENT_UNAVAILABLE',
      message: 'Online payment is not available. Choose Cash on Delivery.',
    }),
  unpaidOnlineOrdersLimit: (maximum: number) =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'UNPAID_ORDERS_LIMIT',
      message: `You already have ${String(maximum)} online orders waiting for payment. Pay for or cancel one first, or choose Cash on Delivery.`,
      details: { maximum },
    }),
  codLimitExceeded: (maximumPaise: number) =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'COD_LIMIT_EXCEEDED',
      message: 'This order is above the Cash on Delivery limit. Pay online instead.',
      details: { maximumPaise },
    }),
  cartLinesUnavailable: (lines: readonly { variantId: string; reason: string }[]) =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'CART_LINES_UNAVAILABLE',
      message: 'Some items in your cart are no longer available in that quantity.',
      details: { lines },
    }),
  outOfStock: (
    shortLines: readonly {
      variantId: string;
      requestedQuantity: number;
      availableQuantity: number;
    }[],
  ) =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'OUT_OF_STOCK',
      message: 'Some items ran out while you were checking out.',
      details: { lines: shortLines },
    }),
  priceChanged: (breakdown: unknown) =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'PRICE_CHANGED',
      message: 'Prices in your cart changed. Check the new total and place the order again.',
      details: { breakdown },
    }),
  couponRejected: (code: string, message: string) =>
    new DomainError({ kind: 'CONFLICT', code, message }),
  couponExhausted: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'COUPON_EXHAUSTED',
      message: 'This coupon has just run out. Remove it to continue.',
    }),
  idempotencyKeyReused: () =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This checkout request was already used for a different order.',
    }),
  orderNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'ORDER_NOT_FOUND',
      message: 'This order was not found.',
    }),
};
