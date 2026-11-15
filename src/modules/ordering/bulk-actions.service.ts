import { z } from 'zod';

import type { ShipmentStatus } from '@/generated/prisma/enums';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import { listOrdersForBulk } from './order-lifecycle.repository';
import { confirmOrder } from './order-lifecycle.service';
import { createShipmentAwb, runShipmentAction } from './shipment-actions.service';

export const bulkOrderActionSchema = z.strictObject({
  action: z.enum(['confirm', 'pack', 'create-awb', 'ship']),
  orderIds: z
    .array(z.uuid().transform((value) => value.toLowerCase()))
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'Each order once.'),
});

export type BulkOrderAction = z.infer<typeof bulkOrderActionSchema>['action'];

export interface BulkRowResult {
  orderId: string;
  orderNumber: string | null;
  isSuccess: boolean;
  code: string | null;
  message: string;
}

const shipmentStepFrom: Readonly<Record<Exclude<BulkOrderAction, 'confirm'>, ShipmentStatus>> = {
  pack: 'PENDING',
  'create-awb': 'PACKED',
  ship: 'READY_TO_SHIP',
};

async function applyToOrder(
  staff: StaffContext,
  action: BulkOrderAction,
  order: { id: string; shipments: { id: string; status: ShipmentStatus }[] },
  metadata: RequestMetadata,
): Promise<string> {
  if (action === 'confirm') {
    await confirmOrder(staff, order.id, metadata);
    return 'Confirmed';
  }
  const eligible = order.shipments.filter(({ status }) => status === shipmentStepFrom[action]);
  if (eligible.length === 0) {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'NOTHING_TO_DO',
      message: 'No shipment of this order is at that step.',
    });
  }
  let updatedCount = 0;
  for (const shipment of eligible) {
    try {
      if (action === 'create-awb') await createShipmentAwb(staff, shipment.id, metadata);
      else await runShipmentAction(staff, shipment.id, action, null, metadata);
    } catch (error) {
      if (updatedCount === 0 || !(error instanceof DomainError)) throw error;
      // Each shipment is its own transaction: say which part of the order already moved.
      throw new DomainError({
        kind: error.kind,
        code: error.code,
        message: `${String(updatedCount)} of ${String(eligible.length)} shipments updated, then: ${error.message}`,
        details: { updatedShipmentCount: updatedCount, shipmentId: shipment.id },
      });
    }
    updatedCount += 1;
  }
  return `${String(eligible.length)} ${eligible.length === 1 ? 'shipment' : 'shipments'} updated`;
}

// D38: each order is its own transaction, so one refusal never undoes or blocks the others; every row
// reports its own result (partial success is normal).
export async function runBulkOrderAction(
  staff: StaffContext,
  input: z.infer<typeof bulkOrderActionSchema>,
  metadata: RequestMetadata,
): Promise<BulkRowResult[]> {
  assertStaffPermission(staff, 'orders.write');
  const orders = new Map(
    (await listOrdersForBulk(getDatabase(), input.orderIds)).map((order) => [order.id, order]),
  );
  const results: BulkRowResult[] = [];
  for (const orderId of input.orderIds) {
    const order = orders.get(orderId);
    if (order === undefined) {
      results.push({
        orderId,
        orderNumber: null,
        isSuccess: false,
        code: 'ORDER_NOT_FOUND',
        message: 'This order was not found.',
      });
      continue;
    }
    try {
      const message = await applyToOrder(staff, input.action, order, metadata);
      results.push({
        orderId,
        orderNumber: order.orderNumber,
        isSuccess: true,
        code: null,
        message,
      });
    } catch (error) {
      if (!(error instanceof DomainError))
        getLogger().error({ err: error, orderId }, 'bulk order action failed');
      results.push({
        orderId,
        orderNumber: order.orderNumber,
        isSuccess: false,
        code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
        message:
          error instanceof DomainError ? error.message : 'Something went wrong for this order.',
      });
    }
  }
  return results;
}
