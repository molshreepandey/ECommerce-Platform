import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { manifestQuerySchema } from '@/modules/ordering/manifest.schema';
import { getManifest } from '@/modules/ordering/order-documents.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'orders.read');
  const { warehouseId, date } = manifestQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  return Response.json({ manifest: await getManifest(staff, warehouseId, date) });
});
