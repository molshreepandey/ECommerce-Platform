import type { NextRequest, NextResponse } from 'next/server';
import type { Logger } from 'pino';

import { mergeGuestCartIntoCustomerCart } from './cart.service';
import { clearGuestCart, readGuestCart } from './guest-cart-cookie';

// After a successful sign-in or registration (C22). A failed merge never fails the sign-in: the guest
// cookie is kept so the next sign-in can try again.
export async function mergeGuestCartAfterSignIn(input: {
  request: NextRequest;
  response: NextResponse;
  customerId: string;
  logger: Logger;
}): Promise<void> {
  const guestLines = readGuestCart(input.request);
  if (guestLines.length === 0) return;
  try {
    await mergeGuestCartIntoCustomerCart(input.customerId, guestLines);
    clearGuestCart(input.response);
  } catch (error) {
    input.logger.warn({ err: error }, 'guest cart merge failed');
  }
}
