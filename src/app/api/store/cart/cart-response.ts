import { NextResponse } from 'next/server';

import { getCustomerCartView, getGuestCartView } from '@/modules/cart/cart.service';
import type { GuestCartLine } from '@/modules/cart/guest-cart';
import { writeGuestCart } from '@/modules/cart/guest-cart-cookie';
import type { CustomerContext } from '@/modules/identity/access-control';

// Every cart route answers with the whole cart, so the page re-renders from one response.
export async function customerCartResponse(customer: CustomerContext, status = 200) {
  return NextResponse.json({ cart: await getCustomerCartView(customer) }, { status });
}

export async function guestCartResponse(lines: readonly GuestCartLine[], status = 200) {
  const response = NextResponse.json({ cart: await getGuestCartView(lines) }, { status });
  writeGuestCart(response, lines);
  return response;
}
