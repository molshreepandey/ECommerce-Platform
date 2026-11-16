import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { expireUnpaidOnlineOrders, submitOnlinePayment } from '@/modules/payment/payment.service';
import { cancelOrderByCustomer, confirmOrder } from '@/modules/ordering/order-lifecycle.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  idempotencyKey,
  orderStaff,
  orderWithRelations,
  stockedVariant,
  stockTotals,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { backendProcessId, waitUntilSomeoneWaitsOn } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function onlineOrder() {
  const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
  const { customer, addressId } = await createShopper();
  const placed = await checkoutWith({
    customer,
    addressId,
    lines: [{ variantId: variant.variantId, quantity: 1 }],
    paymentMethod: 'ONLINE',
  });
  return { variant, customer, orderId: placed.orderId, amountPaise: 79_900 };
}

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? { code: error.code, status: error.httpStatus } : null;
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

describe('simulated online payment', () => {
  it('a successful payment marks the payment collected and lets staff confirm the order', async () => {
    const { customer, orderId, amountPaise } = await onlineOrder();
    const staff = await orderStaff();
    expect(await failureOf(confirmOrder(staff, orderId, testMetadata()))).toEqual({
      code: 'PAYMENT_NOT_COLLECTED',
      status: 409,
    });
    const attempt = await submitOnlinePayment(
      customer,
      orderId,
      { scenario: 'SUCCESS', amountPaise },
      idempotencyKey(),
      testMetadata(),
    );
    expect(attempt).toMatchObject({
      outcome: 'SUCCEEDED',
      paymentStatus: 'COLLECTED',
      isReplay: false,
    });
    expect((await orderWithRelations(orderId)).payment?.status).toBe('COLLECTED');
    await confirmOrder(staff, orderId, testMetadata());
    expect((await orderWithRelations(orderId)).status).toBe('CONFIRMED');
    expect(
      await failureOf(
        submitOnlinePayment(
          customer,
          orderId,
          { scenario: 'SUCCESS', amountPaise },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    ).toEqual({
      code: 'PAYMENT_ALREADY_COLLECTED',
      status: 409,
    });
  });

  it('a repeated request with the same key returns the stored attempt and never charges twice', async () => {
    const { customer, orderId, amountPaise } = await onlineOrder();
    const key = idempotencyKey();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        submitOnlinePayment(
          customer,
          orderId,
          { scenario: 'SUCCESS', amountPaise },
          key,
          testMetadata(),
        ),
      ),
    );
    expect(results.filter(({ isReplay }) => !isReplay)).toHaveLength(1);
    expect(await database.paymentAttempt.count()).toBe(1);
    expect(
      await failureOf(
        submitOnlinePayment(
          customer,
          orderId,
          { scenario: 'DECLINE_BANK_UNAVAILABLE', amountPaise },
          key,
          testMetadata(),
        ),
      ),
    ).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
  });

  it('two declines can be retried; the third cancels the order, fails the payment and frees the stock', async () => {
    const { customer, orderId, amountPaise, variant } = await onlineOrder();
    const decline = () =>
      submitOnlinePayment(
        customer,
        orderId,
        { scenario: 'DECLINE_INSUFFICIENT_FUNDS', amountPaise },
        idempotencyKey(),
        testMetadata(),
      );
    expect(await decline()).toMatchObject({
      outcome: 'DECLINED',
      attemptsRemaining: 2,
      orderStatus: 'PLACED',
    });
    expect(await decline()).toMatchObject({ outcome: 'DECLINED', attemptsRemaining: 1 });
    expect(await decline()).toMatchObject({
      outcome: 'DECLINED',
      attemptsRemaining: 0,
      orderStatus: 'CANCELLED',
      paymentStatus: 'FAILED',
    });
    const order = await orderWithRelations(orderId);
    expect(order.status).toBe('CANCELLED');
    expect(order.payment?.status).toBe('FAILED');
    expect(await stockTotals(variant.variantId)).toMatchObject({ reserved: 0, onHand: 5 });
    expect(await failureOf(decline())).toEqual({ code: 'PAYMENT_CLOSED', status: 409 });
  });

  it('a decline followed by a success completes the payment (retry)', async () => {
    const { customer, orderId, amountPaise } = await onlineOrder();
    await submitOnlinePayment(
      customer,
      orderId,
      { scenario: 'DECLINE_BANK_UNAVAILABLE', amountPaise },
      idempotencyKey(),
      testMetadata(),
    );
    const attempt = await submitOnlinePayment(
      customer,
      orderId,
      { scenario: 'SUCCESS', amountPaise },
      idempotencyKey(),
      testMetadata(),
    );
    expect(attempt.paymentStatus).toBe('COLLECTED');
    expect(await database.paymentAttempt.count()).toBe(2);
  });

  it('refuses a wrong amount (422), a COD order (409) and someone else’s order (404)', async () => {
    const { customer, orderId, amountPaise } = await onlineOrder();
    expect(
      await failureOf(
        submitOnlinePayment(
          customer,
          orderId,
          { scenario: 'SUCCESS', amountPaise: amountPaise - 1 },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    ).toEqual({
      code: 'PAYMENT_AMOUNT_MISMATCH',
      status: 422,
    });
    const stranger = await createShopper();
    expect(
      await failureOf(
        submitOnlinePayment(
          stranger.customer,
          orderId,
          { scenario: 'SUCCESS', amountPaise },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    ).toEqual({
      code: 'ORDER_NOT_FOUND',
      status: 404,
    });
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
    const own = await createShopper();
    const codOrder = await checkoutWith({
      customer: own.customer,
      addressId: own.addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    expect(
      await failureOf(
        submitOnlinePayment(
          own.customer,
          codOrder.orderId,
          { scenario: 'SUCCESS', amountPaise },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    ).toEqual({
      code: 'PAYMENT_NOT_ONLINE',
      status: 409,
    });
  });

  it('cancels unpaid online orders after the 30-minute window and releases their stock', async () => {
    const { orderId, variant, customer, amountPaise } = await onlineOrder();
    await database.order.update({
      where: { id: orderId },
      data: { placedAt: new Date(Date.now() - 31 * 60_000) },
    });
    expect(
      await failureOf(
        submitOnlinePayment(
          customer,
          orderId,
          { scenario: 'SUCCESS', amountPaise },
          idempotencyKey(),
          testMetadata(),
        ),
      ),
    ).toEqual({
      code: 'PAYMENT_EXPIRED',
      status: 409,
    });
    expect((await orderWithRelations(orderId)).status).toBe('CANCELLED');
    expect((await stockTotals(variant.variantId)).reserved).toBe(0);
    expect(await expireUnpaidOnlineOrders({ requestId: 'test' })).toBe(0);
  });

  it('the expiry sweep cancels every expired unpaid order', async () => {
    const first = await onlineOrder();
    const second = await onlineOrder();
    await database.order.updateMany({ data: { placedAt: new Date(Date.now() - 45 * 60_000) } });
    expect(await expireUnpaidOnlineOrders({ requestId: 'test' })).toBe(2);
    for (const { orderId } of [first, second]) {
      expect((await orderWithRelations(orderId)).payment?.status).toBe('FAILED');
    }
  });
  it('cancelling a paid order keeps the payment collected and records the refund owed (BL-3, L62)', async () => {
    const { customer, orderId, amountPaise, variant } = await onlineOrder();
    await submitOnlinePayment(
      customer,
      orderId,
      { scenario: 'SUCCESS', amountPaise },
      idempotencyKey(),
      testMetadata(),
    );
    await cancelOrderByCustomer(customer, orderId, 'Ordered by mistake', testMetadata());
    const after = await orderWithRelations(orderId);
    expect(after.status).toBe('CANCELLED');
    expect(after.payment?.status).toBe('COLLECTED');
    expect((await stockTotals(variant.variantId)).reserved).toBe(0);
    const marker = await database.auditLog.findFirstOrThrow({
      where: { action: 'payment.refund_due', entityId: orderId },
      select: { entityType: true, after: true },
    });
    expect(marker.entityType).toBe('order');
    expect(marker.after).toMatchObject({ amountPaise, reason: 'order_cancelled' });
  });

  it('the expiry sweep never cancels an order whose payment succeeded while it waited (BL-2)', async () => {
    const { orderId } = await onlineOrder();
    await database.order.update({
      where: { id: orderId },
      data: { placedAt: new Date(Date.now() - 45 * 60_000) },
    });
    // A payment success holds the order lock while the sweep reads the order as unpaid, then commits.
    const sweep: { result?: Promise<number> } = {};
    await database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
        const holder = await backendProcessId(transaction);
        sweep.result = expireUnpaidOnlineOrders({ requestId: 'test' });
        await waitUntilSomeoneWaitsOn(holder);
        await transaction.payment.update({
          where: { orderId },
          data: { status: 'COLLECTED', collectedAt: new Date() },
        });
      },
      { timeout: 20_000 },
    );
    expect(await sweep.result).toBe(0);
    const after = await orderWithRelations(orderId);
    expect(after.status).toBe('PLACED');
    expect(after.payment?.status).toBe('COLLECTED');
  });

  it('caps a customer at 2 unpaid online orders; paying, expiry or COD frees the way (M4)', async () => {
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    const order = (paymentMethod: 'COD' | 'ONLINE') =>
      checkoutWith({
        customer,
        addressId,
        lines: [{ variantId: variant.variantId, quantity: 1 }],
        paymentMethod,
      });
    const first = await order('ONLINE');
    await order('ONLINE');
    expect(await failureOf(order('ONLINE'))).toEqual({ code: 'UNPAID_ORDERS_LIMIT', status: 409 });
    // The refused checkout reserved nothing: 2 units held, the cart still has its line.
    expect(await stockTotals(variant.variantId)).toMatchObject({ reserved: 2 });
    // Cash on Delivery is never capped.
    await order('COD');
    // Once one is paid, another online order is allowed.
    await submitOnlinePayment(
      customer,
      first.orderId,
      { scenario: 'SUCCESS', amountPaise: 79_900 },
      idempotencyKey(),
      testMetadata(),
    );
    await order('ONLINE');
    expect(await failureOf(order('ONLINE'))).toEqual({ code: 'UNPAID_ORDERS_LIMIT', status: 409 });
    // Orders past the 30-minute window no longer count (they are being expired).
    await database.order.updateMany({
      where: { customerId: customer.customerId },
      data: { placedAt: new Date(Date.now() - 45 * 60_000) },
    });
    await order('ONLINE');
  });
});
