import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import {
  addToCustomerCart,
  applyCouponToCustomerCart,
  getCustomerCartView,
} from '@/modules/cart/cart.service';
import { placeOrder, quoteCheckout } from '@/modules/ordering/checkout.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  idempotencyKey,
  orderWithRelations,
  stockedVariant,
  stockTotals,
  unservicedPincode,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function expectDomainError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect(error instanceof DomainError ? error.code : null).toBe(code);
  return error instanceof DomainError ? error : null;
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

describe('checkout happy path (acceptance test 1)', () => {
  it('places a COD order: priced, reserved, one shipment, payment pending, cart emptied, audited', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const { customer, addressId } = await createShopper();
    const placed = await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 2 }],
    });

    expect(placed.isReplay).toBe(false);
    expect(placed.orderNumber).toMatch(/^ORD-\d+$/);
    const order = await orderWithRelations(placed.orderId);
    expect(order.status).toBe('PLACED');
    // 2 × ₹799 = ₹1,598 (free shipping above ₹499) + ₹29 COD fee.
    expect(order.totalPaise).toBe(159_800 + 2_900);
    expect(order.payment).toEqual({ status: 'PENDING', amountPaise: order.totalPaise });
    expect(order.shipments).toHaveLength(1);
    expect(order.items).toEqual([{ quantity: 2, weightGrams: 300, categoryName: null }]);
    expect(order.statusHistory.map(({ toStatus }) => toStatus)).toEqual(['PLACED']);
    expect((await stockTotals(variant.variantId)).reserved).toBe(2);
    expect((await getCustomerCartView(customer)).lines).toHaveLength(0);
    expect(
      await database.auditLog.count({
        where: { action: 'order.placed', entityId: placed.orderId },
      }),
    ).toBe(1);
    expect(
      await database.inventoryMovement.count({
        where: { movementType: 'RESERVE', referenceId: order.shipments[0]?.id ?? '' },
      }),
    ).toBe(1);
  });

  it('charges no COD fee for an online order', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const { customer, addressId } = await createShopper();
    const placed = await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
      paymentMethod: 'ONLINE',
    });
    const order = await orderWithRelations(placed.orderId);
    expect(order.paymentMethod).toBe('ONLINE');
    expect(order.totalPaise).toBe(79_900);
  });
});

describe('stock is re-checked and never oversold (acceptance test 2)', () => {
  it('refuses with 409 when stock dropped after the item was added', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 2 }]);
    const { customer, addressId } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 2 });
    const quote = await quoteCheckout(customer, { addressId, paymentMethod: 'COD' });
    await database.inventoryLevel.updateMany({
      where: { variantId: variant.variantId },
      data: { onHandQuantity: 1 },
    });
    const error = await expectDomainError(
      placeOrder(
        customer,
        { addressId, paymentMethod: 'COD', expectedTotalPaise: quote.breakdown.totalPaise },
        idempotencyKey(),
        testMetadata(),
      ),
      'CART_LINES_UNAVAILABLE',
    );
    expect(error?.httpStatus).toBe(409);
    expect(await database.order.count()).toBe(0);
  });

  it('10 parallel checkouts for 3 units across 2 warehouses reserve exactly 3, none negative', async () => {
    const variant = await stockedVariant([
      { priority: 1, onHandQuantity: 2 },
      { priority: 2, onHandQuantity: 1 },
    ]);
    const shoppers = await Promise.all(Array.from({ length: 10 }, () => createShopper()));
    for (const shopper of shoppers)
      await addToCustomerCart(shopper.customer, { variantId: variant.variantId, quantity: 1 });
    const [firstShopper] = shoppers;
    if (firstShopper === undefined) throw new Error('no shoppers');
    const quote = await quoteCheckout(firstShopper.customer, {
      addressId: firstShopper.addressId,
      paymentMethod: 'COD',
    });
    const results = await Promise.allSettled(
      shoppers.map((shopper) =>
        placeOrder(
          shopper.customer,
          {
            addressId: shopper.addressId,
            paymentMethod: 'COD',
            expectedTotalPaise: quote.breakdown.totalPaise,
          },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    );
    const placed = results.filter((result) => result.status === 'fulfilled');
    const refused = results.flatMap((result): unknown[] =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    expect(placed).toHaveLength(3);
    expect(refused).toHaveLength(7);
    for (const reason of refused) {
      expect(reason).toBeInstanceOf(DomainError);
      expect(reason instanceof DomainError ? reason.httpStatus : 0).toBe(409);
    }
    const totals = await stockTotals(variant.variantId);
    expect(totals.reserved).toBe(3);
    expect(totals.levels.every((level) => level.reservedQuantity <= level.onHandQuantity)).toBe(
      true,
    );
  });
});

describe('no duplicate orders (acceptance test 3)', () => {
  it('the same key sent 5 times in parallel creates one order', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 1 });
    const quote = await quoteCheckout(customer, { addressId, paymentMethod: 'COD' });
    const key = idempotencyKey();
    const input = {
      addressId,
      paymentMethod: 'COD' as const,
      expectedTotalPaise: quote.breakdown.totalPaise,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => placeOrder(customer, input, key, testMetadata())),
    );
    expect(new Set(results.map(({ orderId }) => orderId)).size).toBe(1);
    expect(results.filter(({ isReplay }) => !isReplay)).toHaveLength(1);
    expect(await database.order.count()).toBe(1);
    expect((await stockTotals(variant.variantId)).reserved).toBe(1);
  });

  it('the same key with a different request is refused with 422', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    const key = idempotencyKey();
    await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
      key,
    });
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 2 });
    const quote = await quoteCheckout(customer, { addressId, paymentMethod: 'COD' });
    const error = await expectDomainError(
      placeOrder(
        customer,
        { addressId, paymentMethod: 'COD', expectedTotalPaise: quote.breakdown.totalPaise },
        key,
        testMetadata(),
      ),
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(error?.httpStatus).toBe(422);
  });
});

