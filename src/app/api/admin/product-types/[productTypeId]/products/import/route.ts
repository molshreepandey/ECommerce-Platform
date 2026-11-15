import { apiHandler } from '@/lib/api-handler';
import { csvUploadSchema } from '@/lib/csv';
import { parseJsonBody } from '@/lib/request-body';
import { importProductsCsv } from '@/modules/catalogue/product-import.service';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

import { uuidParam } from '../../../../merchandising-id';

// D16: body { csv } in the type's import layout (see the export); 200 with savedCount and per-line
// errors. Each product is all or nothing; 422 CSV_HEADER_INVALID for columns that do not match the type.
export const POST = apiHandler(
  async (request, { params }: { params: Promise<{ productTypeId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'catalogue.write');
    const productTypeId = await uuidParam(params, 'productTypeId', 'PRODUCT_TYPE_NOT_FOUND');
    const { csv } = await parseJsonBody(request, csvUploadSchema);
    const actor = { staff, metadata: requestMetadata(request, requestContext) };
    return Response.json({ csvImport: await importProductsCsv(actor, productTypeId, csv) });
  },
);
