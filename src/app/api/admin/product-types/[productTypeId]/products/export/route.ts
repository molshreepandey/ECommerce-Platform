import { apiHandler } from '@/lib/api-handler';
import { csvResponse } from '@/lib/csv';
import { exportProductsCsv } from '@/modules/catalogue/product-import.service';
import { requirePermission } from '@/modules/identity/access-control';

import { uuidParam } from '../../../../merchandising-id';

// D16 export (also the upload template): the type's products in the import layout.
export const GET = apiHandler(
  async (request, { params }: { params: Promise<{ productTypeId: string }> }) => {
    const staff = await requirePermission(request, 'catalogue.read');
    const productTypeId = await uuidParam(params, 'productTypeId', 'PRODUCT_TYPE_NOT_FOUND');
    return csvResponse(
      await exportProductsCsv(staff, productTypeId),
      `products-${productTypeId}.csv`,
    );
  },
);
