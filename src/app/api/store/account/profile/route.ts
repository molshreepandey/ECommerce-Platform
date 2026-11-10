import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import {
  getCustomerProfile,
  updateCustomerProfile,
} from '@/modules/identity/customer-account.service';
import { updateProfileSchema } from '@/modules/identity/identity.schema';

export const GET = apiHandler(async (request) => {
  const customer = await requireCustomer(request);
  return Response.json({ profile: await getCustomerProfile(customer) });
});

export const PATCH = apiHandler(async (request, _routeContext, requestContext) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, updateProfileSchema);
  const profile = await updateCustomerProfile(
    customer,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ profile });
});
