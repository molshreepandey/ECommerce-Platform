import { cookies } from 'next/headers';

import { getDatabase } from '@/lib/db';
import { sumCustomerCartQuantity } from '@/modules/cart/cart.repository';
import { type CartView, getCustomerCartView, getGuestCartView } from '@/modules/cart/cart.service';
import { parseGuestCart } from '@/modules/cart/guest-cart';
import { guestCartCookieName } from '@/modules/cart/guest-cart-cookie';
import type { CustomerContext } from '@/modules/identity/access-control';
import { currentCustomerOrGuest } from '@/modules/identity/current-session';

async function guestLinesFromCookies() {
  return parseGuestCart((await cookies()).get(guestCartCookieName())?.value);
}

// Server Components (behind <Suspense>): the visitor's cart, saved for a signed-in customer or from the
// guest cookie otherwise.
export async function currentVisitorCart(): Promise<{
  cart: CartView;
  customer: CustomerContext | null;
}> {
  const customer = await currentCustomerOrGuest();
  if (customer !== null) return { cart: await getCustomerCartView(customer), customer };
  return { cart: await getGuestCartView(await guestLinesFromCookies()), customer: null };
}

export async function currentVisitorCartItemCount(): Promise<number> {
  const customer = await currentCustomerOrGuest();
  if (customer !== null) return sumCustomerCartQuantity(getDatabase(), customer.customerId);
  return (await guestLinesFromCookies()).reduce((total, line) => total + line.quantity, 0);
}
