import { apiHandler } from '@/lib/api-handler';
import { pdfResponse } from '@/lib/pdf-response';
import { requirePermission } from '@/modules/identity/access-control';
import { buildStaffInvoice } from '@/modules/ordering/order-documents.service';

import { orderIdFrom } from '../../order-id';

export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }) => {
    const staff = await requirePermission(request, 'orders.read');
    const orderId = await orderIdFrom(routeContext);
    return pdfResponse(await buildStaffInvoice(staff, orderId), `invoice-${orderId}.pdf`);
  },
);
