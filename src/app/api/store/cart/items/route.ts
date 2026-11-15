import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { addCartItemSchema } from '@/modules/cart/cart.schema';
import { addToCustomerCart, addToGuestCart } from '@/modules/cart/cart.service';
import { readGuestCart } from '@/modules/cart/guest-cart-cookie';
import { limitCartWrites } from '@/modules/cart/cart-rate-limit';
import { optionalCustomer, requestMetadata } from '@/modules/identity/access-control';

import { customerCartResponse, guestCartResponse } from '../cart-response';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, addCartItemSchema);
  const customer = await optionalCustomer(request);
  await limitCartWrites(customer, requestMetadata(request, requestContext));
  if (customer !== null) {
    await addToCustomerCart(customer, input);
    return customerCartResponse(customer, 201);
  }
  return guestCartResponse(await addToGuestCart(readGuestCart(request), input), 201);
});
