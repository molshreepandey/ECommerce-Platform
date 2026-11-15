import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { buildDemoWebhook } from '@/modules/fulfilment/demo-courier';
import { processCourierWebhook } from '@/modules/ordering/courier-webhook.service';
import {
  cancelOrderByCustomer,
  cancelOrderByStaff,
  confirmOrder,
} from '@/modules/ordering/order-lifecycle.service';
import {
  createShipmentAwb,
  runShipmentAction,
  simulateNextScan,
} from '@/modules/ordering/shipment-actions.service';

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
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
let courierCode = '';

async function errorCode(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof DomainError ? error.code : String(error)),
  );
}

async function placedCodOrder(lines = 1, onHandQuantity = 5) {
  const variant = await stockedVariant([{ priority: 1, onHandQuantity }]);
  const { customer, addressId } = await createShopper();
  const placed = await checkoutWith({
    customer,
    addressId,
    lines: [{ variantId: variant.variantId, quantity: lines }],
  });
  const order = await orderWithRelations(placed.orderId);
  const shipmentId = order.shipments[0]?.id ?? '';
  return { variant, customer, orderId: placed.orderId, shipmentId };
}

async function readyToShip() {
  const staff = await orderStaff();
  const placed = await placedCodOrder(2);
  await confirmOrder(staff, placed.orderId, testMetadata());
  await runShipmentAction(staff, placed.shipmentId, 'pack', null, testMetadata());
  await createShipmentAwb(staff, placed.shipmentId, testMetadata());
  return { ...placed, staff };
}

beforeEach(async () => {
  await truncateAllTestTables();
  courierCode = (await createCourier()).code;
});

