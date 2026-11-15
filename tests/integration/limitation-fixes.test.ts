import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { addToCustomerCart, applyCouponToCustomerCart } from '@/modules/cart/cart.service';
import { placeOrder, quoteCheckout } from '@/modules/ordering/checkout.service';
import { cancelOrderByCustomer, confirmOrder } from '@/modules/ordering/order-lifecycle.service';
import { createShipmentAwb, runShipmentAction } from '@/modules/ordering/shipment-actions.service';
import { getReturnOverview, requestReturn } from '@/modules/returns/returns.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  orderStaff,
  orderWithRelations,
  stockedVariant,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

async function couponCheckout(variantId: string, key: string) {
  const shopper = await createShopper();
  await addToCustomerCart(shopper.customer, { variantId, quantity: 1 });
  await applyCouponToCustomerCart(shopper.customer, 'ONLYONCE');
  const quote = await quoteCheckout(shopper.customer, {
    addressId: shopper.addressId,
    paymentMethod: 'COD',
  });
  const placed = await placeOrder(
    shopper.customer,
    {
      addressId: shopper.addressId,
      paymentMethod: 'COD',
      expectedTotalPaise: quote.breakdown.totalPaise,
    },
    key,
    testMetadata(),
  );
  return { shopper, placed };
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

describe('L63: a cancelled order gives its coupon use back', () => {
  it('a single-use coupon becomes usable again after its order is cancelled, audited', async () => {
    await database.coupon.create({
      data: {
        code: 'ONLYONCE',
        discountType: 'FLAT',
        discountValue: 5_000,
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 86_400_000),
        totalUsageLimit: 1,
      },
    });
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const first = await couponCheckout(variant.variantId, 'coupon-first-order-key');
    expect(await failure(couponCheckout(variant.variantId, 'coupon-second-order-key'))).toMatch(
      /^4\d\d /,
    );
    await cancelOrderByCustomer(
      first.shopper.customer,
      first.placed.orderId,
      'Changed my mind',
      testMetadata(),
    );
    const coupon = await database.coupon.findUniqueOrThrow({
      where: { code: 'ONLYONCE' },
      select: { usedCount: true },
    });
    expect(coupon.usedCount).toBe(0);
    expect(await database.couponRedemption.count()).toBe(0);
    expect(await database.auditLog.count({ where: { action: 'coupon.usage_returned' } })).toBe(1);
    await couponCheckout(variant.variantId, 'coupon-third-order-key');
    expect(
      (await database.coupon.findUniqueOrThrow({ where: { code: 'ONLYONCE' } })).usedCount,
    ).toBe(1);
  });

  it('cancelling an order without a coupon changes no coupon', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const shopper = await createShopper();
    const placed = await checkoutWith({
      customer: shopper.customer,
      addressId: shopper.addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    await cancelOrderByCustomer(
      shopper.customer,
      placed.orderId,
      'No longer needed',
      testMetadata(),
    );
    expect(await database.auditLog.count({ where: { action: 'coupon.usage_returned' } })).toBe(0);
  });
});

describe('L67: each package of a split line has its own return window', () => {
  it('only units of a package delivered within the window can be returned', async () => {
    const staff = await orderStaff();
    const variant = await stockedVariant([
      { priority: 1, onHandQuantity: 1 },
      { priority: 2, onHandQuantity: 1 },
    ]);
    const shopper = await createShopper();
    const placed = await checkoutWith({
      customer: shopper.customer,
      addressId: shopper.addressId,
      lines: [{ variantId: variant.variantId, quantity: 2 }],
    });
    await confirmOrder(staff, placed.orderId, testMetadata());
    const shipmentIds = (await orderWithRelations(placed.orderId)).shipments.map(({ id }) => id);
    for (const shipmentId of shipmentIds) {
      await runShipmentAction(staff, shipmentId, 'pack', null, testMetadata());
      await createShipmentAwb(staff, shipmentId, testMetadata());
      for (const step of ['ship', 'out-for-delivery', 'deliver'] as const) {
        await runShipmentAction(staff, shipmentId, step, null, testMetadata());
      }
    }
    const [old = '', recent = ''] = shipmentIds;
    await database.shipment.update({
      where: { id: old },
      data: { deliveredAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await database.shipment.update({
      where: { id: recent },
      data: { deliveredAt: new Date(Date.now() - 86_400_000) },
    });
    const overview = await getReturnOverview(shopper.customer, placed.orderId);
    expect(overview.lines[0]?.returnableQuantity).toBe(1);
    const request = (quantity: number) =>
      requestReturn(
        shopper.customer,
        placed.orderId,
        {
          requestType: 'RETURN',
          reason: 'Does not fit',
          items: [{ orderItemId: overview.lines[0]?.orderItemId ?? '', quantity }],
        },
        testMetadata(),
      );
    expect(await failure(request(2))).toBe('422 RETURN_QUANTITY_EXCEEDED');
    await request(1);
  });
});
