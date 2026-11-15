import { apiHandler } from '@/lib/api-handler';
import { pdfResponse } from '@/lib/pdf-response';
import { requireCustomer } from '@/modules/identity/access-control';
import { buildCustomerInvoice } from '@/modules/ordering/order-documents.service';

import { orderIdFrom } from '../../order-id';

export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }) => {
    const customer = await requireCustomer(request);
    const orderId = await orderIdFrom(routeContext);
    return pdfResponse(await buildCustomerInvoice(customer, orderId), `invoice-${orderId}.pdf`);
  },
);
