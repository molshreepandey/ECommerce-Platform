import { apiHandler } from '@/lib/api-handler';
import { pdfResponse } from '@/lib/pdf-response';
import { requirePermission } from '@/modules/identity/access-control';
import { buildPackingSlip } from '@/modules/ordering/order-documents.service';

import { uuidParam } from '../../../merchandising-id';

export const GET = apiHandler(
  async (request, { params }: { params: Promise<{ shipmentId: string }> }) => {
    const staff = await requirePermission(request, 'orders.read');
    const shipmentId = await uuidParam(params, 'shipmentId', 'SHIPMENT_NOT_FOUND');
    return pdfResponse(await buildPackingSlip(staff, shipmentId), `packing-slip-${shipmentId}.pdf`);
  },
);
