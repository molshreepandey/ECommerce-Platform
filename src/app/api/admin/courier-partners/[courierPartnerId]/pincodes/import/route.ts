import { apiHandler } from '@/lib/api-handler';
import { csvUploadSchema } from '@/lib/csv';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { importServiceablePincodes } from '@/modules/fulfilment/pincode-import.service';

import { courierPartnerIdFrom } from '../../../courier-partner-id';

// D41 CSV upload: body { csv }; 200 with savedCount and per-line errors (bad rows are never written);
// 422 CSV_HEADER_INVALID / CSV_INVALID for a file that cannot be read at all.
export const POST = apiHandler(
  async (
    request,
    routeContext: { params: Promise<{ courierPartnerId: string }> },
    requestContext,
  ) => {
    const staff = await requirePermission(request, 'couriers.write');
    const courierPartnerId = await courierPartnerIdFrom(routeContext);
    const { csv } = await parseJsonBody(request, csvUploadSchema);
    return Response.json({
      csvImport: await importServiceablePincodes(
        staff,
        courierPartnerId,
        csv,
        requestMetadata(request, requestContext),
      ),
    });
  },
);
