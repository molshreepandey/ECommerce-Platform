import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { storeBrandingSchema } from '@/modules/merchandising/store-branding.schema';
import {
  getStoreBrandingForStaff,
  updateStoreBranding,
} from '@/modules/merchandising/store-branding.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'merchandising.write');
  return Response.json({ branding: await getStoreBrandingForStaff(staff) });
});

export const PUT = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'merchandising.write');
  const input = await parseJsonBody(request, storeBrandingSchema);
  const branding = await updateStoreBranding(
    staff,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ branding });
});
