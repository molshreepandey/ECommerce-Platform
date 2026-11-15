import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { createCourierPartnerSchema } from '@/modules/fulfilment/courier-admin.schema';
import {
  createCourierPartner,
  listCourierPartners,
} from '@/modules/fulfilment/courier-admin.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'orders.read');
  return Response.json({ courierPartners: await listCourierPartners(staff) });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'couriers.write');
  const input = await parseJsonBody(request, createCourierPartnerSchema);
  const courierPartner = await createCourierPartner(
    staff,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ courierPartner }, { status: 201 });
});
