import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { setDefaultAddress } from '@/modules/identity/address.service';

type DefaultAddressRouteContext = RouteContext<'/api/store/account/addresses/[addressId]/default'>;

export const POST = apiHandler<DefaultAddressRouteContext>(
  async (request, routeContext, requestContext) => {
    const customer = await requireCustomer(request);
    const addressId = z.uuid().parse((await routeContext.params).addressId);
    const address = await setDefaultAddress(
      customer,
      addressId,
      requestMetadata(request, requestContext),
    );
    return Response.json({ address });
  },
);
