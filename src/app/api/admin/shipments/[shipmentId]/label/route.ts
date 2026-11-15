import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { pdfResponse } from '@/lib/pdf-response';
import { DomainError } from '@/lib/errors';
import { requirePermission } from '@/modules/identity/access-control';
import { buildShippingLabel } from '@/modules/ordering/shipping-label.service';

export const GET = apiHandler(
  async (request, { params }: { params: Promise<{ shipmentId: string }> }) => {
    const staff = await requirePermission(request, 'orders.read');
    const shipmentId = z.uuid().safeParse((await params).shipmentId);
    if (!shipmentId.success) {
      throw new DomainError({ kind: 'NOT_FOUND', code: 'LABEL_NOT_FOUND', message: 'Not found' });
    }
    const pdf = await buildShippingLabel(staff, shipmentId.data.toLowerCase());
    return pdfResponse(pdf, `label-${shipmentId.data}.pdf`);
  },
);
