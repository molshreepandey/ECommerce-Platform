import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import {
  removePincodeSchema,
  serviceablePincodeSchema,
} from '@/modules/fulfilment/courier-admin.schema';
import {
  listServiceablePincodes,
  removeServiceablePincode,
  upsertServiceablePincode,
} from '@/modules/fulfilment/courier-admin.service';

import { courierPartnerIdFrom } from '../../courier-partner-id';

type RouteContext = { params: Promise<{ courierPartnerId: string }> };

export const GET = apiHandler(async (request, routeContext: RouteContext) => {
  const staff = await requirePermission(request, 'orders.read');
  return Response.json({
    pincodes: await listServiceablePincodes(staff, await courierPartnerIdFrom(routeContext)),
  });
});

export const PUT = apiHandler(async (request, routeContext: RouteContext, requestContext) => {
  const staff = await requirePermission(request, 'couriers.write');
  const courierPartnerId = await courierPartnerIdFrom(routeContext);
  const input = await parseJsonBody(request, serviceablePincodeSchema);
  await upsertServiceablePincode(
    staff,
    courierPartnerId,
    input,
    requestMetadata(request, requestContext),
  );
  return new Response(null, { status: 204 });
});

export const DELETE = apiHandler(async (request, routeContext: RouteContext, requestContext) => {
  const staff = await requirePermission(request, 'couriers.write');
  const courierPartnerId = await courierPartnerIdFrom(routeContext);
  const { pincode } = await parseJsonBody(request, removePincodeSchema);
  await removeServiceablePincode(
    staff,
    courierPartnerId,
    pincode,
    requestMetadata(request, requestContext),
  );
  return new Response(null, { status: 204 });
});