describe('checkout refusals', () => {
  it('refuses a changed price with 409 and the new breakdown, reserving nothing', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 1 });
    const quote = await quoteCheckout(customer, { addressId, paymentMethod: 'COD' });
    await database.productVariant.update({
      where: { id: variant.variantId },
      data: { pricePaise: 69_900 },
    });
    const error = await expectDomainError(
      placeOrder(
        customer,
        { addressId, paymentMethod: 'COD', expectedTotalPaise: quote.breakdown.totalPaise },
        idempotencyKey(),
        testMetadata(),
      ),
      'PRICE_CHANGED',
    );
    expect(error?.details).toMatchObject({ breakdown: { subtotalPaise: 69_900 } });
    expect((await stockTotals(variant.variantId)).reserved).toBe(0);
  });

  it('refuses Cash on Delivery above the store limit with 422', async () => {
    await database.storeSetting.create({
      data: { key: 'max_cod_order_value_paise', value: 100_000 },
    });
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    const error = await expectDomainError(
      checkoutWith({ customer, addressId, lines: [{ variantId: variant.variantId, quantity: 2 }] }),
      'COD_LIMIT_EXCEEDED',
    );
    expect(error?.httpStatus).toBe(422);
  });

  it('refuses an unserviceable pincode with 422', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper(unservicedPincode);
    const error = await expectDomainError(
      checkoutWith({ customer, addressId, lines: [{ variantId: variant.variantId, quantity: 1 }] }),
      'PINCODE_NOT_SERVICEABLE',
    );
    expect(error?.httpStatus).toBe(422);
  });

  it('refuses another customer’s address with 422', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer } = await createShopper();
    const other = await createShopper();
    await expectDomainError(
      checkoutWith({
        customer,
        addressId: other.addressId,
        lines: [{ variantId: variant.variantId, quantity: 1 }],
      }),
      'ADDRESS_NOT_FOUND',
    );
  });

  it('refuses a blocked customer with 403', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 1 });
    await database.customer.update({
      where: { id: customer.customerId },
      data: { status: 'BLOCKED' },
    });
    const error = await expectDomainError(
      placeOrder(
        customer,
        { addressId, paymentMethod: 'COD', expectedTotalPaise: 0 },
        idempotencyKey(),
        testMetadata(),
      ),
      'CUSTOMER_BLOCKED',
    );
    expect(error?.httpStatus).toBe(403);
  });

  it('refuses an empty cart with 422', async () => {
    const { customer, addressId } = await createShopper();
    await expectDomainError(
      placeOrder(
        customer,
        { addressId, paymentMethod: 'COD', expectedTotalPaise: 0 },
        idempotencyKey(),
        testMetadata(),
      ),
      'CART_EMPTY',
    );
  });
});

describe('allocation and coupons', () => {
  it('splits an order across warehouses when no single one has every line: two shipments', async () => {
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
    const order = await orderWithRelations(placed.orderId);
    expect(order.shipments.map(({ warehouseId }) => warehouseId).sort()).toEqual(
      [first.warehouseIds[0], second.warehouseIds[0]].sort(),
    );
  });

  it('a coupon with one use left is redeemed once under concurrency; the rest get 409', async () => {
    const coupon = await database.coupon.create({
      data: {
        code: 'LASTONE',
        discountType: 'FLAT',
        discountValue: 10_000,
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 86_400_000),
        totalUsageLimit: 1,
      },
      select: { id: true },
    });
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 20 }]);
    const shoppers = await Promise.all(Array.from({ length: 5 }, () => createShopper()));
    const inputs = [];
    for (const shopper of shoppers) {
      await addToCustomerCart(shopper.customer, { variantId: variant.variantId, quantity: 1 });
      await applyCouponToCustomerCart(shopper.customer, 'LASTONE');
      const quote = await quoteCheckout(shopper.customer, {
        addressId: shopper.addressId,
        paymentMethod: 'COD',
      });
      inputs.push({ shopper, total: quote.breakdown.totalPaise });
    }
    const results = await Promise.allSettled(
      inputs.map(({ shopper, total }) =>
        placeOrder(
          shopper.customer,
          { addressId: shopper.addressId, paymentMethod: 'COD', expectedTotalPaise: total },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason instanceof DomainError ? result.reason.code : '').toMatch(
          /^COUPON_EXHAUSTED$/,
        );
      }
    }
    const after = await database.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
      select: { usedCount: true },
    });
    expect(after.usedCount).toBe(1);
    expect(await database.couponRedemption.count()).toBe(1);
    expect((await stockTotals(variant.variantId)).reserved).toBe(1);
  });
});
