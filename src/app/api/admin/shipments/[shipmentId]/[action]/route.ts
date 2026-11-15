import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { shipmentActionBodySchema } from '@/modules/ordering/order-actions.schema';
import { reallocateShipment } from '@/modules/ordering/shipment-reallocation.service';
import {
  createShipmentAwb,
  isShipmentAction,
  runShipmentAction,
  simulateNextScan,
} from '@/modules/ordering/shipment-actions.service';

const notFound = () =>
  new DomainError({ kind: 'NOT_FOUND', code: 'NOT_FOUND', message: 'Not found' });

// D33 / D36: pack, create-awb, ship, out-for-delivery, deliver, mark-failed, reattempt, initiate-rto,
// receive-rto, and the demo's simulate-scan. Each answers 204; the page re-reads the order.
export const POST = apiHandler(
  async (
    request,
    { params }: { params: Promise<{ shipmentId: string; action: string }> },
    requestContext,
  ) => {
    const staff = await requirePermission(request, 'orders.write');
    const { shipmentId: rawShipmentId, action } = await params;
    const shipmentId = z.uuid().safeParse(rawShipmentId);
    if (!shipmentId.success) throw notFound();
    const id = shipmentId.data.toLowerCase();
    const metadata = requestMetadata(request, requestContext);
    const body =
      request.headers.get('content-length') === '0' || request.body === null
        ? shipmentActionBodySchema.parse(undefined)
        : await parseJsonBody(request, shipmentActionBodySchema);
    if (action === 'create-awb') {
      await createShipmentAwb(staff, id, metadata);
    } else if (action === 'reallocate') {
      if (body.warehouseId === undefined) {
        throw new DomainError({
          kind: 'VALIDATION',
          code: 'WAREHOUSE_REQUIRED',
          message: 'Choose the warehouse to move to.',
        });
      }
      return Response.json(await reallocateShipment(staff, id, body.warehouseId, metadata));
    } else if (action === 'simulate-scan') {
      const scan = await simulateNextScan(
        staff,
        id,
        body.outcome ?? 'DELIVERED',
        requestContext.requestId,
      );
      return Response.json({ scan });
    } else if (isShipmentAction(action)) {
      await runShipmentAction(staff, id, action, body.reason ?? null, metadata);
    } else {
      throw notFound();
    }
    return new Response(null, { status: 204 });
  },
);
