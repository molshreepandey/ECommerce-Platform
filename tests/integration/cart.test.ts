import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import {
  addToCustomerCart,
  addToGuestCart,
  applyCouponToCustomerCart,
  getCustomerCartView,
  getGuestCartView,
  mergeGuestCartIntoCustomerCart,
  removeCustomerCartLine,
  updateCustomerCartLine,
} from '@/modules/cart/cart.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  stockedVariant,
} from './support/commerce-fixtures';
import { createVariantRow } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const day = 86_400_000;

async function codeOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) =>
      error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error),
  );
}

async function coupon(overrides: Record<string, unknown> = {}) {
  return database.coupon.create({
    data: {
      code: 'SAVE10',
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountPaise: 20_000,
      minCartPaise: 99_900,
      validFrom: new Date(Date.now() - 30 * day),
      validUntil: new Date(Date.now() + 30 * day),
      totalUsageLimit: 1000,
      perCustomerLimit: 3,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('saved cart (C22, C23)', () => {
  it('adds, sums, updates and removes lines, priced from the database', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const { customer } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 1 });
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 2 });
    let cart = await getCustomerCartView(customer);
    expect(cart.lines).toHaveLength(1);
    expect(cart.itemCount).toBe(3);
    expect(cart.subtotalPaise).toBe(3 * 79_900);
    expect(cart.shippingFeePaise).toBe(0);
    expect(cart.canCheckout).toBe(true);
    await updateCustomerCartLine(customer, variant.variantId, 1);
    cart = await getCustomerCartView(customer);
    expect(cart.totalPaise).toBe(79_900);
    await removeCustomerCartLine(customer, variant.variantId);
    expect((await getCustomerCartView(customer)).lines).toHaveLength(0);
  });

  it('refuses more than is available (409) and more than the per-line maximum (422)', async () => {
    const scarce = await stockedVariant([{ priority: 1, onHandQuantity: 2 }]);
    const plenty = await stockedVariant([{ priority: 1, onHandQuantity: 50 }]);
    const { customer } = await createShopper();
    expect(
      await codeOf(addToCustomerCart(customer, { variantId: scarce.variantId, quantity: 3 })),
    ).toBe('409 INSUFFICIENT_STOCK');
    await addToCustomerCart(customer, { variantId: plenty.variantId, quantity: 10 });
    expect(
      await codeOf(addToCustomerCart(customer, { variantId: plenty.variantId, quantity: 1 })),
    ).toBe('422 QUANTITY_LIMIT_EXCEEDED');
  });

  it('refuses an unsellable variant (422) and an unknown one (404)', async () => {
    const archived = await createVariantRow({ productStatus: 'ARCHIVED' });
    const { customer } = await createShopper();
    expect(
      await codeOf(addToCustomerCart(customer, { variantId: archived.variantId, quantity: 1 })),
    ).toBe('422 VARIANT_UNAVAILABLE');
    expect(
      await codeOf(
        addToCustomerCart(customer, {
          variantId: '0195f0a0-0000-7000-8000-000000000001',
          quantity: 1,
        }),
      ),
    ).toBe('404 VARIANT_NOT_FOUND');
  });

  it('shows price changed, only N left and out of stock warnings (C26) and blocks checkout', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 3 }]);
    const { customer } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 3 });
    await database.productVariant.update({
      where: { id: variant.variantId },
      data: { pricePaise: 69_900 },
    });
    let cart = await getCustomerCartView(customer);
    expect(cart.lines[0]?.warnings).toEqual([
      { kind: 'LOW_STOCK', availableQuantity: 3 },
      { kind: 'PRICE_CHANGED', previousUnitPricePaise: 79_900 },
    ]);
    expect(cart.canCheckout).toBe(true);
    await database.inventoryLevel.updateMany({
      where: { variantId: variant.variantId },
      data: { onHandQuantity: 1 },
    });
    cart = await getCustomerCartView(customer);
    expect(cart.lines[0]?.warnings[0]).toEqual({
      kind: 'QUANTITY_EXCEEDS_STOCK',
      availableQuantity: 1,
    });
    expect(cart.canCheckout).toBe(false);
    await database.inventoryLevel.updateMany({
      where: { variantId: variant.variantId },
      data: { onHandQuantity: 0 },
    });
    expect((await getCustomerCartView(customer)).lines[0]?.warnings[0]).toEqual({
      kind: 'OUT_OF_STOCK',
    });
  });
});

