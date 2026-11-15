import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';

import {
  aggregateCollectedPayments,
  aggregateOrderKpis,
  countReturnRequests,
  type DateRange,
  ordersByDay,
  ordersByStatus,
  reconciliationTotals,
  shipmentsByCourier,
  stockByWarehouse,
  topCategories,
  topProducts,
} from './report.repository';

const maximumRangeDays = 366;
const dayMilliseconds = 86_400_000;

export const reportRangeSchema = z
  .object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  })
  .transform((value) => ({ from: value.from, to: value.to }));

function istDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

function istToday(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

// IST calendar days, "to" inclusive; the default is the last 30 days including today. A range longer
// than a year, or reversed, falls back to the default so a bad URL never runs a huge scan.
export function resolveReportRange(
  input: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): DateRange & { fromDay: string; toDay: string } {
  const toDay = input.to ?? istToday(now);
  const fromDay =
    input.from ??
    new Date(istDayStart(toDay).getTime() - 29 * dayMilliseconds + 5.5 * 3_600_000)
      .toISOString()
      .slice(0, 10);
  const from = istDayStart(fromDay);
  const to = new Date(istDayStart(toDay).getTime() + dayMilliseconds);
  const days = (to.getTime() - from.getTime()) / dayMilliseconds;
  if (days < 1 || days > maximumRangeDays) return resolveReportRange({}, now);
  return { from, to, fromDay, toDay };
}

export async function getDashboard(staff: StaffContext, range: DateRange) {
  assertStaffPermission(staff, 'reports.read');
  const database = getDatabase();
  const [kpis, collected, returnCount, byDay, byStatus, byCourier] = await Promise.all([
    aggregateOrderKpis(database, range),
    aggregateCollectedPayments(database, range),
    countReturnRequests(database, range),
    ordersByDay(database, range),
    ordersByStatus(database, range),
    shipmentsByCourier(database, range),
  ]);
  return {
    kpis: {
      ...kpis,
      ...collected,
      returnCount,
      averageOrderValuePaise:
        kpis.salesOrderCount === 0
          ? 0
          : Math.round(kpis.grossMerchandiseValuePaise / kpis.salesOrderCount),
    },
    ordersByDay: byDay,
    ordersByStatus: byStatus,
    shipmentsByCourier: byCourier,
  };
}

export async function getReports(staff: StaffContext, range: DateRange) {
  assertStaffPermission(staff, 'reports.read');
  const database = getDatabase();
  const [products, categories, stock, totals, byDay] = await Promise.all([
    topProducts(database, range, 10),
    topCategories(database, range, 10),
    stockByWarehouse(database),
    reconciliationTotals(database, range),
    ordersByDay(database, range),
  ]);
  const reportTotalPaise = byDay.reduce((total, day) => total + day.salesPaise, 0);
  return {
    topProducts: products,
    topCategories: categories,
    stockByWarehouse: stock,
    reconciliation: {
      reportTotalPaise,
      orderTotalPaise: totals.orderTotalPaise,
      paymentTotalPaise: totals.paymentTotalPaise,
      orderCount: totals.orderCount,
      paymentCount: totals.paymentCount,
      isBalanced:
        reportTotalPaise === totals.orderTotalPaise &&
        totals.orderTotalPaise === totals.paymentTotalPaise &&
        totals.orderCount === totals.paymentCount,
    },
  };
}
