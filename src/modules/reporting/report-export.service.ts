import { z } from 'zod';

import { type CsvCell, toCsv } from '@/lib/csv';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { paiseToRupeesText } from '@/lib/money';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import type { PermissionCode } from '@/modules/identity/permissions';
import { allocateDiscount } from '@/modules/pricing/pricing';

import type { DateRange } from './report.repository';
import {
  listDailySales,
  listInventoryForExport,
  listOrdersForExport,
  listSaleLinesForGst,
  maximumExportRows,
} from './report-export.repository';

export const reportExportSchema = z.enum(['orders', 'sales', 'gst-summary', 'inventory']);
export type ReportExport = z.infer<typeof reportExportSchema>;

// The orders export lists each customer's name, email, city and pincode, so besides reports.read it needs
// the permissions that show the same data on the orders and customers pages.
const extraPermissionsByExport: Readonly<Record<ReportExport, readonly PermissionCode[]>> = {
  orders: ['orders.read', 'customers.read'],
  sales: [],
  'gst-summary': [],
  inventory: [],
};

export function canExportReport(staff: StaffContext, report: ReportExport): boolean {
  return (
    staff.permissionCodes.has('reports.read') &&
    extraPermissionsByExport[report].every((code) => staff.permissionCodes.has(code))
  );
}

const rupees = (paise: number | bigint) => paiseToRupeesText(Number(paise));

function istDateTime(value: Date): string {
  return new Date(value.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

function assertWithinLimit(rowCount: number, limit: number): void {
  if (rowCount > limit) {
    throw new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'EXPORT_TOO_LARGE',
      message: 'This export is too large. Choose a shorter date range.',
      details: { maximumRows: limit },
    });
  }
}

async function ordersCsv(range: DateRange): Promise<string> {
  const rows = await listOrdersForExport(getDatabase(), range);
  assertWithinLimit(rows.length, maximumExportRows);
  return toCsv(
    [
      'order_number',
      'placed_at_ist',
      'status',
      'payment_method',
      'payment_status',
      'customer_name',
      'customer_email',
      'items',
      'subtotal_rupees',
      'discount_rupees',
      'shipping_rupees',
      'cod_fee_rupees',
      'gst_included_rupees',
      'total_rupees',
      'city',
      'pincode',
    ],
    rows.map((row): CsvCell[] => [
      row.order_number,
      istDateTime(row.placed_at),
      row.status,
      row.payment_method,
      row.payment_status,
      row.customer_name,
      row.customer_email,
      row.item_count,
      rupees(row.subtotal_paise),
      rupees(row.discount_paise),
      rupees(row.shipping_fee_paise),
      rupees(row.cod_fee_paise),
      rupees(row.tax_paise),
      rupees(row.total_paise),
      row.city,
      row.pincode,
    ]),
  );
}

async function salesCsv(range: DateRange): Promise<string> {
  const rows = await listDailySales(getDatabase(), range);
  return toCsv(
    [
      'date_ist',
      'orders',
      'units',
      'subtotal_rupees',
      'discount_rupees',
      'shipping_rupees',
      'cod_fee_rupees',
      'gst_included_rupees',
      'total_rupees',
    ],
    rows.map((row): CsvCell[] => [
      row.day,
      row.order_count,
      row.unit_count,
      rupees(row.subtotal_paise),
      rupees(row.discount_paise),
      rupees(row.shipping_fee_paise),
      rupees(row.cod_fee_paise),
      rupees(row.tax_paise),
      rupees(row.total_paise),
    ]),
  );
}

interface GstBucket {
  units: number;
  valueAfterDiscountPaise: number;
  gstPaise: number;
}

// Per GST rate: the value customers paid for goods at that rate (after their share of the coupon, the
// same allocation pricing used), the GST included in it, and the taxable value (value − GST). Shipping
// and COD fees carry no GST in this store (plan §10A rule 9).
async function gstSummaryCsv(range: DateRange): Promise<string> {
  const lines = await listSaleLinesForGst(getDatabase(), range);
  assertWithinLimit(lines.length, maximumExportRows * 10);
  const byOrder = Map.groupBy(lines, (line) => line.order_id);
  const buckets = new Map<number, GstBucket>();
  for (const orderLines of byOrder.values()) {
    const discounts = allocateDiscount(
      orderLines.map((line) => line.line_total_paise),
      orderLines[0]?.discount_paise ?? 0,
    );
    orderLines.forEach((line, index) => {
      const bucket = buckets.get(line.tax_rate_basis_points) ?? {
        units: 0,
        valueAfterDiscountPaise: 0,
        gstPaise: 0,
      };
      bucket.units += line.quantity;
      bucket.valueAfterDiscountPaise += line.line_total_paise - (discounts[index] ?? 0);
      bucket.gstPaise += line.tax_paise;
      buckets.set(line.tax_rate_basis_points, bucket);
    });
  }
  return toCsv(
    ['gst_rate_percent', 'units', 'value_rupees', 'taxable_value_rupees', 'gst_rupees'],
    [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rateBasisPoints, bucket]): CsvCell[] => [
        (rateBasisPoints / 100).toFixed(2),
        bucket.units,
        rupees(bucket.valueAfterDiscountPaise),
        rupees(bucket.valueAfterDiscountPaise - bucket.gstPaise),
        rupees(bucket.gstPaise),
      ]),
  );
}

async function inventoryCsv(): Promise<string> {
  const rows = await listInventoryForExport(getDatabase());
  assertWithinLimit(rows.length, maximumExportRows);
  return toCsv(
    [
      'warehouse_code',
      'warehouse_name',
      'warehouse_active',
      'sku',
      'product_name',
      'on_hand',
      'reserved',
      'available',
      'low_stock_threshold',
    ],
    rows.map((row): CsvCell[] => [
      row.warehouse_code,
      row.warehouse_name,
      row.warehouse_active,
      row.sku,
      row.product_name,
      row.on_hand_quantity,
      row.reserved_quantity,
      row.available_quantity,
      row.low_stock_threshold,
    ]),
  );
}

// D8: orders, daily sales, GST summary and stock by warehouse as CSV (reports.read; orders also needs
// orders.read and customers.read).
export async function buildReportExport(
  staff: StaffContext,
  report: ReportExport,
  range: DateRange,
): Promise<string> {
  assertStaffPermission(staff, 'reports.read');
  for (const code of extraPermissionsByExport[report]) assertStaffPermission(staff, code);
  switch (report) {
    case 'orders':
      return ordersCsv(range);
    case 'sales':
      return salesCsv(range);
    case 'gst-summary':
      return gstSummaryCsv(range);
    case 'inventory':
      return inventoryCsv();
  }
}
