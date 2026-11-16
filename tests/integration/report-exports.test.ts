import { beforeEach, describe, expect, it } from 'vitest';

import { parseCsv } from '@/lib/csv';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { addToCustomerCart, applyCouponToCustomerCart } from '@/modules/cart/cart.service';
import { placeOrder, quoteCheckout } from '@/modules/ordering/checkout.service';
import { cancelOrderByCustomer } from '@/modules/ordering/order-lifecycle.service';
import { getDashboard, resolveReportRange } from '@/modules/reporting/report.service';
import { buildReportExport, canExportReport } from '@/modules/reporting/report-export.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  stockedVariant,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { createStaffMember } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function paise(rupeesText: string | undefined): number {
  const [whole = '0', fraction = ''] = (rupeesText ?? '0').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function column(csv: string, name: string): string[] {
  const [header = [], ...rows] = parseCsv(csv);
  const index = header.indexOf(name);
  return rows.map((row) => row[index] ?? '');
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

// Three orders in today's range: one with two GST rates and a flat coupon, one plain, one cancelled.
async function orders() {
  await createCourier();
  const fivePercent = await stockedVariant([{ priority: 1, onHandQuantity: 20 }]);
  const twelvePercent = await stockedVariant([{ priority: 1, onHandQuantity: 20 }]);
  await database.product.update({
    where: { id: twelvePercent.productId },
    data: { taxRateBasisPoints: 1200 },
  });
  await database.coupon.create({
    data: {
      code: 'EXPORT100',
      discountType: 'FLAT',
      discountValue: 10_000,
      validFrom: new Date(Date.now() - 86_400_000),
      validUntil: new Date(Date.now() + 86_400_000),
      totalUsageLimit: 10,
    },
  });
  const couponShopper = await createShopper();
  await addToCustomerCart(couponShopper.customer, {
    variantId: fivePercent.variantId,
    quantity: 2,
  });
  await addToCustomerCart(couponShopper.customer, {
    variantId: twelvePercent.variantId,
    quantity: 1,
  });
  await applyCouponToCustomerCart(couponShopper.customer, 'EXPORT100');
  const quote = await quoteCheckout(couponShopper.customer, {
    addressId: couponShopper.addressId,
    paymentMethod: 'COD',
  });
  await placeOrder(
    couponShopper.customer,
    {
      addressId: couponShopper.addressId,
      paymentMethod: 'COD',
      expectedTotalPaise: quote.breakdown.totalPaise,
    },
    'export-coupon-order-key',
    testMetadata(),
  );
  const plain = await createShopper();
  await checkoutWith({
    customer: plain.customer,
    addressId: plain.addressId,
    lines: [{ variantId: twelvePercent.variantId, quantity: 1 }],
  });
  const cancelled = await createShopper();
  const toCancel = await checkoutWith({
    customer: cancelled.customer,
    addressId: cancelled.addressId,
    lines: [{ variantId: fivePercent.variantId, quantity: 3 }],
  });
  await cancelOrderByCustomer(
    cancelled.customer,
    toCancel.orderId,
    'Changed my mind',
    testMetadata(),
  );
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('CSV exports (D8)', () => {
  it('orders, sales and GST exports reconcile with the order rows and the dashboard', async () => {
    await orders();
    const staff = await createStaffMember(['reports.read', 'orders.read', 'customers.read']);
    const range = resolveReportRange({});
    const sales = await database.order.aggregate({
      where: { status: { not: 'CANCELLED' } },
      _sum: { totalPaise: true, taxPaise: true, subtotalPaise: true, discountPaise: true },
      _count: { _all: true },
    });

    const ordersCsv = await buildReportExport(staff, 'orders', range);
    expect(column(ordersCsv, 'status').sort()).toEqual(['CANCELLED', 'PLACED', 'PLACED']);

    const salesCsv = await buildReportExport(staff, 'sales', range);
    expect(sum(column(salesCsv, 'orders').map(Number))).toBe(2);
    const salesTotal = sum(column(salesCsv, 'total_rupees').map(paise));
    expect(salesTotal).toBe(sales._sum.totalPaise);
    const dashboard = await getDashboard(staff, range);
    expect(salesTotal).toBe(dashboard.kpis.grossMerchandiseValuePaise);

    const gstCsv = await buildReportExport(staff, 'gst-summary', range);
    expect(column(gstCsv, 'gst_rate_percent')).toEqual(['5.00', '12.00']);
    expect(sum(column(gstCsv, 'gst_rupees').map(paise))).toBe(sales._sum.taxPaise);
    expect(sum(column(gstCsv, 'value_rupees').map(paise))).toBe(
      (sales._sum.subtotalPaise ?? 0) - (sales._sum.discountPaise ?? 0),
    );
    const itemsByRate = await database.orderItem.groupBy({
      by: ['taxRateBasisPoints'],
      where: { order: { status: { not: 'CANCELLED' } } },
      _sum: { taxPaise: true },
      orderBy: { taxRateBasisPoints: 'asc' },
    });
    expect(column(gstCsv, 'gst_rupees').map(paise)).toEqual(
      itemsByRate.map(({ _sum }) => _sum.taxPaise ?? 0),
    );
  });

  it('exports stock per warehouse and variant', async () => {
    await stockedVariant([
      { priority: 1, onHandQuantity: 7 },
      { priority: 2, onHandQuantity: 3 },
    ]);
    const staff = await createStaffMember(['reports.read']);
    const csv = await buildReportExport(staff, 'inventory', resolveReportRange({}));
    expect(column(csv, 'on_hand').map(Number).sort()).toEqual([3, 7]);
  });

  it('orders export (customer names and emails) also needs orders.read and customers.read (SEC-1)', async () => {
    await orders();
    const range = resolveReportRange({});
    // The catalogue manager role has reports.read only: aggregate exports, no customer details.
    const reportsOnly = await createStaffMember(['reports.read']);
    expect(await failure(buildReportExport(reportsOnly, 'orders', range))).toBe(
      '403 PERMISSION_DENIED',
    );
    const withoutCustomers = await createStaffMember(['reports.read', 'orders.read']);
    expect(await failure(buildReportExport(withoutCustomers, 'orders', range))).toBe(
      '403 PERMISSION_DENIED',
    );
    expect(column(await buildReportExport(reportsOnly, 'sales', range), 'orders')).not.toEqual([]);
    expect(canExportReport(reportsOnly, 'orders')).toBe(false);
    expect(canExportReport(reportsOnly, 'gst-summary')).toBe(true);
    const full = await createStaffMember(['reports.read', 'orders.read', 'customers.read']);
    expect(canExportReport(full, 'orders')).toBe(true);
    expect(column(await buildReportExport(full, 'orders', range), 'status')).toHaveLength(3);
  });

  it('needs reports.read (403)', async () => {
    const staff = await createStaffMember(['orders.read']);
    expect(await failure(buildReportExport(staff, 'orders', resolveReportRange({})))).toBe(
      '403 PERMISSION_DENIED',
    );
  });
});
