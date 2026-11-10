import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { archiveAddress, updateAddress } from '@/modules/identity/address.service';
import { updateAddressSchema } from '@/modules/identity/identity.schema';

type AddressRouteContext = RouteContext<'/api/store/account/addresses/[addressId]'>;

async function addressIdFrom(routeContext: AddressRouteContext): Promise<string> {
  return z.uuid().parse((await routeContext.params).addressId);
}

export const PATCH = apiHandler<AddressRouteContext>(
  async (request, routeContext, requestContext) => {
    const customer = await requireCustomer(request);
    const addressId = await addressIdFrom(routeContext);
    const input = await parseJsonBody(request, updateAddressSchema);
    const address = await updateAddress(
      customer,
      addressId,
      input,
      requestMetadata(request, requestContext),
    );
    return Response.json({ address });
  },
);

export const DELETE = apiHandler<AddressRouteContext>(
  async (request, routeContext, requestContext) => {
    const customer = await requireCustomer(request);
    const addressId = await addressIdFrom(routeContext);
    await archiveAddress(customer, addressId, requestMetadata(request, requestContext));
    return new Response(null, { status: 204 });
  },
);
