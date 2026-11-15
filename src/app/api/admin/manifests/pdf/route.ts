import { apiHandler } from '@/lib/api-handler';
import { pdfResponse } from '@/lib/pdf-response';
import { requirePermission } from '@/modules/identity/access-control';
import { manifestQuerySchema } from '@/modules/ordering/manifest.schema';
import { buildManifestPdf } from '@/modules/ordering/order-documents.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'orders.read');
  const { warehouseId, date } = manifestQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  return pdfResponse(await buildManifestPdf(staff, warehouseId, date), `manifest-${date}.pdf`);
});
