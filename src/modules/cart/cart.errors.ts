import { DomainError } from '@/lib/errors';

export const cartErrors = {
  variantNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'VARIANT_NOT_FOUND',
      message: 'This product option was not found.',
    }),
  variantUnavailable: () =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'VARIANT_UNAVAILABLE',
      message: 'This product is no longer available.',
    }),
  insufficientStock: (availableQuantity: number, maximumQuantity: number) =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'INSUFFICIENT_STOCK',
      message:
        availableQuantity <= 0
          ? 'This item is out of stock.'
          : `Only ${String(Math.min(availableQuantity, maximumQuantity))} can be added.`,
      details: { availableQuantity, maximumQuantity },
    }),
  lineNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'CART_LINE_NOT_FOUND',
      message: 'This item is not in your cart.',
    }),
  cartFull: (maximumLines: number) =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'CART_FULL',
      message: `A cart can hold at most ${String(maximumLines)} different items.`,
    }),
  couponNotFound: () =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'COUPON_NOT_FOUND',
      message: 'This coupon code is not valid.',
    }),
  couponRejected: (code: string, message: string) =>
    new DomainError({ kind: 'UNPROCESSABLE', code, message }),
  couponNeedsSignIn: () =>
    new DomainError({
      kind: 'UNAUTHENTICATED',
      code: 'SIGN_IN_REQUIRED',
      message: 'Sign in to use a coupon.',
    }),
};
