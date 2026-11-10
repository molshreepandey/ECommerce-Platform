import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { createAddress, listAddresses } from '@/modules/identity/address.service';
import { createAddressSchema } from '@/modules/identity/identity.schema';

export const GET = apiHandler(async (request) => {
  const customer = await requireCustomer(request);
  return Response.json({ addresses: await listAddresses(customer) });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, createAddressSchema);
  const address = await createAddress(customer, input, requestMetadata(request, requestContext));
  return Response.json({ address }, { status: 201 });
});
