import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import type { CustomerContext } from '@/modules/identity/access-control';
import { runBulkOrderAction } from '@/modules/ordering/bulk-actions.service';
import {
  buildCustomerInvoice,
  buildPackingSlip,
  getManifest,
} from '@/modules/ordering/order-documents.service';
import { confirmOrder } from '@/modules/ordering/order-lifecycle.service';
import { createShipmentAwb, runShipmentAction } from '@/modules/ordering/shipment-actions.service';
import { reallocateShipment } from '@/modules/ordering/shipment-reallocation.service';
import { buildShippingLabel } from '@/modules/ordering/shipping-label.service';
import {
  decideReturn,
  exchangeReturn,
  markReturnPickedUp,
  markReturnReceived,
  refundReturn,
  restockReturn,
} from '@/modules/returns/return-admin.service';
import { getReturnOverview, requestReturn } from '@/modules/returns/returns.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  orderStaff,
  orderWithRelations,
  stockedVariant,
  stockTotals,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { createStockLevelRow, createWarehouseRow } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

async function staffWithAll() {
  return orderStaff(['orders.read', 'orders.write', 'returns.write']);
}

async function walkShipment(
  shipmentId: string,
  steps: readonly ('ship' | 'out-for-delivery' | 'deliver' | 'mark-failed' | 'initiate-rto')[],
) {
  const staff = await staffWithAll();
  await runShipmentAction(staff, shipmentId, 'pack', null, testMetadata());
  await createShipmentAwb(staff, shipmentId, testMetadata());
  for (const step of steps) await runShipmentAction(staff, shipmentId, step, null, testMetadata());
}

async function placedOrder(quantity = 2, onHandQuantity = 10) {
  const staff = await staffWithAll();
  const variant = await stockedVariant([{ priority: 1, onHandQuantity }]);
  const { customer, addressId } = await createShopper();
  const placed = await checkoutWith({
    customer,
    addressId,
    lines: [{ variantId: variant.variantId, quantity }],
  });
  await confirmOrder(staff, placed.orderId, testMetadata());
  const order = await orderWithRelations(placed.orderId);
  const item = await database.orderItem.findFirstOrThrow({
    where: { orderId: placed.orderId },
    select: { id: true },
  });
  return {
    staff,
    variant,
    customer,
    orderId: placed.orderId,
    shipmentId: order.shipments[0]?.id ?? '',
    orderItemId: item.id,
  };
}

async function deliveredOrder(quantity = 2) {
  const order = await placedOrder(quantity);
  await walkShipment(order.shipmentId, ['ship', 'out-for-delivery', 'deliver']);
  return order;
}

function returnInput(orderItemId: string, quantity: number) {
  return {
    requestType: 'RETURN' as const,
    reason: 'Size does not fit',
    items: [{ orderItemId, quantity }],
  };
}

