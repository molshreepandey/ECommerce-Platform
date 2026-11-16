import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { listAuditEntries } from '@/modules/audit/audit-query.service';
import {
  changeCustomerStatus,
  getCustomerDetail,
  listCustomers,
} from '@/modules/identity/customer-admin.service';
import { startSession } from '@/modules/identity/session.service';
import { cancelOrderByCustomer, confirmOrder } from '@/modules/ordering/order-lifecycle.service';
import {
  runShipmentAction,
  simulateNextScan,
  createShipmentAwb,
} from '@/modules/ordering/shipment-actions.service';
import { getDashboard, getReports, resolveReportRange } from '@/modules/reporting/report.service';

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

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

async function sql(query: TemplateStringsArray) {
  const [row] = await database.$queryRaw<{ value: bigint | null }[]>(query);
  return Number(row?.value ?? 0n);
}

describe('reports reconcile with the order and payment rows (acceptance test 5)', () => {
  it('KPIs, daily totals, order rows and payment rows agree', async () => {
    const staff = await orderStaff(['orders.read', 'orders.write', 'reports.read']);
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 50 }]);
    const shoppers = await Promise.all(Array.from({ length: 3 }, () => createShopper()));
    const placed = [];
    for (const [index, shopper] of shoppers.entries()) {
      placed.push(
        await checkoutWith({
          customer: shopper.customer,
          addressId: shopper.addressId,
          lines: [{ variantId: variant.variantId, quantity: index + 1 }],
        }),
      );
    }
    const [delivered, cancelled] = placed;
    const cancellingShopper = shoppers[1];
    if (delivered === undefined || cancelled === undefined || cancellingShopper === undefined) {
      throw new Error('orders missing');
    }
    await confirmOrder(staff, delivered.orderId, testMetadata());
    const shipmentId = (await orderWithRelations(delivered.orderId)).shipments[0]?.id ?? '';
    await runShipmentAction(staff, shipmentId, 'pack', null, testMetadata());
    await createShipmentAwb(staff, shipmentId, testMetadata());
    for (let scan = 0; scan < 3; scan += 1)
      await simulateNextScan(staff, shipmentId, 'DELIVERED', 'test');
    await cancelOrderByCustomer(
      cancellingShopper.customer,
      cancelled.orderId,
      'Changed my mind',
      testMetadata(),
    );

    const range = resolveReportRange({});
    const dashboard = await getDashboard(staff, range);
    const salesTotal =
      await sql`SELECT sum(total_paise) AS value FROM orders WHERE status <> 'CANCELLED'`;
    const paymentTotal =
      await sql`SELECT sum(p.amount_paise) AS value FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.status <> 'CANCELLED'`;
    const codCollected =
      await sql`SELECT sum(amount_paise) AS value FROM payments WHERE status = 'COLLECTED' AND payment_method = 'COD'`;
    expect(dashboard.kpis.orderCount).toBe(3);
    expect(dashboard.kpis.cancelledCount).toBe(1);
    expect(dashboard.kpis.grossMerchandiseValuePaise).toBe(salesTotal);
    expect(dashboard.kpis.codCollectedPaise).toBe(codCollected);
    expect(dashboard.ordersByDay.reduce((total, row) => total + row.salesPaise, 0)).toBe(
      salesTotal,
    );

    const reports = await getReports(staff, range);
    expect(reports.reconciliation).toMatchObject({
      reportTotalPaise: salesTotal,
      orderTotalPaise: salesTotal,
      paymentTotalPaise: paymentTotal,
      isBalanced: true,
    });
    expect(reports.topProducts[0]?.quantity).toBe(1 + 3);
  });

  it('refuses staff without reports.read (403)', async () => {
    const staff = await orderStaff(['orders.read']);
    const error = await getDashboard(staff, resolveReportRange({})).catch(
      (caught: unknown) => caught,
    );
    expect(error instanceof DomainError ? error.httpStatus : 0).toBe(403);
  });
});

describe('customer administration (D44)', () => {
  it('pages through customers created in the same millisecond without skipping any (API-1)', async () => {
    const admin = await orderStaff(['customers.read']);
    await database.customer.createMany({
      data: Array.from({ length: 40 }, (_, index) => ({
        fullName: `Page Customer ${String(index)}`,
        email: `page.${String(index)}@example.test`,
        phone: `9${String(800_000_000 + index)}`,
        passwordHash: 'not-a-real-hash',
      })),
    });
    // Same millisecond, different microseconds, in an order unrelated to the ids.
    await database.$executeRaw`
      UPDATE customers SET created_at = timestamptz '2026-11-01 10:00:00.123+00'
        + (((hashtext(id::text) & 2147483647) % 900) * interval '1 microsecond')`;
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const page = await listCustomers(admin, cursor === undefined ? {} : { cursor });
      seen.push(...page.items.map(({ id }) => id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
    const expected = await database.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM customers ORDER BY created_at DESC, id DESC`;
    expect(seen).toEqual(expected.map(({ id }) => id));
  });

  it('lists, shows order figures, blocks (sessions revoked, checkout 403) and unblocks', async () => {
    const admin = await orderStaff(['customers.read', 'customers.block', 'audit.read']);
    const variant = await stockedVariant([{ priority: 1, onHandQuantity: 10 }]);
    const { customer, addressId } = await createShopper();
    await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    });
    await startSession(database, { subjectType: 'CUSTOMER', subjectId: customer.customerId });

    const page = await listCustomers(admin, {});
    expect(page.items.map(({ id }) => id)).toContain(customer.customerId);
    const detail = await getCustomerDetail(admin, customer.customerId);
    expect(detail.stats).toMatchObject({ orderCount: 1, rtoCount: 0 });
    expect(detail.stats.lifetimeValuePaise).toBeGreaterThan(0);

    await changeCustomerStatus(
      admin,
      customer.customerId,
      { isBlocked: true, reason: 'Fraud check' },
      testMetadata(),
    );
    expect(
      await database.session.count({ where: { subjectId: customer.customerId, revokedAt: null } }),
    ).toBe(0);
    const blockedCheckout = await checkoutWith({
      customer,
      addressId,
      lines: [{ variantId: variant.variantId, quantity: 1 }],
    }).catch((error: unknown) => error);
    expect(blockedCheckout instanceof DomainError ? blockedCheckout.httpStatus : 0).toBe(403);

    await changeCustomerStatus(
      admin,
      customer.customerId,
      { isBlocked: false, reason: 'Cleared' },
      testMetadata(),
    );
    const audit = await listAuditEntries(admin, {
      entityType: 'customer',
      entityId: customer.customerId,
    });
    expect(audit.items.map(({ action }) => action)).toEqual([
      'customer.unblocked',
      'customer.blocked',
    ]);
  });

  it('SUPPORT (customers.read only) cannot block (403)', async () => {
    const support = await orderStaff(['customers.read']);
    const { customer } = await createShopper();
    const error = await changeCustomerStatus(
      support,
      customer.customerId,
      { isBlocked: true, reason: 'nope' },
      testMetadata(),
    ).catch((caught: unknown) => caught);
    expect(error instanceof DomainError ? error.httpStatus : 0).toBe(403);
  });
});
