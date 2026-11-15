import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import {
  getCustomerOrderNotifications,
  getStaffOrderNotifications,
} from '@/modules/notifications/notification-query.service';
import { maskedPhone } from '@/modules/notifications/notification.service';
import { confirmOrder } from '@/modules/ordering/order-lifecycle.service';
import { createShipmentAwb, runShipmentAction } from '@/modules/ordering/shipment-actions.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  orderStaff,
  orderWithRelations,
  stockedVariant,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { createStaffMember } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

describe('notification log (C38)', () => {
  it('records placed, shipped and delivered messages per package, with the phone masked', async () => {
    const staff = await orderStaff();
    const first = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const second = await stockedVariant([{ priority: 2, onHandQuantity: 5 }]);
    const shopper = await createShopper();
    const placed = await checkoutWith({
      customer: shopper.customer,
      addressId: shopper.addressId,
      lines: [
        { variantId: first.variantId, quantity: 1 },
        { variantId: second.variantId, quantity: 1 },
      ],
    });
    let messages = await getCustomerOrderNotifications(shopper.customer, placed.orderId);
    expect(messages.map(({ event }) => event)).toEqual(['ORDER_PLACED']);
    expect(messages[0]?.message).toContain(placed.orderNumber);
    expect(messages[0]?.message).toMatch(/Total ₹[\d,]+\.\d{2}, to pay on delivery\.$/);
    expect(messages[0]?.recipient).toMatch(/^•+\d{4}$/);

    await confirmOrder(staff, placed.orderId, testMetadata());
    const shipmentIds = (await orderWithRelations(placed.orderId)).shipments.map(({ id }) => id);
    for (const shipmentId of shipmentIds) {
      await runShipmentAction(staff, shipmentId, 'pack', null, testMetadata());
      await createShipmentAwb(staff, shipmentId, testMetadata());
      await runShipmentAction(staff, shipmentId, 'ship', null, testMetadata());
    }
    const [one = ''] = shipmentIds;
    await runShipmentAction(staff, one, 'out-for-delivery', null, testMetadata());
    await runShipmentAction(staff, one, 'deliver', null, testMetadata());
    messages = await getStaffOrderNotifications(staff, placed.orderId);
    expect(messages.map(({ event }) => event)).toEqual([
      'ORDER_PLACED',
      'SHIPMENT_SHIPPED',
      'SHIPMENT_SHIPPED',
      'SHIPMENT_DELIVERED',
    ]);
    expect(messages[1]?.message).toMatch(/\(AWB [A-Z0-9]+\)/);
    const rows = await database.auditLog.findMany({
      where: { action: 'notification.sent' },
      select: { after: true, actorType: true },
    });
    expect(rows.every(({ actorType }) => actorType === 'SYSTEM')).toBe(true);
    const address = await database.customerAddress.findFirstOrThrow({
      where: { id: shopper.addressId },
      select: { phone: true },
    });
    expect(JSON.stringify(rows)).not.toContain(address.phone);
  });

  it('records nothing for a checkout that is refused', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 1 }]);
    const buyer = await createShopper();
    await checkoutWith({
      customer: buyer.customer,
      addressId: buyer.addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    const late = await createShopper();
    expect(
      await failure(
        checkoutWith({
          customer: late.customer,
          addressId: late.addressId,
          lines: [{ variantId: variant.variantId, quantity: 1 }],
        }),
      ),
    ).toMatch(/^409 /);
    expect(await database.auditLog.count({ where: { action: 'notification.sent' } })).toBe(1);
  });

  it('keeps another customer’s messages away (404) and needs orders.read for staff (403)', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const owner = await createShopper();
    const placed = await checkoutWith({
      customer: owner.customer,
      addressId: owner.addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    const stranger = await createShopper();
    expect(await failure(getCustomerOrderNotifications(stranger.customer, placed.orderId))).toBe(
      '404 ORDER_NOT_FOUND',
    );
    const outsider = await createStaffMember(['catalogue.read']);
    expect(await failure(getStaffOrderNotifications(outsider, placed.orderId))).toBe(
      '403 PERMISSION_DENIED',
    );
  });

  it('masks every phone to its last four digits', () => {
    expect(maskedPhone('9876543210')).toBe('••••••3210');
    expect(maskedPhone(null)).toBe('unknown');
  });
});