async function returnRequestOf(
  customer: CustomerContext,
  orderId: string,
  orderItemId: string,
  quantity: number,
) {
  return requestReturn(customer, orderId, returnInput(orderItemId, quantity), testMetadata());
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

describe('returns (C37, D43)', () => {
  it('refuses a return before delivery and after the window (422)', async () => {
    const pending = await placedOrder();
    expect(
      await failure(returnRequestOf(pending.customer, pending.orderId, pending.orderItemId, 1)),
    ).toBe('422 RETURN_NOT_DELIVERED');

    const delivered = await deliveredOrder();
    await database.shipment.updateMany({
      where: { orderId: delivered.orderId },
      data: { deliveredAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    expect(
      await failure(
        returnRequestOf(delivered.customer, delivered.orderId, delivered.orderItemId, 1),
      ),
    ).toBe('422 RETURN_WINDOW_CLOSED');
  });

  it('never lets an RTO unit be returned (L60)', async () => {
    const order = await placedOrder();
    await walkShipment(order.shipmentId, [
      'ship',
      'out-for-delivery',
      'mark-failed',
      'initiate-rto',
    ]);
    expect(
      await failure(returnRequestOf(order.customer, order.orderId, order.orderItemId, 1)),
    ).toBe('422 RETURN_NOT_DELIVERED');
  });

  it('counts only delivered units when a line is split between a delivered and an RTO shipment (L60)', async () => {
    const staff = await staffWithAll();
    const variant = await stockedVariant([
      { priority: 1, onHandQuantity: 1 },
      { priority: 2, onHandQuantity: 1 },
    ]);
    const { customer, addressId } = await createShopper();
    const placed = await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 2 }],
    });
    await confirmOrder(staff, placed.orderId, testMetadata());
    const [delivered = '', returned = ''] = (
      await orderWithRelations(placed.orderId)
    ).shipments.map(({ id }) => id);
    await walkShipment(delivered, ['ship', 'out-for-delivery', 'deliver']);
    await walkShipment(returned, ['ship', 'out-for-delivery', 'mark-failed', 'initiate-rto']);
    const overview = await getReturnOverview(customer, placed.orderId);
    expect(overview.lines[0]?.returnableQuantity).toBe(1);
    const orderItemId = overview.lines[0]?.orderItemId ?? '';
    expect(await failure(returnRequestOf(customer, placed.orderId, orderItemId, 2))).toBe(
      '422 RETURN_QUANTITY_EXCEEDED',
    );
  });

  it('caps the quantity at delivered minus earlier requests', async () => {
    const order = await deliveredOrder(2);
    await returnRequestOf(order.customer, order.orderId, order.orderItemId, 1);
    expect(
      await failure(returnRequestOf(order.customer, order.orderId, order.orderItemId, 2)),
    ).toBe('422 RETURN_QUANTITY_EXCEEDED');
    const overview = await getReturnOverview(order.customer, order.orderId);
    expect(overview.lines[0]?.returnableQuantity).toBe(1);
  });

  it('runs a return to a refund: approve, pickup, receive, restock (stock back), refund capped at what was paid', async () => {
    const order = await deliveredOrder(2);
    const request = await returnRequestOf(order.customer, order.orderId, order.orderItemId, 2);
    expect(request.returnNumber).toMatch(/^RET-\d+-1$/);
    const warehouse = await createWarehouseRow();
    expect(await failure(markReturnPickedUp(order.staff, request.id, testMetadata()))).toBe(
      '409 INVALID_TRANSITION',
    );
    await decideReturn(
      order.staff,
      request.id,
      { decision: 'APPROVE', receivingWarehouseId: warehouse.id },
      testMetadata(),
    );
    await markReturnPickedUp(order.staff, request.id, testMetadata());
    await markReturnReceived(order.staff, request.id, testMetadata());
    await restockReturn(order.staff, request.id, testMetadata());
    const restocked = await database.inventoryLevel.findUniqueOrThrow({
      where: {
        variantId_warehouseId: { variantId: order.variant.variantId, warehouseId: warehouse.id },
      },
      select: { onHandQuantity: true },
    });
    expect(restocked.onHandQuantity).toBe(2);
    expect(
      await failure(
        refundReturn(
          order.staff,
          request.id,
          { refundMethod: 'UPI', reference: 'UTR123', amountPaise: 159_801 },
          testMetadata(),
        ),
      ),
    ).toBe('422 REFUND_TOO_LARGE');
    await refundReturn(
      order.staff,
      request.id,
      { refundMethod: 'UPI', reference: 'UTR123', amountPaise: 159_800 },
      testMetadata(),
    );
    const done = await database.returnRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, refund: { select: { amountPaise: true } } },
    });
    expect(done).toEqual({ status: 'REFUNDED', refund: { amountPaise: 159_800 } });
    expect(
      await database.auditLog.count({
        where: { entityType: 'return_request', entityId: request.id },
      }),
    ).toBe(6);
  });

  it('a rejected request frees its quantity for a new request', async () => {
    const order = await deliveredOrder(1);
    const request = await returnRequestOf(order.customer, order.orderId, order.orderItemId, 1);
    await decideReturn(
      order.staff,
      request.id,
      { decision: 'REJECT', note: 'Used item' },
      testMetadata(),
    );
    await returnRequestOf(order.customer, order.orderId, order.orderItemId, 1);
  });

  it('runs an exchange to a free replacement order with its stock reserved', async () => {
    const order = await deliveredOrder(1);
    const request = await requestReturn(
      order.customer,
      order.orderId,
      {
        requestType: 'EXCHANGE',
        reason: 'Need a different size',
        items: [
          {
            orderItemId: order.orderItemId,
            quantity: 1,
            exchangeVariantId: order.variant.variantId,
          },
        ],
      },
      testMetadata(),
    );
    await decideReturn(
      order.staff,
      request.id,
      { decision: 'APPROVE', receivingWarehouseId: order.variant.warehouseIds[0] ?? '' },
      testMetadata(),
    );
    await markReturnPickedUp(order.staff, request.id, testMetadata());
    await markReturnReceived(order.staff, request.id, testMetadata());
    await restockReturn(order.staff, request.id, testMetadata());
    expect(
      await failure(
        refundReturn(
          order.staff,
          request.id,
          { refundMethod: 'UPI', reference: 'X12', amountPaise: 100 },
          testMetadata(),
        ),
      ),
    ).toBe('409 INVALID_TRANSITION');
    await exchangeReturn(order.staff, request.id, testMetadata());
    const done = await database.returnRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, exchangeOrderId: true },
    });
    expect(done.status).toBe('EXCHANGED');
    const replacement = await orderWithRelations(done.exchangeOrderId ?? '');
    expect(replacement).toMatchObject({
      status: 'PLACED',
      totalPaise: 0,
      payment: { status: 'COLLECTED', amountPaise: 0 },
    });
    // 10 received − 1 dispatched + 1 restocked = 10 on hand; the replacement reserves 1.
    expect(await stockTotals(order.variant.variantId)).toMatchObject({ onHand: 10, reserved: 1 });
  });

  it('offers no free upgrade: an exchange is the same variant or one priced at most what was paid', async () => {
    const order = await deliveredOrder(1);
    const sibling = (sku: string, optionSignature: string, pricePaise: number) =>
      database.productVariant.create({
        data: {
          productId: order.variant.productId,
          sku,
          optionSignature,
          mrpPaise: 199_900,
          pricePaise,
          weightGrams: 300,
          lengthMm: 300,
          breadthMm: 250,
          heightMm: 30,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
    // The order line was bought at ₹799 (fixture price).
    const samePrice = await sibling(
      `EXCH-${order.orderItemId.slice(0, 8).toUpperCase()}-L`,
      'size=L',
      79_900,
    );
    const pricier = await sibling(
      `EXCH-${order.orderItemId.slice(0, 8).toUpperCase()}-XL`,
      'size=XL',
      149_900,
    );

    const overview = await getReturnOverview(order.customer, order.orderId);
    const offered = overview.lines[0]?.exchangeOptions.map(({ variantId }) => variantId) ?? [];
    expect(offered).toEqual(expect.arrayContaining([order.variant.variantId, samePrice.id]));
    expect(offered).not.toContain(pricier.id);

    const exchangeFor = (exchangeVariantId: string) =>
      requestReturn(
        order.customer,
        order.orderId,
        {
          requestType: 'EXCHANGE',
          reason: 'Need a different size',
          items: [{ orderItemId: order.orderItemId, quantity: 1, exchangeVariantId }],
        },
        testMetadata(),
      );
    expect(await failure(exchangeFor(pricier.id))).toBe('422 EXCHANGE_VARIANT_INVALID');
    expect((await exchangeFor(samePrice.id)).id).toEqual(expect.any(String));
  });
});

describe('re-allocation (D34)', () => {
  it('moves an unpacked shipment and its reservation to another warehouse', async () => {
    const order = await placedOrder(2);
    const other = await createWarehouseRow({ priority: 5 });
    await createStockLevelRow({
      variantId: order.variant.variantId,
      warehouseId: other.id,
      onHandQuantity: 5,
    });
    const moved = await reallocateShipment(order.staff, order.shipmentId, other.id, testMetadata());
    const after = await orderWithRelations(order.orderId);
    expect(after.shipments.find(({ id }) => id === order.shipmentId)?.status).toBe('CANCELLED');
    expect(after.shipments.find(({ id }) => id === moved.shipmentId)).toMatchObject({
      status: 'PENDING',
      warehouseId: other.id,
    });
    const levels = (await stockTotals(order.variant.variantId)).levels;
    expect(levels.find(({ warehouseId }) => warehouseId === other.id)?.reservedQuantity).toBe(2);
    expect(
      levels.find(({ warehouseId }) => warehouseId === order.variant.warehouseIds[0])
        ?.reservedQuantity,
    ).toBe(0);
    await runShipmentAction(order.staff, moved.shipmentId, 'pack', null, testMetadata());
  });

  it('refuses a warehouse without the stock (409) and leaves everything as it was', async () => {
    const order = await placedOrder(2);
    const empty = await createWarehouseRow({ priority: 5 });
    expect(
      await failure(reallocateShipment(order.staff, order.shipmentId, empty.id, testMetadata())),
    ).toBe('409 OUT_OF_STOCK');
    const after = await orderWithRelations(order.orderId);
    expect(after.shipments).toHaveLength(1);
    expect((await stockTotals(order.variant.variantId)).reserved).toBe(2);
  });

  it('refuses a packed shipment (409)', async () => {
    const order = await placedOrder(1);
    await runShipmentAction(order.staff, order.shipmentId, 'pack', null, testMetadata());
    const other = await createWarehouseRow({ priority: 5 });
    expect(
      await failure(reallocateShipment(order.staff, order.shipmentId, other.id, testMetadata())),
    ).toBe('409 REALLOCATION_NOT_ALLOWED');
  });
});

describe('bulk actions (D38)', () => {
  it('reports per-row results: confirmed, already confirmed, unknown', async () => {
    const staff = await staffWithAll();
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const first = await createShopper();
    const second = await createShopper();
    const one = await checkoutWith({
      customer: first.customer,
      addressId: first.addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    const two = await checkoutWith({
      customer: second.customer,
      addressId: second.addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    await confirmOrder(staff, two.orderId, testMetadata());
    const missing = '0195f0a0-0000-7000-8000-000000000009';
    const results = await runBulkOrderAction(
      staff,
      { action: 'confirm', orderIds: [one.orderId, two.orderId, missing] },
      testMetadata(),
    );
    expect(results.map(({ isSuccess, code }) => [isSuccess, code])).toEqual([
      [true, null],
      [false, 'INVALID_TRANSITION'],
      [false, 'ORDER_NOT_FOUND'],
    ]);
    const packed = await runBulkOrderAction(
      staff,
      { action: 'pack', orderIds: [one.orderId, two.orderId] },
      testMetadata(),
    );
    expect(packed.every(({ isSuccess }) => isSuccess)).toBe(true);
    expect((await orderWithRelations(one.orderId)).shipments[0]?.status).toBe('PACKED');
  });
});

describe('documents (C36, D35, D39)', () => {
  it('builds the invoice, the packing slip and the day manifest', async () => {
    const order = await placedOrder(1);
    await walkShipment(order.shipmentId, ['ship']);
    const invoice = (await buildCustomerInvoice(order.customer, order.orderId)).toString('latin1');
    expect(invoice.startsWith('%PDF-1.4')).toBe(true);
    expect(invoice).toContain('TAX INVOICE');
    expect(invoice).toContain('Rs. 799.00');
    const slip = (await buildPackingSlip(order.staff, order.shipmentId)).toString('latin1');
    expect(slip).toContain('PACKING SLIP');
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const manifest = await getManifest(order.staff, order.variant.warehouseIds[0] ?? '', today);
    expect(manifest.shipments.map(({ shipmentId }) => shipmentId)).toEqual([order.shipmentId]);
    expect(manifest.shipments[0]?.collectOnDeliveryPaise).toBe(79_900 + 2_900);
  });

  it('a split COD order collects each package’s share once, never the whole total twice (D35)', async () => {
    const staff = await staffWithAll();
    const variant = await stockedVariant([
      { priority: 1, onHandQuantity: 1 },
      { priority: 2, onHandQuantity: 1 },
    ]);
    const { customer, addressId } = await createShopper();
    const placed = await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 2 }],
    });
    await confirmOrder(staff, placed.orderId, testMetadata());
    const order = await orderWithRelations(placed.orderId);
    expect(order.shipments).toHaveLength(2);
    for (const shipment of order.shipments) await walkShipment(shipment.id, ['ship']);
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const shares: number[] = [];
    for (const warehouseId of variant.warehouseIds) {
      const manifest = await getManifest(staff, warehouseId, today);
      expect(manifest.shipments).toHaveLength(1);
      const row = manifest.shipments[0];
      shares.push(row?.collectOnDeliveryPaise ?? 0);
      const label = (await buildShippingLabel(staff, row?.shipmentId ?? '')).toString('latin1');
      expect(label).toContain(
        `COLLECT ON DELIVERY: Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format((row?.collectOnDeliveryPaise ?? 0) / 100)}`,
      );
    }
    expect(shares.every((share) => share > 0 && share < order.totalPaise)).toBe(true);
    expect(shares.reduce((total, share) => total + share, 0)).toBe(order.totalPaise);
  });
});
