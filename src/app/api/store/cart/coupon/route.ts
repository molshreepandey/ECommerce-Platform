import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { cartErrors } from '@/modules/cart/cart.errors';
import { applyCouponSchema } from '@/modules/cart/cart.schema';
import {
  applyCouponToCustomerCart,
  removeCouponFromCustomerCart,
} from '@/modules/cart/cart.service';
import { limitCartWrites } from '@/modules/cart/cart-rate-limit';
import { optionalCustomer, requestMetadata } from '@/modules/identity/access-control';

import { customerCartResponse } from '../cart-response';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const { code } = await parseJsonBody(request, applyCouponSchema);
  const customer = await optionalCustomer(request);
  if (customer === null) throw cartErrors.couponNeedsSignIn();
  await limitCartWrites(customer, requestMetadata(request, requestContext));
  await applyCouponToCustomerCart(customer, code);
  return customerCartResponse(customer);
});

export const DELETE = apiHandler(async (request, _routeContext, requestContext) => {
  const customer = await optionalCustomer(request);
  if (customer === null) throw cartErrors.couponNeedsSignIn();
  await limitCartWrites(customer, requestMetadata(request, requestContext));
  await removeCouponFromCustomerCart(customer);
  return customerCartResponse(customer);
});