describe('fulfilment flow (D33)', () => {
  it('confirm → pack → AWB → ship (stock dispatched) → out for delivery → delivered (COD collected)', async () => {
    const { staff, orderId, shipmentId, variant } = await readyToShip();
    let order = await orderWithRelations(orderId);
    expect(order.status).toBe('PROCESSING');
    expect(order.shipments[0]?.status).toBe('READY_TO_SHIP');
    expect(order.shipments[0]?.awbNumber).toMatch(/^DMO\d{12}$/);

    await runShipmentAction(staff, shipmentId, 'ship', null, testMetadata());
    let stock = await stockTotals(variant.variantId);
    expect(stock).toMatchObject({ onHand: 3, reserved: 0 });
    order = await orderWithRelations(orderId);
    expect(order.status).toBe('SHIPPED');

    await runShipmentAction(staff, shipmentId, 'out-for-delivery', null, testMetadata());
    await runShipmentAction(staff, shipmentId, 'deliver', null, testMetadata());
    order = await orderWithRelations(orderId);
    expect(order.status).toBe('DELIVERED');
    expect(order.payment?.status).toBe('COLLECTED');
    stock = await stockTotals(variant.variantId);
    expect(stock).toMatchObject({ onHand: 3, reserved: 0 });
    expect(order.statusHistory.map(({ toStatus }) => toStatus)).toEqual([
      'PLACED',
      'CONFIRMED',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);
  });

  it('refuses an invalid transition with 409 INVALID_TRANSITION', async () => {
    const staff = await orderStaff();
    const { orderId, shipmentId } = await placedCodOrder();
    await confirmOrder(staff, orderId, testMetadata());
    expect(
      await errorCode(runShipmentAction(staff, shipmentId, 'deliver', null, testMetadata())),
    ).toBe('INVALID_TRANSITION');
    expect(await errorCode(confirmOrder(staff, orderId, testMetadata()))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('will not pack before the order is confirmed', async () => {
    const staff = await orderStaff();
    const { shipmentId } = await placedCodOrder();
    expect(
      await errorCode(runShipmentAction(staff, shipmentId, 'pack', null, testMetadata())),
    ).toBe('ORDER_NOT_CONFIRMED');
  });

  it('refuses staff without orders.write (403)', async () => {
    const readOnly = await orderStaff(['orders.read']);
    const { orderId } = await placedCodOrder();
    const error = await confirmOrder(readOnly, orderId, testMetadata()).catch(
      (caught: unknown) => caught,
    );
    expect(error instanceof DomainError ? error.httpStatus : 0).toBe(403);
  });
});

describe('cancellation (C34, acceptance test 4)', () => {
  it('cancel before dispatch releases the reservation and voids the payment', async () => {
    const { customer, orderId, variant } = await placedCodOrder(2);
    expect((await stockTotals(variant.variantId)).reserved).toBe(2);
    await cancelOrderByCustomer(customer, orderId, 'Ordered by mistake', testMetadata());
    const order = await orderWithRelations(orderId);
    expect(order.status).toBe('CANCELLED');
    expect(order.payment?.status).toBe('VOIDED');
    expect(order.shipments.every(({ status }) => status === 'CANCELLED')).toBe(true);
    expect(await stockTotals(variant.variantId)).toMatchObject({ onHand: 5, reserved: 0 });
  });

  it('cancel after shipping is refused with 409', async () => {
    const { staff, orderId, shipmentId } = await readyToShip();
    await runShipmentAction(staff, shipmentId, 'ship', null, testMetadata());
    expect(await errorCode(cancelOrderByStaff(staff, orderId, 'Too late', testMetadata()))).toBe(
      'CANCEL_NOT_ALLOWED',
    );
  });

  it('a customer cannot cancel someone else’s order (404)', async () => {
    const { orderId } = await placedCodOrder();
    const stranger = await createShopper();
    expect(
      await errorCode(
        cancelOrderByCustomer(stranger.customer, orderId, 'Not mine', testMetadata()),
      ),
    ).toBe('ORDER_NOT_FOUND');
  });
});

describe('failed delivery and RTO (D36, acceptance test 4)', () => {
  it('delivery refused → RTO → payment FAILED and stock restocked on receipt', async () => {
    const { staff, orderId, shipmentId, variant } = await readyToShip();
    await runShipmentAction(staff, shipmentId, 'ship', null, testMetadata());
    await runShipmentAction(staff, shipmentId, 'out-for-delivery', null, testMetadata());
    await runShipmentAction(staff, shipmentId, 'mark-failed', 'Customer refused', testMetadata());
    await runShipmentAction(staff, shipmentId, 'initiate-rto', null, testMetadata());
    let order = await orderWithRelations(orderId);
    expect(order.status).toBe('RTO');
    expect(order.payment?.status).toBe('FAILED');
    expect((await stockTotals(variant.variantId)).onHand).toBe(3);
    await runShipmentAction(staff, shipmentId, 'receive-rto', null, testMetadata());
    order = await orderWithRelations(orderId);
    expect(order.shipments[0]?.status).toBe('RTO_RECEIVED');
    expect(await stockTotals(variant.variantId)).toMatchObject({ onHand: 5, reserved: 0 });
    expect(
      await errorCode(runShipmentAction(staff, shipmentId, 'receive-rto', null, testMetadata())),
    ).toBe('INVALID_TRANSITION');
  });

  it('a failed attempt can be re-attempted and then delivered', async () => {
    const { staff, orderId, shipmentId } = await readyToShip();
    for (const action of [
      'ship',
      'out-for-delivery',
      'mark-failed',
      'reattempt',
      'deliver',
    ] as const) {
      await runShipmentAction(staff, shipmentId, action, null, testMetadata());
    }
    const shipment = await database.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { deliveryAttemptCount: true },
    });
    expect(shipment.deliveryAttemptCount).toBe(1);
    expect((await orderWithRelations(orderId)).payment?.status).toBe('COLLECTED');
  });
});

describe('split shipments roll up the order status', () => {
  it('one of two shipments shipped → PARTIALLY_SHIPPED, then SHIPPED, then PARTIALLY_DELIVERED, DELIVERED', async () => {
    const staff = await orderStaff();
    const first = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const second = await stockedVariant([{ priority: 2, onHandQuantity: 5 }]);
    const { customer, addressId } = await createShopper();
    const placed = await checkoutWith({
      customer,
      addressId,
      lines: [
        { variantId: first.variantId, quantity: 1 },
        { variantId: second.variantId, quantity: 1 },
      ],
    });
    await confirmOrder(staff, placed.orderId, testMetadata());
    const shipmentIds = (await orderWithRelations(placed.orderId)).shipments.map(({ id }) => id);
    expect(shipmentIds).toHaveLength(2);
    for (const shipmentId of shipmentIds) {
      await runShipmentAction(staff, shipmentId, 'pack', null, testMetadata());
      await createShipmentAwb(staff, shipmentId, testMetadata());
    }
    const [one = '', two = ''] = shipmentIds;
    await runShipmentAction(staff, one, 'ship', null, testMetadata());
    expect((await orderWithRelations(placed.orderId)).status).toBe('PARTIALLY_SHIPPED');
    await runShipmentAction(staff, two, 'ship', null, testMetadata());
    expect((await orderWithRelations(placed.orderId)).status).toBe('SHIPPED');
    await runShipmentAction(staff, one, 'out-for-delivery', null, testMetadata());
    await runShipmentAction(staff, one, 'deliver', null, testMetadata());
    let order = await orderWithRelations(placed.orderId);
    expect(order.status).toBe('PARTIALLY_DELIVERED');
    expect(order.payment?.status).toBe('PENDING');
    await runShipmentAction(staff, two, 'out-for-delivery', null, testMetadata());
    await runShipmentAction(staff, two, 'deliver', null, testMetadata());
    order = await orderWithRelations(placed.orderId);
    expect(order.status).toBe('DELIVERED');
    expect(order.payment?.status).toBe('COLLECTED');
  });

  it('packs the second package after the first one has shipped (PARTIALLY_SHIPPED)', async () => {
    const staff = await orderStaff();
    const first = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const second = await stockedVariant([{ priority: 2, onHandQuantity: 5 }]);
    const { customer, addressId } = await createShopper();
    const placed = await checkoutWith({
      customer,
      addressId,
      lines: [
        { variantId: first.variantId, quantity: 1 },
        { variantId: second.variantId, quantity: 1 },
      ],
    });
    await confirmOrder(staff, placed.orderId, testMetadata());
    const [one = '', two = ''] = (await orderWithRelations(placed.orderId)).shipments.map(
      ({ id }) => id,
    );
    await runShipmentAction(staff, one, 'pack', null, testMetadata());
    await createShipmentAwb(staff, one, testMetadata());
    await runShipmentAction(staff, one, 'ship', null, testMetadata());
    expect((await orderWithRelations(placed.orderId)).status).toBe('PARTIALLY_SHIPPED');
    await runShipmentAction(staff, two, 'pack', null, testMetadata());
    const order = await orderWithRelations(placed.orderId);
    expect(order.shipments.find(({ id }) => id === two)?.status).toBe('PACKED');
    expect(order.status).toBe('PARTIALLY_SHIPPED');
  });
});

describe('courier webhooks (D42)', () => {
  it('applies a signed event once; a duplicate is ignored and a bad signature is refused (401)', async () => {
    const { shipmentId } = await readyToShip();
    const shipment = await database.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { awbNumber: true },
    });
    const webhook = buildDemoWebhook({
      partnerCode: courierCode,
      awbNumber: shipment.awbNumber ?? '',
      status: 'SHIPPED',
      location: 'Pune',
      now: new Date(),
    });
    const first = await processCourierWebhook({
      providerCode: courierCode,
      ...webhook,
      requestId: 'test',
    });
    expect(first.events[0]?.result).toBe('PROCESSED');
    const repeat = await processCourierWebhook({
      providerCode: courierCode,
      ...webhook,
      requestId: 'test',
    });
    expect(repeat.events[0]?.result).toBe('DUPLICATE');
    expect(await database.courierWebhookReceipt.count()).toBe(1);
    expect(
      (
        await database.shipment.findUniqueOrThrow({
          where: { id: shipmentId },
          select: { status: true },
        })
      ).status,
    ).toBe('SHIPPED');

    const tampered = await processCourierWebhook({
      providerCode: courierCode,
      rawBody: webhook.rawBody.replace('Pune', 'Mumbai'),
      signatureHeader: webhook.signatureHeader,
      requestId: 'test',
    }).catch((error: unknown) => error);
    expect(tampered instanceof DomainError ? [tampered.code, tampered.httpStatus] : null).toEqual([
      'WEBHOOK_SIGNATURE_INVALID',
      401,
    ]);
  });

  it('records an event that breaks the state machine as FAILED without changing the shipment', async () => {
    const { shipmentId } = await readyToShip();
    const shipment = await database.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { awbNumber: true },
    });
    const webhook = buildDemoWebhook({
      partnerCode: courierCode,
      awbNumber: shipment.awbNumber ?? '',
      status: 'DELIVERED',
      location: null,
      now: new Date(),
    });
    const result = await processCourierWebhook({
      providerCode: courierCode,
      ...webhook,
      requestId: 'test',
    });
    expect(result.events[0]?.result).toBe('FAILED');
    const receipt = await database.courierWebhookReceipt.findFirstOrThrow({
      select: { processingResult: true },
    });
    expect(receipt.processingResult).toBe('FAILED');
    // A courier retry of the refused event is not applied again, and it is still stored only once.
    const retry = await processCourierWebhook({
      providerCode: courierCode,
      ...webhook,
      requestId: 'test-retry',
    });
    expect(retry.events[0]?.result).toBe('DUPLICATE');
    expect(await database.courierWebhookReceipt.count()).toBe(1);
    expect(
      (
        await database.shipment.findUniqueOrThrow({
          where: { id: shipmentId },
          select: { status: true },
        })
      ).status,
    ).toBe('READY_TO_SHIP');
  });

  it('the simulate-next-scan button walks the demo journey to delivered', async () => {
    const { staff, orderId, shipmentId } = await readyToShip();
    for (const expected of ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const scan = await simulateNextScan(staff, shipmentId, 'DELIVERED', 'test');
      expect(scan.status).toBe(expected);
    }
    const order = await orderWithRelations(orderId);
    expect(order.status).toBe('DELIVERED');
    expect(order.payment?.status).toBe('COLLECTED');
    expect(await errorCode(simulateNextScan(staff, shipmentId, 'DELIVERED', 'test'))).toBe(
      'NO_NEXT_SCAN',
    );
  });
});
