import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { storeSettingsSchema } from '@/modules/pricing/store-settings.schema';
import {
  getStoreSettingsForStaff,
  updateStoreSettings,
} from '@/modules/pricing/store-settings.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'settings.write');
  return Response.json({ settings: await getStoreSettingsForStaff(staff) });
});

export const PUT = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'settings.write');
  const input = await parseJsonBody(request, storeSettingsSchema);
  const settings = await updateStoreSettings(
    staff,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ settings });
});