describe('guest cart merge on sign-in (C22)', () => {
  it('sums quantities within availability and the per-line maximum; drops unsellable lines', async () => {
    const limited = await stockedVariant([{ priority: 1, onHandQuantity: 4 }]);
    const plenty = await stockedVariant([{ priority: 1, onHandQuantity: 50 }]);
    const archived = await createVariantRow({ productStatus: 'ARCHIVED' });
    const { customer } = await createShopper();
    await addToCustomerCart(customer, { variantId: limited.variantId, quantity: 3 });
    await addToCustomerCart(customer, { variantId: plenty.variantId, quantity: 8 });
    let guest = await addToGuestCart([], { variantId: limited.variantId, quantity: 2 });
    guest = await addToGuestCart(guest, { variantId: plenty.variantId, quantity: 5 });
    guest = [...guest, { variantId: archived.variantId, quantity: 1 }];
    await mergeGuestCartIntoCustomerCart(customer.customerId, guest);
    const cart = await getCustomerCartView(customer);
    const quantityOf = (variantId: string) =>
      cart.lines.find((line) => line.variantId === variantId)?.quantity;
    expect(quantityOf(limited.variantId)).toBe(4);
    expect(quantityOf(plenty.variantId)).toBe(10);
    expect(quantityOf(archived.variantId)).toBeUndefined();
  });

  it('prices a guest cart the same way as a saved one', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const view = await getGuestCartView([{ variantId: variant.variantId, quantity: 2 }]);
    expect(view.subtotalPaise).toBe(159_800);
    expect(view.coupon).toBeNull();
  });
});

describe('coupons in the cart (C25, D45)', () => {
  it('applies a valid coupon and shows the discount', async () => {
    await coupon();
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const { customer } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 2 });
    await applyCouponToCustomerCart(customer, 'SAVE10');
    const cart = await getCustomerCartView(customer);
    expect(cart.coupon).toMatchObject({ code: 'SAVE10', isApplied: true, discountPaise: 15_980 });
    expect(cart.totalPaise).toBe(159_800 - 15_980);
  });

  it.each([
    [{ validUntil: new Date(Date.now() - day) }, '422 COUPON_EXPIRED'],
    [{ totalUsageLimit: 5, usedCount: 5 }, '422 COUPON_EXHAUSTED'],
    [{ minCartPaise: 500_000 }, '422 COUPON_MIN_CART_NOT_MET'],
    [{ isActive: false }, '422 COUPON_INACTIVE'],
  ])('refuses %j with its reason', async (overrides, expected) => {
    await coupon(overrides);
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const { customer } = await createShopper();
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 2 });
    expect(await codeOf(applyCouponToCustomerCart(customer, 'SAVE10'))).toBe(expected);
  });

  it('refuses a first-order coupon after the customer has ordered, and unknown codes', async () => {
    await createCourier();
    await coupon({ code: 'WELCOME20', firstOrderOnly: true, minCartPaise: 0 });
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    await addToCustomerCart(customer, { variantId: variant.variantId, quantity: 1 });
    expect(await codeOf(applyCouponToCustomerCart(customer, 'WELCOME20'))).toBe(
      '422 COUPON_FIRST_ORDER_ONLY',
    );
    expect(await codeOf(applyCouponToCustomerCart(customer, 'NOSUCHCODE'))).toBe(
      '422 COUPON_NOT_FOUND',
    );
  });
});
