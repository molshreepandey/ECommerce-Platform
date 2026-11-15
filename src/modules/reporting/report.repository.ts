import type { OrderStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export interface DateRange {
  from: Date;
  to: Date;
}

// Plan D4: one aggregate over orders(placed_at) for the range; cancelled orders count as cancellations,
// not sales. Amounts are summed as bigint and returned as numbers of paise.
export async function aggregateOrderKpis(database: DatabaseClient, range: DateRange) {
  const [row] = await database.$queryRaw<
    {
      order_count: bigint;
      sales_order_count: bigint;
      gross_merchandise_value_paise: bigint | null;
      cancelled_count: bigint;
      rto_count: bigint;
    }[]
  >`
    SELECT count(*) AS order_count,
           count(*) FILTER (WHERE status <> 'CANCELLED') AS sales_order_count,
           sum(total_paise) FILTER (WHERE status <> 'CANCELLED') AS gross_merchandise_value_paise,
           count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_count,
           count(*) FILTER (WHERE status = 'RTO') AS rto_count
    FROM orders
    WHERE placed_at >= ${range.from} AND placed_at < ${range.to}`;
  return {
    orderCount: Number(row?.order_count ?? 0n),
    salesOrderCount: Number(row?.sales_order_count ?? 0n),
    grossMerchandiseValuePaise: Number(row?.gross_merchandise_value_paise ?? 0n),
    cancelledCount: Number(row?.cancelled_count ?? 0n),
    rtoCount: Number(row?.rto_count ?? 0n),
  };
}

// Collected money by method, by when it was collected (payments.collected_at).
export async function aggregateCollectedPayments(database: DatabaseClient, range: DateRange) {
  const rows = await database.$queryRaw<
    { payment_method: string; collected_paise: bigint | null }[]
  >`
    SELECT payment_method, sum(amount_paise) AS collected_paise
    FROM payments
    WHERE status = 'COLLECTED' AND collected_at >= ${range.from} AND collected_at < ${range.to}
    GROUP BY payment_method`;
  const byMethod = new Map(
    rows.map((row) => [row.payment_method, Number(row.collected_paise ?? 0n)]),
  );
  return {
    codCollectedPaise: byMethod.get('COD') ?? 0,
    onlineCollectedPaise: byMethod.get('ONLINE') ?? 0,
  };
}

export async function countReturnRequests(
  database: DatabaseClient,
  range: DateRange,
): Promise<number> {
  // requested_at (set with created_at at insert) is indexed: a skip scan on (status, requested_at).
  return database.returnRequest.count({
    where: { requestedAt: { gte: range.from, lt: range.to } },
  });
}

// D5: orders per IST calendar day (plan §10B: stored in UTC, shown in IST).
export async function ordersByDay(database: DatabaseClient, range: DateRange) {
  const rows = await database.$queryRaw<
    { day: string; order_count: bigint; sales_paise: bigint | null }[]
  >`
    SELECT to_char((placed_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
           count(*) AS order_count,
           sum(total_paise) FILTER (WHERE status <> 'CANCELLED') AS sales_paise
    FROM orders
    WHERE placed_at >= ${range.from} AND placed_at < ${range.to}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((row) => ({
    day: row.day,
    orderCount: Number(row.order_count),
    salesPaise: Number(row.sales_paise ?? 0n),
  }));
}

export async function ordersByStatus(database: DatabaseClient, range: DateRange) {
  const rows = await database.$queryRaw<{ status: OrderStatus; order_count: bigint }[]>`
    SELECT status, count(*) AS order_count
    FROM orders WHERE placed_at >= ${range.from} AND placed_at < ${range.to}
    GROUP BY 1 ORDER BY 2 DESC`;
  return rows.map((row) => ({ status: row.status, orderCount: Number(row.order_count) }));
}

export async function shipmentsByCourier(database: DatabaseClient, range: DateRange) {
  const rows = await database.$queryRaw<{ courier_name: string; shipment_count: bigint }[]>`
    SELECT coalesce(c.name, 'Unassigned') AS courier_name, count(*) AS shipment_count
    FROM shipments s
    JOIN orders o ON o.id = s.order_id
    LEFT JOIN courier_partners c ON c.id = s.courier_partner_id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND s.status <> 'CANCELLED'
    GROUP BY 1 ORDER BY 2 DESC`;
  return rows.map((row) => ({
    courierName: row.courier_name,
    shipmentCount: Number(row.shipment_count),
  }));
}

// D6: from the order-line snapshots (L31), so later re-tagging does not change past reports.
export async function topProducts(database: DatabaseClient, range: DateRange, limit: number) {
  const rows = await database.$queryRaw<
    { product_id: string; product_name: string; quantity: bigint; sales_paise: bigint }[]
  >`
    SELECT i.product_id, max(i.product_name) AS product_name, sum(i.quantity) AS quantity,
           sum(i.line_total_paise) AS sales_paise
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND o.status <> 'CANCELLED'
    GROUP BY i.product_id ORDER BY 3 DESC, 4 DESC LIMIT ${limit}`;
  return rows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    salesPaise: Number(row.sales_paise),
  }));
}

export async function topCategories(database: DatabaseClient, range: DateRange, limit: number) {
  const rows = await database.$queryRaw<
    { category_name: string; quantity: bigint; sales_paise: bigint }[]
  >`
    SELECT coalesce(i.category_name, 'Untagged') AS category_name, sum(i.quantity) AS quantity,
           sum(i.line_total_paise) AS sales_paise
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND o.status <> 'CANCELLED'
    GROUP BY 1 ORDER BY 3 DESC LIMIT ${limit}`;
  return rows.map((row) => ({
    categoryName: row.category_name,
    quantity: Number(row.quantity),
    salesPaise: Number(row.sales_paise),
  }));
}

export async function stockByWarehouse(database: DatabaseClient) {
  const rows = await database.$queryRaw<
    {
      warehouse_name: string;
      is_active: boolean;
      on_hand: bigint;
      reserved: bigint;
      available: bigint;
    }[]
  >`
    SELECT w.name AS warehouse_name, w.is_active,
           coalesce(sum(l.on_hand_quantity), 0) AS on_hand,
           coalesce(sum(l.reserved_quantity), 0) AS reserved,
           coalesce(sum(l.available_quantity), 0) AS available
    FROM warehouses w LEFT JOIN inventory_levels l ON l.warehouse_id = w.id
    GROUP BY w.id, w.name, w.is_active, w.priority ORDER BY w.priority, w.name`;
  return rows.map((row) => ({
    warehouseName: row.warehouse_name,
    isActive: row.is_active,
    onHandQuantity: Number(row.on_hand),
    reservedQuantity: Number(row.reserved),
    availableQuantity: Number(row.available),
  }));
}

// D7: the same totals three ways for the range's non-cancelled orders: the daily report rows added up,
// the order rows directly, and the payment rows of those orders. They must agree.
export async function reconciliationTotals(database: DatabaseClient, range: DateRange) {
  const [row] = await database.$queryRaw<
    {
      order_count: bigint;
      order_total_paise: bigint | null;
      payment_count: bigint;
      payment_total_paise: bigint | null;
    }[]
  >`
    SELECT count(DISTINCT o.id) AS order_count,
           sum(o.total_paise) AS order_total_paise,
           count(p.id) AS payment_count,
           sum(p.amount_paise) AS payment_total_paise
    FROM orders o LEFT JOIN payments p ON p.order_id = o.id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND o.status <> 'CANCELLED'`;
  return {
    orderCount: Number(row?.order_count ?? 0n),
    orderTotalPaise: Number(row?.order_total_paise ?? 0n),
    paymentCount: Number(row?.payment_count ?? 0n),
    paymentTotalPaise: Number(row?.payment_total_paise ?? 0n),
  };
}
