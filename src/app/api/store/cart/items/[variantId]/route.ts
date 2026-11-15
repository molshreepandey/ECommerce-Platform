import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { cartErrors } from '@/modules/cart/cart.errors';
import { updateCartItemSchema } from '@/modules/cart/cart.schema';
import {
  removeCustomerCartLine,
  removeGuestCartLine,
  updateCustomerCartLine,
  updateGuestCartLine,
} from '@/modules/cart/cart.service';
import { readGuestCart } from '@/modules/cart/guest-cart-cookie';
import { limitCartWrites } from '@/modules/cart/cart-rate-limit';
import { optionalCustomer, requestMetadata } from '@/modules/identity/access-control';

import { customerCartResponse, guestCartResponse } from '../../cart-response';

type RouteContext = { params: Promise<{ variantId: string }> };

async function variantIdFrom(routeContext: RouteContext): Promise<string> {
  const parsed = z.uuid().safeParse((await routeContext.params).variantId);
  if (!parsed.success) throw cartErrors.lineNotFound();
  return parsed.data.toLowerCase();
}

export const PATCH = apiHandler(async (request, routeContext: RouteContext, requestContext) => {
  const variantId = await variantIdFrom(routeContext);
  const { quantity } = await parseJsonBody(request, updateCartItemSchema);
  const customer = await optionalCustomer(request);
  await limitCartWrites(customer, requestMetadata(request, requestContext));
  if (customer !== null) {
    await updateCustomerCartLine(customer, variantId, quantity);
    return customerCartResponse(customer);
  }
  return guestCartResponse(await updateGuestCartLine(readGuestCart(request), variantId, quantity));
});

export const DELETE = apiHandler(async (request, routeContext: RouteContext, requestContext) => {
  const variantId = await variantIdFrom(routeContext);
  const customer = await optionalCustomer(request);
  await limitCartWrites(customer, requestMetadata(request, requestContext));
  if (customer !== null) {
    await removeCustomerCartLine(customer, variantId);
    return customerCartResponse(customer);
  }
  return guestCartResponse(removeGuestCartLine(readGuestCart(request), variantId));
});
