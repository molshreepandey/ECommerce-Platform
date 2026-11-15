import { apiHandler } from '@/lib/api-handler';
import { readGuestCart } from '@/modules/cart/guest-cart-cookie';
import { optionalCustomer } from '@/modules/identity/access-control';

import { customerCartResponse, guestCartResponse } from './cart-response';

export const GET = apiHandler(async (request) => {
  const customer = await optionalCustomer(request);
  if (customer !== null) return customerCartResponse(customer);
  return guestCartResponse(readGuestCart(request));
});
