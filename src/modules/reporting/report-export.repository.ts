import type { DatabaseClient } from '@/lib/db';

import type { DateRange } from './report.repository';

// D8 exports. Every query is bounded by the report range (≤ 366 days, orders(placed_at) index) or, for
// stock, by the inventory tables; rows are capped so one export can never exhaust memory.
export const maximumExportRows = 20_000;

export function listOrdersForExport(database: DatabaseClient, range: DateRange) {
  return database.$queryRaw<
    {
      order_number: string;
      placed_at: Date;
      status: string;
      payment_method: string;
      payment_status: string | null;
      customer_name: string;
      customer_email: string;
      item_count: number;
      subtotal_paise: number;
      discount_paise: number;
      shipping_fee_paise: number;
      cod_fee_paise: number;
      tax_paise: number;
      total_paise: number;
      city: string | null;
      pincode: string | null;
    }[]
  >`
    SELECT o.order_number, o.placed_at, o.status::text, o.payment_method::text,
           p.status::text AS payment_status, c.full_name AS customer_name, c.email AS customer_email,
           (SELECT coalesce(sum(i.quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count,
           o.subtotal_paise, o.discount_paise, o.shipping_fee_paise, o.cod_fee_paise, o.tax_paise,
           o.total_paise, o.shipping_address ->> 'city' AS city, o.shipping_address ->> 'pincode' AS pincode
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN payments p ON p.order_id = o.id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to}
    ORDER BY o.placed_at, o.id
    LIMIT ${maximumExportRows + 1}`;
}

// Per IST day, non-cancelled orders only (the dashboard's definition of a sale).
export function listDailySales(database: DatabaseClient, range: DateRange) {
  return database.$queryRaw<
    {
      day: string;
      order_count: number;
      unit_count: number;
      subtotal_paise: bigint;
      discount_paise: bigint;
      shipping_fee_paise: bigint;
      cod_fee_paise: bigint;
      tax_paise: bigint;
      total_paise: bigint;
    }[]
  >`
    SELECT to_char(o.placed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
           count(*)::int AS order_count,
           coalesce(sum(units.quantity), 0)::int AS unit_count,
           sum(o.subtotal_paise) AS subtotal_paise, sum(o.discount_paise) AS discount_paise,
           sum(o.shipping_fee_paise) AS shipping_fee_paise, sum(o.cod_fee_paise) AS cod_fee_paise,
           sum(o.tax_paise) AS tax_paise, sum(o.total_paise) AS total_paise
    FROM orders o
    LEFT JOIN LATERAL (SELECT sum(i.quantity) AS quantity FROM order_items i WHERE i.order_id = o.id) units ON true
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND o.status <> 'CANCELLED'
    GROUP BY 1 ORDER BY 1`;
}

// Lines of non-cancelled orders, in insertion order per order (the order pricing allocated the discount).
export function listSaleLinesForGst(database: DatabaseClient, range: DateRange) {
  return database.$queryRaw<
    {
      order_id: string;
      discount_paise: number;
      tax_rate_basis_points: number;
      quantity: number;
      line_total_paise: number;
      tax_paise: number;
    }[]
  >`
    SELECT o.id::text AS order_id, o.discount_paise, i.tax_rate_basis_points, i.quantity,
           i.line_total_paise, i.tax_paise
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND o.status <> 'CANCELLED'
    ORDER BY o.id, i.created_at, i.id
    LIMIT ${maximumExportRows * 10 + 1}`;
}

export function listInventoryForExport(database: DatabaseClient) {
  return database.$queryRaw<
    {
      warehouse_code: string;
      warehouse_name: string;
      warehouse_active: boolean;
      sku: string;
      product_name: string;
      on_hand_quantity: number;
      reserved_quantity: number;
      available_quantity: number;
      low_stock_threshold: number;
    }[]
  >`
    SELECT w.code AS warehouse_code, w.name AS warehouse_name, w.is_active AS warehouse_active,
           v.sku, p.name AS product_name, l.on_hand_quantity, l.reserved_quantity,
           l.available_quantity, l.low_stock_threshold
    FROM inventory_levels l
    JOIN warehouses w ON w.id = l.warehouse_id
    JOIN product_variants v ON v.id = l.variant_id
    JOIN products p ON p.id = v.product_id
    ORDER BY w.priority, w.code, v.sku
    LIMIT ${maximumExportRows + 1}`;
}
