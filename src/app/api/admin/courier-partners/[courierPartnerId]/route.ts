import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { updateCourierPartnerSchema } from '@/modules/fulfilment/courier-admin.schema';
import { updateCourierPartner } from '@/modules/fulfilment/courier-admin.service';

import { courierPartnerIdFrom } from '../courier-partner-id';

type RouteContext = { params: Promise<{ courierPartnerId: string }> };

export const PATCH = apiHandler(async (request, routeContext: RouteContext, requestContext) => {
  const staff = await requirePermission(request, 'couriers.write');
  const courierPartnerId = await courierPartnerIdFrom(routeContext);
  const input = await parseJsonBody(request, updateCourierPartnerSchema);
  const courierPartner = await updateCourierPartner(
    staff,
    courierPartnerId,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ courierPartner });
});
